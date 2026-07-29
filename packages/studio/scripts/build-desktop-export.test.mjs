import assert from "node:assert/strict";
import { access, cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "build-desktop-export.mjs");
const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const validPng = path.join(studioRoot, "src-tauri/icons/128x128@2x.png");

async function createWebDist(root, updates = { enabled: false, channel: "preview" }) {
  const dist = path.join(root, "web-dist");
  await mkdir(path.join(dist, "runtime"), { recursive: true });
  await mkdir(path.join(dist, "distribution-icons"), { recursive: true });
  await writeFile(path.join(dist, "distribution-icons/icon.ico"), "derived-icon");
  await cp(validPng, path.join(dist, "distribution-icons/icon-512x512.png"));
  await writeFile(path.join(dist, "index.html"), '<div id="root"></div>');
  await writeFile(path.join(dist, "runtime/bundle.js"), "export {};");
  await writeFile(path.join(dist, "game.manifest.json"), JSON.stringify({
    schemaVersion: 1,
    projectId: "desktop-test",
    title: "内容标题",
    productName: "桌面测试游戏",
    version: "2.3.4-beta.1",
    viewport: { mode: "fill", width: 1440, height: 810 },
    icon: "assets/icon.png",
    icons: {
      source: "assets/icon.png",
      web: "content/assets/icon.png",
      desktop: {
        png: { "512": "distribution-icons/icon-512x512.png" },
        ico: "distribution-icons/icon.ico",
      },
    },
    updates,
    buildTarget: "web",
    basePath: "./",
  }));
  await writeFile(path.join(dist, "asset.manifest.json"), JSON.stringify({ schemaVersion: 1, assets: [] }));
  return dist;
}

function runWorker(args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

async function assertBundleIcon(outDir, relative) {
  const icon = await readFile(path.join(outDir, relative));
  if (process.platform === "darwin") {
    assert.match(relative, /vibegal\.icns$/);
    assert.equal(icon.subarray(0, 4).toString("ascii"), "icns");
  } else if (process.platform === "win32") {
    assert.match(relative, /vibegal-icon\.ico$/);
    assert.equal(icon.toString("utf8"), "derived-icon");
  } else {
    assert.match(relative, /vibegal-icon\.png$/);
    assert.deepEqual(icon, await readFile(validPng));
  }
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
    const manifest = JSON.parse(await readFile(path.join(outDir, "desktop.manifest.json"), "utf8"));
    assert.equal(manifest.runtime, "tauri");
    assert.equal(manifest.mode, "lightweight");
    assert.equal(manifest.title, "内容标题");
    assert.equal(manifest.productName, "桌面测试游戏");
    assert.equal(manifest.version, "2.3.4-beta.1");
    assert.deepEqual(manifest.viewport, { mode: "fill", width: 1440, height: 810 });
    assert.equal(manifest.icon, "assets/icon.png");
    await assertBundleIcon(outDir, manifest.bundleIcon);
    assert.deepEqual(manifest.updates, { enabled: false, channel: "preview" });
    if (process.platform === "darwin") {
      // macOS 导出为真正的 .app bundle：裸二进制下 WebKit/NSBundle 会崩溃。
      assert.equal(output.executable, "桌面测试游戏.app/Contents/MacOS/桌面测试游戏");
      assert.equal(manifest.webDist, "桌面测试游戏.app/Contents/Resources/game");
      const plist = await readFile(path.join(outDir, "桌面测试游戏.app/Contents/Info.plist"), "utf8");
      assert.match(plist, /<key>CFBundleExecutable<\/key>\s*<string>桌面测试游戏<\/string>/);
      assert.match(plist, /<key>CFBundlePackageType<\/key>\s*<string>APPL<\/string>/);
      assert.match(plist, /<key>CFBundleShortVersionString<\/key>\s*<string>2\.3\.4-beta\.1<\/string>/);
      assert.match(plist, /<key>CFBundleIconFile<\/key>\s*<string>vibegal\.icns<\/string>/);
      await access(path.join(outDir, manifest.webDist, "game.manifest.json"));
      assert.equal(
        await readFile(path.join(outDir, manifest.webDist, "runtime/bundle.js"), "utf8"),
        "export {};",
      );
    } else {
      assert.equal(await readFile(path.join(outDir, "game/runtime/bundle.js"), "utf8"), "export {};");
      assert.equal(manifest.webDist, "game");
    }
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
    if (process.platform === "darwin") {
      // macOS 的 Electron 运行时是完整的 .app bundle 结构，
      // 打包逻辑会整体复制 Electron.app 并改名。
      const bundle = path.join(electronDist, "Electron.app");
      await mkdir(path.join(bundle, "Contents/MacOS"), { recursive: true });
      await mkdir(path.join(bundle, "Contents/Resources"), { recursive: true });
      await writeFile(path.join(bundle, "Contents/MacOS/Electron"), "fake-electron");
      await writeFile(path.join(bundle, "Contents/Resources/default_app.asar"), "default-app");
      await writeFile(path.join(bundle, "Contents/Info.plist"), [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<plist version="1.0">',
        "<dict>",
        "  <key>CFBundleName</key>",
        "  <string>Electron</string>",
        "  <key>CFBundleDisplayName</key>",
        "  <string>Electron</string>",
        "</dict>",
        "</plist>",
        "",
      ].join("\n"));
    } else {
      await mkdir(path.join(electronDist, "resources"), { recursive: true });
      const electronExecutable = process.platform === "win32" ? "electron.exe" : "electron";
      await writeFile(path.join(electronDist, electronExecutable), "fake-electron");
      await writeFile(path.join(electronDist, "resources/default_app.asar"), "default-app");
    }

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
    const appResources = process.platform === "darwin"
      ? path.join(outDir, "桌面测试游戏.app/Contents/Resources/app")
      : path.join(outDir, "resources/app");
    const packageManifest = JSON.parse(await readFile(path.join(appResources, "package.json"), "utf8"));
    assert.equal(packageManifest.productName, "桌面测试游戏");
    assert.equal(packageManifest.version, "2.3.4-beta.1");
    const mainSource = await readFile(path.join(appResources, "main.cjs"), "utf8");
    assert.match(mainSource, /let mainWindow;/, "the Electron window must stay strongly referenced");
    assert.match(mainSource, /vibegal:\/\/game/, "the player should use a stable local origin");
    assert.match(mainSource, /contentType\(file\)/, "protocol responses should preserve JavaScript and media MIME types");
    assert.match(mainSource, /registerFileProtocol\("vibegal"/, "local files must be served as protocol file responses");
    assert.match(mainSource, /stageDesktopUpdate/, "the compatible player should run the verified update client");
    assert.match(mainSource, /shell\.openPath/, "a verified staged package should enter the platform installer flow");
    await access(path.join(appResources, "updater/desktop-update-client.mjs"));
    await access(path.join(appResources, "updater/verify-update-manifest.mjs"));
    await access(path.join(appResources, "updater/update-manifest-contract.mjs"));
    assert.equal(await readFile(path.join(appResources, "game/runtime/bundle.js"), "utf8"), "export {};");
    if (process.platform === "darwin") {
      const plist = await readFile(path.join(outDir, "桌面测试游戏.app/Contents/Info.plist"), "utf8");
      assert.match(plist, /<string>桌面测试游戏<\/string>/, "the macOS bundle should be rebranded to the product name");
      assert.match(plist, /<key>CFBundleShortVersionString<\/key>\s*<string>2\.3\.4-beta\.1<\/string>/);
      assert.match(plist, /<key>CFBundleIconFile<\/key>\s*<string>vibegal\.icns<\/string>/);
    }
    const manifest = JSON.parse(await readFile(path.join(outDir, "desktop.manifest.json"), "utf8"));
    assert.equal(manifest.runtime, "electron");
    assert.equal(manifest.mode, "compatible");
    assert.equal(manifest.electronVersion, "test-electron");
    assert.equal(manifest.title, "内容标题");
    assert.equal(manifest.productName, "桌面测试游戏");
    assert.equal(manifest.version, "2.3.4-beta.1");
    assert.deepEqual(manifest.viewport, { mode: "fill", width: 1440, height: 810 });
    assert.equal(manifest.icon, "assets/icon.png");
    await assertBundleIcon(outDir, manifest.bundleIcon);
    assert.deepEqual(manifest.updates, { enabled: false, channel: "preview" });
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

test("tauri runtime rejects configured automatic updates instead of silently omitting the client", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibegal-desktop-tauri-updater-"));
  try {
    const webDist = await createWebDist(root, {
      enabled: true,
      channel: "stable",
      endpoint: "https://updates.example.test/stable.json",
      publicKey: "trusted-public-key",
    });
    const player = path.join(root, process.platform === "win32" ? "vibegal-player-tauri.exe" : "vibegal-player-tauri");
    await writeFile(player, "fake-player");
    const result = runWorker([
      "--runtime", "tauri",
      "--web-dist", webDist,
      "--out", path.join(root, "out"),
      "--product-name", "Update Test",
      "--tauri-player", player,
    ]);
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stderr).code, "desktop_updater_runtime_unsupported");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
