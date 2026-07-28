#!/usr/bin/env node
/**
 * Desktop export worker.
 *
 * Both shells receive the exact same already-built Web distribution. The
 * worker only adds a desktop host; it never recompiles renderer/runtime code.
 */
import { chmod, cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "./renderer-worker-shared.mjs";

function jsonExit(value, code) {
  const stream = code === 0 ? process.stdout : process.stderr;
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
  process.exit(code);
}

function failure(code, message, details = {}) {
  jsonExit({ ok: false, code, message, step: "desktop", ...details }, 1);
}

function safeProductName(value) {
  const safe = String(value || "VibeGal Game")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "")
    .trim();
  return safe || "VibeGal Game";
}

function pathOverlaps(a, b) {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return left === right || left.startsWith(`${right}${path.sep}`) || right.startsWith(`${left}${path.sep}`);
}

async function assertWebDist(webDist) {
  for (const relative of ["index.html", "game.manifest.json", "asset.manifest.json", "runtime/bundle.js"]) {
    try {
      const metadata = await stat(path.join(webDist, relative));
      if (!metadata.isFile()) throw new Error("not a file");
    } catch {
      failure("desktop_web_dist_invalid", `Web build is missing required file: ${relative}`, { file: relative });
    }
  }
}

async function readDistributionMetadata(webDist) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(webDist, "game.manifest.json"), "utf8"));
  } catch (error) {
    failure(
      "desktop_game_manifest_invalid",
      `Unable to read normalized game metadata: ${error instanceof Error ? error.message : String(error)}`,
      { file: "game.manifest.json" },
    );
  }
  const title = String(manifest.title || "VibeGal Game");
  const productName = safeProductName(manifest.productName || title);
  const version = String(manifest.version || "0.1.0");
  return {
    title,
    productName,
    version,
    viewport: manifest.viewport || {
      mode: "fit",
      width: manifest.stage?.width || 1280,
      height: manifest.stage?.height || 720,
    },
    icon: typeof manifest.icon === "string" ? manifest.icon : null,
    icons: manifest.icons || { source: null, web: null, desktop: null },
    updates: manifest.updates || { channel: "stable" },
  };
}

async function writeDesktopManifest(outDir, manifest) {
  await writeFile(
    path.join(outDir, "desktop.manifest.json"),
    `${JSON.stringify({ schemaVersion: 1, ...manifest }, null, 2)}\n`,
  );
}

function hostExecutableName(productName, runtime) {
  if (process.platform === "win32") return `${productName}.exe`;
  if (process.platform === "darwin") {
    if (runtime === "electron") return `${productName}.app/Contents/MacOS/Electron`;
    return `${productName}.app/Contents/MacOS/${productName}`;
  }
  return productName;
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function bundleIdentifier(productName) {
  const slug = String(productName || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `com.vibegal.${slug || "game"}`;
}

function macAppInfoPlist(productName, version) {
  const name = xmlEscape(productName);
  const escapedVersion = xmlEscape(version);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>${name}</string>
  <key>CFBundleIdentifier</key>
  <string>${bundleIdentifier(productName)}</string>
  <key>CFBundleName</key>
  <string>${name}</string>
  <key>CFBundleDisplayName</key>
  <string>${name}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleVersion</key>
  <string>${escapedVersion}</string>
  <key>CFBundleShortVersionString</key>
  <string>${escapedVersion}</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
`;
}

function desktopIconSource(webDist, metadata) {
  const relative = process.platform === "win32"
    ? metadata.icons?.desktop?.ico || metadata.icons?.desktop?.png?.["256"]
    : metadata.icons?.desktop?.png?.["512"] || metadata.icons?.desktop?.png?.["256"];
  return relative ? path.join(webDist, relative) : null;
}

async function installDesktopIcon({ webDist, outDir, metadata, bundle }) {
  const source = desktopIconSource(webDist, metadata);
  if (!source) return null;
  if (process.platform === "darwin" && bundle) {
    const target = path.join(bundle, "Contents/Resources/vibegal-icon.png");
    await cp(source, target);
    return path.relative(outDir, target).replaceAll(path.sep, "/");
  }
  const target = path.join(outDir, path.extname(source).toLowerCase() === ".ico" ? "vibegal-icon.ico" : "vibegal-icon.png");
  await cp(source, target);
  return path.relative(outDir, target).replaceAll(path.sep, "/");
}

async function packageTauri({ webDist, outDir, metadata, playerPath }) {
  const { productName, version } = metadata;
  if (!playerPath) {
    failure("desktop_tauri_player_unavailable", "Tauri player path was not provided.");
  }
  try {
    if (!(await stat(playerPath)).isFile()) throw new Error("not a file");
  } catch {
    failure("desktop_tauri_player_unavailable", `Tauri player does not exist: ${playerPath}`);
  }

  const executable = hostExecutableName(productName, "tauri");
  await mkdir(outDir, { recursive: true });
  if (process.platform === "darwin") {
    // macOS 上必须是真正的 .app bundle：CoreFoundation/WebKit 的 bundle
    // 机制（wry webview_version 的 NSBundle 调用）在裸可执行文件下会
    // 直接崩溃，而且 .app 本来就是 macOS 应用的标准分发形态。
    const bundle = path.join(outDir, `${productName}.app`);
    const macosDir = path.join(bundle, "Contents/MacOS");
    const resourcesDir = path.join(bundle, "Contents/Resources");
    await mkdir(macosDir, { recursive: true });
    await mkdir(resourcesDir, { recursive: true });
    const bundledExecutable = path.join(outDir, executable);
    await cp(playerPath, bundledExecutable);
    await chmod(bundledExecutable, 0o755);
    await cp(webDist, path.join(resourcesDir, "game"), { recursive: true });
    const bundleIcon = await installDesktopIcon({ webDist, outDir, metadata, bundle });
    await writeFile(path.join(bundle, "Contents/Info.plist"), macAppInfoPlist(productName, version));
    const webDistRelative = `${productName}.app/Contents/Resources/game`;
    await writeDesktopManifest(outDir, {
      target: "desktop",
      runtime: "tauri",
      mode: "lightweight",
      productName,
      title: metadata.title,
      version,
      viewport: metadata.viewport,
      icon: metadata.icon,
      icons: metadata.icons,
      bundleIcon,
      updates: metadata.updates,
      executable,
      webDist: webDistRelative,
    });
    return { executable, artifacts: [`${productName}.app`, "desktop.manifest.json"] };
  }
  await cp(playerPath, path.join(outDir, executable));
  await cp(webDist, path.join(outDir, "game"), { recursive: true });
  if (process.platform !== "win32") {
    await chmod(path.join(outDir, executable), 0o755);
  }
  const bundleIcon = await installDesktopIcon({ webDist, outDir, metadata });
  await writeDesktopManifest(outDir, {
    target: "desktop",
    runtime: "tauri",
    mode: "lightweight",
    productName,
    title: metadata.title,
    version,
    viewport: metadata.viewport,
    icon: metadata.icon,
    icons: metadata.icons,
    bundleIcon,
    updates: metadata.updates,
    executable,
    webDist: "game",
  });
  return { executable, artifacts: [executable, "desktop.manifest.json", "game"] };
}

function electronMainSource() {
  return String.raw`"use strict";
const { app, BrowserWindow, protocol } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

protocol.registerSchemesAsPrivileged([{
  scheme: "vibegal",
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}]);

const gameRoot = path.resolve(__dirname, "game");
const gameOrigin = "vibegal://game";
const smoke = process.env.VIBEGAL_DESKTOP_SMOKE === "1";
let mainWindow;
let smokeFinished = false;
let smokeError = "desktop renderer did not publish a result";
const requestedUrls = [];

function finishSmoke(result) {
  if (!smoke || smokeFinished) return;
  smokeFinished = true;
  process.stdout.write("VIBEGAL_DESKTOP_SMOKE_RESULT=" + JSON.stringify(result) + "\n");
  setImmediate(() => app.exit(result.status === "passed" ? 0 : 1));
}

function contentType(file) {
  switch (path.extname(file).toLowerCase()) {
    case ".html": return "text/html; charset=utf-8";
    case ".js": case ".mjs": return "text/javascript; charset=utf-8";
    case ".json": case ".map": return "application/json; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    case ".jpg": case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".mp3": return "audio/mpeg";
    case ".ogg": return "audio/ogg";
    case ".wav": return "audio/wav";
    case ".mp4": return "video/mp4";
    case ".webm": return "video/webm";
    default: return "application/octet-stream";
  }
}

function gameFile(url) {
  let relative;
  try { relative = decodeURIComponent(url.pathname).replace(/^\/+/, ""); }
  catch { return null; }
  if (!relative) relative = "index.html";
  const resolved = path.resolve(gameRoot, relative);
  return resolved === gameRoot || resolved.startsWith(gameRoot + path.sep) ? resolved : null;
}

app.whenReady().then(async () => {
  protocol.registerFileProtocol("vibegal", (request, callback) => {
    requestedUrls.push(request.url);
    const url = new URL(request.url);
    if (url.pathname === "/__vibegal_smoke_result__") {
      const result = Object.fromEntries(url.searchParams.entries());
      finishSmoke(result);
      callback({ path: path.join(gameRoot, "index.html") });
      return;
    }
    const file = gameFile(url);
    if (!file) {
      callback({ error: -10 });
      return;
    }
    try {
      if (!fs.statSync(file).isFile()) throw new Error("not a file");
      callback({ path: file, mimeType: contentType(file) });
    } catch {
      callback({ error: -6 });
    }
  });

  let gameManifest = {};
  try { gameManifest = JSON.parse(fs.readFileSync(path.join(gameRoot, "game.manifest.json"), "utf8")); }
  catch {}
  const stage = gameManifest.stage || {};
  mainWindow = new BrowserWindow({
    title: gameManifest.productName || gameManifest.title || "VibeGal Game",
    width: Number.isFinite(gameManifest.viewport?.width) ? gameManifest.viewport.width : Number.isFinite(stage.width) ? stage.width : 1280,
    height: Number.isFinite(gameManifest.viewport?.height) ? gameManifest.viewport.height : Number.isFinite(stage.height) ? stage.height : 720,
    minWidth: 960,
    minHeight: 540,
    show: !smoke,
    autoHideMenuBar: true,
    backgroundColor: "#000000",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => {
    smokeError = "load failed " + code + " " + description + " " + url;
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    smokeError = "renderer process exited: " + (details?.reason || "unknown");
  });
  mainWindow.webContents.on("console-message", (...args) => {
    const details = args.at(-1);
    const message = typeof details === "object" && details ? details.message : args[2];
    if (message) smokeError = String(message);
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(gameOrigin + "/")) event.preventDefault();
  });
  const query = smoke ? "?vibegalSmoke=1" : "";
  await mainWindow.loadURL(gameOrigin + "/index.html" + query);
  if (smoke) {
    setTimeout(async () => {
      try {
        const pageState = await mainWindow.webContents.executeJavaScript("JSON.stringify({ url: location.href, readyState: document.readyState, smoke: document.querySelector('[data-vibegal-smoke]')?.dataset?.vibegalSmoke || null, rootChildren: document.getElementById('root')?.childElementCount ?? -1, scripts: Array.from(document.scripts).map(script => ({ src: script.src, type: script.type })) })");
        smokeError += "; page=" + pageState + "; requests=" + JSON.stringify(requestedUrls.slice(-20));
      } catch (error) {
        smokeError += "; inspect=" + String(error);
      }
      finishSmoke({
        status: "failed",
        advance: "false",
        branch: "not-present",
        save: "false",
        media: "not-configured",
        error: smokeError,
      });
    }, 15_000);
  }
}).catch(error => {
  if (smoke) {
    finishSmoke({
      status: "failed",
      advance: "false",
      branch: "not-present",
      save: "false",
      media: "not-configured",
      error: "player initialization failed: " + String(error?.stack || error),
    });
  } else {
    console.error(error);
    app.exit(1);
  }
});

app.on("window-all-closed", () => app.quit());
`;
}

async function updateMacBundle(bundle, metadata) {
  const plist = path.join(bundle, "Contents/Info.plist");
  let text;
  try {
    text = await readFile(plist, "utf8");
  } catch {
    failure(
      "desktop_bundle_metadata_failed",
      "Electron Info.plist could not be read as XML; product metadata was not applied.",
      { file: path.relative(bundle, plist).replaceAll(path.sep, "/") },
    );
  }
  const replacements = new Map([
    ["CFBundleName", metadata.productName],
    ["CFBundleDisplayName", metadata.productName],
    ["CFBundleVersion", metadata.version],
    ["CFBundleShortVersionString", metadata.version],
  ]);
  for (const [key, value] of replacements) {
    const escapedValue = xmlEscape(value);
    const expression = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`, "g");
    if (expression.test(text)) {
      text = text.replace(expression, `$1${escapedValue}$2`);
    } else {
      text = text.replace("</dict>", `  <key>${key}</key>\n  <string>${escapedValue}</string>\n</dict>`);
    }
  }
  await writeFile(plist, text);
}

async function packageElectron({ webDist, outDir, metadata, electronDist, electronVersion }) {
  const { productName, version } = metadata;
  if (!electronDist) {
    failure("desktop_electron_runtime_unavailable", "Electron runtime directory was not provided.");
  }
  try {
    if (!(await stat(electronDist)).isDirectory()) throw new Error("not a directory");
  } catch {
    failure("desktop_electron_runtime_unavailable", `Electron runtime directory does not exist: ${electronDist}`);
  }

  let appRoot = outDir;
  let appResources;
  let executable;
  if (process.platform === "darwin") {
    const sourceBundle = path.join(electronDist, "Electron.app");
    const destinationBundle = path.join(outDir, `${productName}.app`);
    await mkdir(outDir, { recursive: true });
    await cp(sourceBundle, destinationBundle, { recursive: true });
    await updateMacBundle(destinationBundle, metadata);
    appRoot = destinationBundle;
    appResources = path.join(destinationBundle, "Contents/Resources/app");
    executable = `${productName}.app/Contents/MacOS/Electron`;
  } else {
    await cp(electronDist, outDir, { recursive: true });
    const sourceExecutable = path.join(outDir, process.platform === "win32" ? "electron.exe" : "electron");
    executable = hostExecutableName(productName, "electron");
    const { rename, chmod } = await import("node:fs/promises");
    await rename(sourceExecutable, path.join(outDir, executable));
    if (process.platform !== "win32") await chmod(path.join(outDir, executable), 0o755);
    appResources = path.join(outDir, "resources/app");
  }

  await rm(path.join(appRoot, process.platform === "darwin" ? "Contents/Resources/default_app.asar" : "resources/default_app.asar"), { force: true });
  await mkdir(appResources, { recursive: true });
  await writeFile(path.join(appResources, "package.json"), `${JSON.stringify({
    name: "vibegal-player",
    productName,
    version,
    main: "main.cjs",
  }, null, 2)}\n`);
  await writeFile(path.join(appResources, "main.cjs"), electronMainSource());
  await cp(webDist, path.join(appResources, "game"), { recursive: true });
  const bundleIcon = await installDesktopIcon({
    webDist,
    outDir,
    metadata,
    bundle: process.platform === "darwin" ? appRoot : null,
  });
  await writeDesktopManifest(outDir, {
    target: "desktop",
    runtime: "electron",
    mode: "compatible",
    productName,
    title: metadata.title,
    version,
    viewport: metadata.viewport,
    icon: metadata.icon,
    icons: metadata.icons,
    bundleIcon,
    updates: metadata.updates,
    executable,
    webDist: path.relative(outDir, path.join(appResources, "game")).replaceAll(path.sep, "/"),
    electronVersion: electronVersion || "bundled",
  });
  return { executable, artifacts: [executable, "desktop.manifest.json", path.relative(outDir, appResources).replaceAll(path.sep, "/")] };
}

function electronCacheRoot() {
  if (process.env.VIBEGAL_ELECTRON_RUNTIME_CACHE) {
    return path.resolve(process.env.VIBEGAL_ELECTRON_RUNTIME_CACHE);
  }
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "VibeGal", "runtime");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Caches", "VibeGal", "runtime");
  }
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "vibegal", "runtime");
}

function electronArtifactArch() {
  if (process.arch === "arm") return "armv7l";
  return process.arch;
}

async function resolveElectronDist(explicit, version) {
  if (explicit) return path.resolve(explicit);
  if (!version) {
    failure("desktop_electron_runtime_unavailable", "Electron runtime version was not provided.");
  }

  const cacheDir = path.join(
    electronCacheRoot(),
    `electron-v${version}-${process.platform}-${electronArtifactArch()}`,
  );
  const marker = path.join(cacheDir, ".vibegal-runtime-ready");
  try {
    if ((await stat(marker)).isFile()) return cacheDir;
  } catch {}

  let downloadArtifact;
  let AdmZip;
  try {
    ({ downloadArtifact } = await import("@electron/get"));
    ({ default: AdmZip } = await import("adm-zip"));
  } catch (error) {
    failure(
      "desktop_electron_runtime_unavailable",
      `Electron runtime downloader is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let archive;
  try {
    archive = await downloadArtifact({
      version,
      artifactName: "electron",
      platform: process.platform,
      arch: electronArtifactArch(),
      quiet: true,
    });
  } catch (error) {
    failure(
      "desktop_electron_runtime_unavailable",
      `Downloading Electron ${version} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const temporaryDir = `${cacheDir}.tmp-${process.pid}-${Date.now()}`;
  await rm(temporaryDir, { recursive: true, force: true });
  await mkdir(temporaryDir, { recursive: true });
  try {
    new AdmZip(archive).extractAllTo(temporaryDir, true);
    await writeFile(path.join(temporaryDir, ".vibegal-runtime-ready"), `${version}\n`);
    await rm(cacheDir, { recursive: true, force: true });
    await mkdir(path.dirname(cacheDir), { recursive: true });
    await rename(temporaryDir, cacheDir);
  } catch (error) {
    await rm(temporaryDir, { recursive: true, force: true });
    failure(
      "desktop_electron_runtime_unavailable",
      `Extracting Electron ${version} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return cacheDir;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runtime = args.runtime;
  const webDist = args["web-dist"] ? path.resolve(args["web-dist"]) : "";
  const outDir = args.out ? path.resolve(args.out) : "";
  if (!webDist || !outDir) {
    failure("desktop_worker_invalid_args", "Desktop build requires --runtime, --web-dist and --out.");
  }
  if (runtime !== "tauri" && runtime !== "electron") {
    failure("desktop_runtime_unsupported", `Unsupported desktop runtime: ${runtime || "<missing>"}`);
  }
  const metadata = await readDistributionMetadata(webDist);
  if (pathOverlaps(webDist, outDir)) {
    failure("desktop_output_path_unsafe", "Desktop output directory must not overlap the Web staging directory.");
  }
  await assertWebDist(webDist);
  await rm(outDir, { recursive: true, force: true });

  const result = runtime === "tauri"
    ? await packageTauri({
      webDist,
      outDir,
      metadata,
      playerPath: args["tauri-player"] ? path.resolve(args["tauri-player"]) : "",
    })
    : await packageElectron({
      webDist,
      outDir,
      metadata,
      electronDist: await resolveElectronDist(args["electron-dist"], args["electron-version"]),
      electronVersion: args["electron-version"],
    });

  jsonExit({
    ok: true,
    target: "desktop",
    runtime,
    mode: runtime === "electron" ? "compatible" : "lightweight",
    outDir,
    executable: result.executable,
    artifacts: result.artifacts,
  }, 0);
}

await main().catch(error => {
  failure("desktop_worker_failed", error instanceof Error ? error.message : String(error));
});
