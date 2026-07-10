import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "build-web-export.mjs");

async function rendererProject(stageSource) {
  const project = await mkdtemp(path.join(os.tmpdir(), "vibegal-renderer-contract-"));
  const renderer = path.join(project, "renderers/default");
  await mkdir(renderer, { recursive: true });
  await writeFile(path.join(renderer, "Stage.tsx"), stageSource);
  await writeFile(path.join(renderer, "index.tsx"), [
    'import { Stage } from "./Stage";',
    'export default { id: "default", name: "Default", contractVersion: 1, Component: Stage };',
  ].join("\n"));
  return project;
}

function checkRenderer(project) {
  return spawnSync(process.execPath, [
    script,
    "--project", project,
    "--renderer", "default",
    "--check-only",
  ], { encoding: "utf8" });
}

test("renderer check rejects removed RendererProps callbacks", async () => {
  const project = await rendererProject([
    'import type { RendererProps } from "@vibegal/engine";',
    "export function Stage({ state, onAdvance }: RendererProps) {",
    "  return <button onClick={onAdvance}>{state.dialogue?.text}</button>;",
    "}",
  ].join("\n"));

  try {
    const result = checkRenderer(project);
    assert.equal(result.status, 1, result.stdout || result.stderr);
    const output = JSON.parse(result.stderr);
    assert.equal(output.code, "renderer_typecheck_failed");
    assert.equal(output.step, "typecheck");
    assert.equal(output.file, "renderers/default/Stage.tsx");
    assert.match(output.message, /onAdvance/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("renderer check accepts the current controls contract", async () => {
  const project = await rendererProject([
    'import type { RendererProps } from "@vibegal/engine";',
    "export function Stage({ state, controls }: RendererProps) {",
    "  return <button onClick={controls.advance}>{state.dialogue?.text}</button>;",
    "}",
  ].join("\n"));

  try {
    const result = checkRenderer(project);
    assert.equal(result.status, 0, result.stdout || result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("standalone worker creates its output directories", async () => {
  const project = await rendererProject([
    'import type { RendererProps } from "@vibegal/engine";',
    "export function Stage({ state }: RendererProps) {",
    "  return <div>{state.narration?.text}</div>;",
    "}",
  ].join("\n"));
  const outDir = await mkdtemp(path.join(os.tmpdir(), "vibegal-renderer-output-"));

  try {
    const result = spawnSync(process.execPath, [
      script,
      "--project", project,
      "--renderer", "default",
      "--out", outDir,
      "--base-path", "./",
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout || result.stderr);
    await access(path.join(outDir, "runtime/bundle.js"));
    await access(path.join(outDir, "renderer/bundle.js"));
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  }
});
