import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(studioRoot, "../..");

test("Tauri bundles the standalone exporter without flattening its directories", async () => {
  const config = JSON.parse(await readFile(
    path.join(studioRoot, "src-tauri/tauri.conf.json"),
    "utf8",
  ));

  assert.equal(
    config.bundle.resources["resources/exporter/"],
    "exporter/",
    "directory resources must not use a glob because Tauri flattens mapped glob results",
  );
  assert.equal(config.bundle.resources["resources/exporter/**/*"], undefined);
});

test("prepared web exporter runs outside the repository layout", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "vibegal-exporter-dist-"));
  try {
    const prepare = spawnSync(process.execPath, [
      path.join(scriptDir, "prepare-web-exporter.mjs"),
      "--out", outDir,
    ], { cwd: repoRoot, encoding: "utf8" });
    assert.equal(prepare.status, 0, prepare.stdout || prepare.stderr);

    const worker = path.join(outDir, "packages/studio/scripts/build-web-export.mjs");
    const check = spawnSync(process.execPath, [
      worker,
      "--check-only",
      "--project", path.join(repoRoot, "examples/sample-novel"),
      "--renderer", "default",
    ], { cwd: os.tmpdir(), encoding: "utf8" });
    assert.equal(check.status, 0, check.stdout || check.stderr);
    assert.equal(JSON.parse(check.stdout).ok, true);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
