import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "renderer-snapshot.mjs");

async function snapshotProject(stageSource) {
  const project = await mkdtemp(path.join(os.tmpdir(), "vibegal-renderer-snapshot-"));
  const renderer = path.join(project, "renderers/default");
  await mkdir(renderer, { recursive: true });
  await writeFile(path.join(renderer, "Stage.tsx"), stageSource);
  await writeFile(path.join(renderer, "index.tsx"), [
    'import { Stage } from "./Stage";',
    'export default { id: "default", name: "Default", contractVersion: 1, Component: Stage };',
  ].join("\n"));
  const content = path.join(project, "content");
  await mkdir(content, { recursive: true });
  await writeFile(path.join(content, "meta.json"), JSON.stringify({
    title: "snapshot fixture",
    stage: { width: 1280, height: 720 },
  }));
  await writeFile(path.join(content, "manifest.json"), JSON.stringify({
    characters: {
      heroine: {
        name: "测试角色",
        color: "#ffcc00",
        sprites: { default: "assets/characters/heroine_default.svg" },
      },
    },
    backgrounds: { sky: "assets/backgrounds/sky.svg" },
    audio: { bgm: {}, sfx: {}, voice: {} },
  }));
  return project;
}

const stageSource = [
  'import type { RendererProps } from "@vibegal/engine";',
  "export function Stage({ state }: RendererProps) {",
  "  return <div>{state.dialogue?.text ?? state.narration?.text}</div>;",
  "}",
].join("\n");

function runSnapshot(project, outDir) {
  return spawnSync(process.execPath, [
    script,
    "--project", project,
    "--renderer", "default",
    "--out", outDir,
  ], { encoding: "utf8" });
}

test("renderer snapshot emits bundle, html and scenes metadata", async () => {
  const project = await snapshotProject(stageSource);
  const outDir = await mkdtemp(path.join(os.tmpdir(), "vibegal-snapshot-output-"));

  try {
    const result = runSnapshot(project, outDir);
    assert.equal(result.status, 0, result.stdout || result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.rendererId, "default");
    assert.deepEqual(
      output.scenes.map((scene) => scene.id),
      ["dialogue", "narration", "choice", "sprites"],
    );
    assert.deepEqual(output.stage, { width: 1280, height: 720 });

    const snapshotDir = path.join(outDir, ".vibegal-snapshot");
    assert.equal(output.snapshotDir, snapshotDir);
    for (const file of ["snapshot.html", "bundle.js", "snapshot-entry.tsx", "scenes.json"]) {
      await access(path.join(snapshotDir, file));
    }
    const scenesJson = JSON.parse(await readFile(path.join(snapshotDir, "scenes.json"), "utf8"));
    assert.deepEqual(scenesJson.scenes, output.scenes);
    assert.deepEqual(scenesJson.stage, output.stage);
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  }
});

test("renderer snapshot rejects unsupported bare imports", async () => {
  const project = await snapshotProject([
    'import "lodash";',
    stageSource,
  ].join("\n"));
  const outDir = await mkdtemp(path.join(os.tmpdir(), "vibegal-snapshot-output-"));

  try {
    const result = runSnapshot(project, outDir);
    assert.equal(result.status, 1, result.stdout || result.stderr);
    const output = JSON.parse(result.stderr);
    assert.equal(output.ok, false);
    assert.equal(output.code, "renderer_unsupported_import");
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  }
});

test("renderer snapshot requires --project, --renderer and --out", async () => {
  const result = spawnSync(process.execPath, [script, "--renderer", "default"], { encoding: "utf8" });
  assert.equal(result.status, 1, result.stdout || result.stderr);
  const output = JSON.parse(result.stderr);
  assert.equal(output.ok, false);
  assert.equal(output.code, "build_worker_invalid_args");
});
