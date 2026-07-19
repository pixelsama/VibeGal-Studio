import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "build-desktop-export.mjs");

async function createWebDist(root) {
  const dist = path.join(root, "web-dist");
  await mkdir(path.join(dist, "runtime"), { recursive: true });
  await writeFile(path.join(dist, "index.html"), '<div id="root"></div>');
  await writeFile(path.join(dist, "runtime/bundle.js"), "export {};");
  await writeFile(path.join(dist, "game.manifest.json"), JSON.stringify({
    schemaVersion: 1,
    projectId: "desktop-test",
    title: "桌面测试游戏",
    buildTarget: "web",
    basePath: "./",
  }));
  await writeFile(path.join(dist, "asset.manifest.json"), JSON.stringify({ schemaVersion: 1, assets: [] }));
  return dist;
}

function runWorker(args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

test("tauri runtime packages the exact web dist with a reusable player", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibegal-desktop-tauri-"));
  try {
    const webDist = await createWebDist(root);
    const player = path.join(root, process.platform === "win32" ? "vibegal-player-tauri.exe" : "vibegal-player-tauri");
    const outDir = path.join(root, "desktop-out");
    await writeFile(player, "fake-player");

    const result = runWorker([
      "--runtime", "tauri",
      "--web-dist", webDist,
      "--out", outDir,
      "--product-name", "桌面测试游戏",
      "--tauri-player", player,
    ]);

    assert.equal(result.status, 0, result.stdout || result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.runtime, "tauri");
    assert.equal(output.mode, "lightweight");
    await access(path.join(outDir, output.executable));
    assert.equal(await readFile(path.join(outDir, "game/runtime/bundle.js"), "utf8"), "export {};");
    const manifest = JSON.parse(await readFile(path.join(outDir, "desktop.manifest.json"), "utf8"));
    assert.equal(manifest.runtime, "tauri");
    assert.equal(manifest.mode, "lightweight");
    assert.equal(manifest.webDist, "game");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("electron runtime packages the exact web dist with the bundled chromium shell", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibegal-desktop-electron-"));
  try {
    const webDist = await createWebDist(root);
    const electronDist = path.join(root, "electron-dist");
    const outDir = path.join(root, "desktop-out");
    await mkdir(path.join(electronDist, "resources"), { recursive: true });
    const electronExecutable = process.platform === "win32" ? "electron.exe" : "electron";
    await writeFile(path.join(electronDist, electronExecutable), "fake-electron");
    await writeFile(path.join(electronDist, "resources/default_app.asar"), "default-app");

    const result = runWorker([
      "--runtime", "electron",
      "--web-dist", webDist,
      "--out", outDir,
      "--product-name", "桌面测试游戏",
      "--electron-dist", electronDist,
      "--electron-version", "test-electron",
    ]);

    assert.equal(result.status, 0, result.stdout || result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.runtime, "electron");
    assert.equal(output.mode, "compatible");
    await access(path.join(outDir, output.executable));
    const mainSource = await readFile(path.join(outDir, "resources/app/main.cjs"), "utf8");
    assert.match(mainSource, /let mainWindow;/, "the Electron window must stay strongly referenced");
    assert.match(mainSource, /vibegal:\/\/game/, "the player should use a stable local origin");
    assert.match(mainSource, /contentType\(file\)/, "protocol responses should preserve JavaScript and media MIME types");
    assert.match(mainSource, /registerFileProtocol\("vibegal"/, "local files must be served as protocol file responses");
    assert.equal(await readFile(path.join(outDir, "resources/app/game/runtime/bundle.js"), "utf8"), "export {};");
    const manifest = JSON.parse(await readFile(path.join(outDir, "desktop.manifest.json"), "utf8"));
    assert.equal(manifest.runtime, "electron");
    assert.equal(manifest.mode, "compatible");
    assert.equal(manifest.electronVersion, "test-electron");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop worker rejects unknown runtimes with machine-readable diagnostics", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibegal-desktop-invalid-"));
  try {
    const webDist = await createWebDist(root);
    const result = runWorker([
      "--runtime", "unknown",
      "--web-dist", webDist,
      "--out", path.join(root, "out"),
      "--product-name", "Invalid",
    ]);
    assert.equal(result.status, 1);
    const output = JSON.parse(result.stderr);
    assert.equal(output.ok, false);
    assert.equal(output.code, "desktop_runtime_unsupported");
    assert.equal(output.step, "desktop");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
