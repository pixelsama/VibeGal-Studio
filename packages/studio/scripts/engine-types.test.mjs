#!/usr/bin/env node
/**
 * .galstudio 类型产物（engine.d.ts + react shim + 项目 tsconfig）的集成测试。
 *
 * 在临时目录拼出一个「项目视角」的最小工程：
 *   .galstudio/types/engine.d.ts  ← 生成物（canonical）
 *   .galstudio/types/react.d.ts   ← templates/react-shim/react.d.ts
 *   tsconfig.json                 ← templates/project-tsconfig.json
 *   renderers/<id>/index.tsx      ← 测试夹具
 * 然后用项目 tsconfig 原样跑 tsc，验证：
 *   1. 契约用法的渲染层零诊断（含 skipLibCheck:false，d.ts 自身必须干净）；
 *   2. 写错契约的渲染层报出预期错误；
 *   3. engine.d.ts 无 zod / import("...") 残留（自包含）。
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(scriptDir, "..");
const engineDtsPath = path.join(studioRoot, "src-tauri/generated/engine-types/engine.d.ts");
const reactShimPath = path.join(studioRoot, "templates/react-shim/react.d.ts");
const tsconfigTemplatePath = path.join(studioRoot, "templates/project-tsconfig.json");

const GOOD_RENDERER = `import { useEffect, useState, type CSSProperties } from "react";
import {
  createInitialState,
  resolveAsset,
  RENDERER_CONTRACT_VERSION,
  type BacklogEntry,
  type Manifest,
  type NovelState,
  type RendererManifest,
  type RendererProps,
} from "@vibegal/engine";

const box: CSSProperties = { position: "absolute", width: "100%" };

function firstSpeaker(state: NovelState): string {
  return state.speaker?.name ?? "narrator";
}

function spriteExprs(state: NovelState): string[] {
  return state.sprites.map((sprite) => sprite.expr);
}

function cgPath(manifest: Manifest, contentBase: string, id: string): string {
  const asset = manifest.cg[id];
  return asset ? resolveAsset(contentBase, asset.path) : "";
}

async function slotCount(props: RendererProps): Promise<number> {
  const slots = await props.runtime?.save.listSlots();
  return slots?.length ?? 0;
}

function backlogText(entries: BacklogEntry[]): string {
  return entries.map((entry) => entry.text).join("\\n");
}

function Component(props: RendererProps) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
    props.controls.advance();
  }, []);
  const master = props.runtime?.settings.getSettings().volumes.master ?? 1;
  const choices = props.state.choice?.choices ?? [];
  const initial = createInitialState();
  return (
    <div style={box} data-master={master} data-stage={props.stage.width} data-initial-bg={initial.background}>
      {firstSpeaker(props.state)}
      {spriteExprs(props.state).join(",")}
      {props.state.dialogue?.text ?? props.state.narration?.text ?? ""}
      {choices.map((choice) => (
        <button type="button" key={choice.to} onClick={() => props.controls.choose(choice.to)}>
          {choice.text}
        </button>
      ))}
      {backlogText(props.runtime?.history.getBacklog() ?? [])}
      {cgPath(props.manifest, props.contentBase, "main")}
      {ready ? "ready" : "loading"}
    </div>
  );
}

const renderer: RendererManifest = {
  id: "default",
  name: "Default",
  contractVersion: RENDERER_CONTRACT_VERSION,
  Component,
};

export default renderer;
`;

const BAD_RENDERER = `import type { RendererManifest, RendererProps } from "@vibegal/engine";

function Component(props: RendererProps) {
  const text: string = props.state.dialogue?.textt ?? "";
  props.controls.advance(1);
  props.runtime?.save.listSlots("quick");
  return text;
}

const renderer: RendererManifest = {
  id: "broken",
  name: "Broken",
  contractVersion: 2,
  Component,
};

export default renderer;
`;

function makeFixtureProject(rendererId, rendererSource) {
  const root = mkdtempSync(path.join(tmpdir(), "vibegal-engine-types-"));
  mkdirSync(path.join(root, ".galstudio/types"), { recursive: true });
  mkdirSync(path.join(root, "renderers", rendererId), { recursive: true });
  writeFileSync(path.join(root, ".galstudio/types/engine.d.ts"), readFileSync(engineDtsPath, "utf8"));
  writeFileSync(path.join(root, ".galstudio/types/react.d.ts"), readFileSync(reactShimPath, "utf8"));
  writeFileSync(path.join(root, "tsconfig.json"), readFileSync(tsconfigTemplatePath, "utf8"));
  writeFileSync(path.join(root, "renderers", rendererId, "index.tsx"), rendererSource);
  return root;
}

function typecheckFixture(root) {
  const configText = readFileSync(path.join(root, "tsconfig.json"), "utf8");
  const { config, error } = ts.readConfigFile(path.join(root, "tsconfig.json"), () => configText);
  assert.equal(error, undefined, "tsconfig 必须可解析");
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, root);
  assert.deepEqual(parsed.errors, [], "tsconfig 内容必须合法");
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  return ts.getPreEmitDiagnostics(program).map((diagnostic) => {
    const file = diagnostic.file?.fileName ? path.basename(diagnostic.file.fileName) : "";
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    return { code: diagnostic.code, file, message };
  });
}

test("engine.d.ts 是自包含的（无 zod / import() 残留）", () => {
  const source = readFileSync(engineDtsPath, "utf8");
  assert.equal(/\bZod[A-Za-z]*\b/.test(source), false, "engine.d.ts 不应引用 zod 类型名");
  assert.equal(/from "zod"/.test(source), false, "engine.d.ts 不应 import zod");
  assert.equal(/import\("\.\//.test(source), false, "engine.d.ts 不应保留相对 import() 引用");
  assert.equal(/import\("@vibegal\//.test(source), false, "engine.d.ts 不应保留 @vibegal import() 引用");
});

test("契约用法的渲染层在项目 tsconfig 下零诊断", (t) => {
  const root = makeFixtureProject("default", GOOD_RENDERER);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const diagnostics = typecheckFixture(root);
  assert.deepEqual(diagnostics, []);
});

test("写错契约的渲染层报出类型错误", (t) => {
  const root = makeFixtureProject("broken", BAD_RENDERER);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const diagnostics = typecheckFixture(root);
  const messages = diagnostics.map((diagnostic) => diagnostic.message).join("\n");
  const codes = diagnostics.map((diagnostic) => diagnostic.code);
  assert.match(messages, /textt/, "应指出 dialogue 上没有 textt 字段");
  assert.match(messages, /contractVersion|Type '2' is not assignable to type '1'/, "应指出 contractVersion: 2 不符合契约");
  assert.equal(
    codes.filter((code) => code === 2554).length,
    2,
    "advance(1) 与 listSlots(\"quick\") 应各报一个参数个数错误（TS2554）",
  );
});

test("随产品分发的默认渲染层在类型产物下零诊断", (t) => {
  const defaultRendererDir = path.join(studioRoot, "src-tauri/resources/default-renderer");
  const root = mkdtempSync(path.join(tmpdir(), "vibegal-engine-types-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, ".galstudio/types"), { recursive: true });
  writeFileSync(path.join(root, ".galstudio/types/engine.d.ts"), readFileSync(engineDtsPath, "utf8"));
  writeFileSync(path.join(root, ".galstudio/types/react.d.ts"), readFileSync(reactShimPath, "utf8"));
  writeFileSync(path.join(root, "tsconfig.json"), readFileSync(tsconfigTemplatePath, "utf8"));
  cpSync(defaultRendererDir, path.join(root, "renderers/default"), { recursive: true });
  const diagnostics = typecheckFixture(root);
  assert.deepEqual(diagnostics, []);
});
