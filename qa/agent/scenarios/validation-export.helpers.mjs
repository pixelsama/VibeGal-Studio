import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const PROJECT_FILES = [
  "gal.project.json",
  "content/graph.json",
  "content/meta.json",
  "content/manifest.json",
];

export const CLI_TIMEOUT_MS = 10 * 60_000;
export const SMOKE_TIMEOUT_MS = 3 * 60_000;

export function validationExportArtifactRoot(artifacts) {
  return path.join(artifacts, "validation-export");
}

export function validationExportPaths({ root, artifacts }) {
  const artifactRoot = validationExportArtifactRoot(artifacts);
  return {
    artifactRoot,
    webOut: path.join(artifactRoot, "dist-web"),
    desktopOut: path.join(artifactRoot, "dist-desktop-tauri"),
    cliReport: path.join(artifactRoot, "edit-and-validate.json"),
    exportReport: path.join(artifactRoot, "export.json"),
    root,
  };
}

export async function snapshotProject(projectPath) {
  const files = await listFiles(projectPath);
  const hashes = {};
  for (const file of files) {
    const bytes = await readFile(file);
    hashes[path.relative(projectPath, file).split(path.sep).join("/")] = createHash("sha256")
      .update(bytes)
      .digest("hex");
  }
  return { fileCount: files.length, hashes };
}

export async function snapshotProjectContractFiles(projectPath) {
  const hashes = {};
  for (const relative of PROJECT_FILES) {
    const file = path.join(projectPath, relative);
    const bytes = await readFile(file);
    hashes[relative] = createHash("sha256").update(bytes).digest("hex");
  }
  return hashes;
}

export async function waitForFiles(files, { timeoutMs = 30_000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const missing = [];
    for (const file of files) {
      try {
        if (!(await stat(file)).isFile()) missing.push(file);
      } catch {
        missing.push(file);
      }
    }
    if (missing.length === 0) return;
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(`required export files did not appear: ${missing.join(", ")}`);
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, remaining)));
  }
}

export async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

export function resolveCliInvocation(root) {
  const explicit = process.env.VIBEGAL_CLI_PATH;
  const candidates = [
    explicit,
    path.join(root, "packages/studio/src-tauri/target/debug", executableName("vibegal-cli")),
    path.join(root, "packages/studio/src-tauri/target/release", executableName("vibegal-cli")),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (isFileSync(candidate)) {
      return { command: candidate, prefixArgs: [], kind: "binary" };
    }
  }

  return {
    command: process.platform === "win32" ? "cargo.exe" : "cargo",
    prefixArgs: [
      "run",
      "--locked",
      "--manifest-path",
      path.join(root, "packages/studio/src-tauri/Cargo.toml"),
      "--bin",
      "vibegal-cli",
      "--",
    ],
    kind: "cargo-run",
  };
}

export async function runVibegalCli({ root, args, timeoutMs = CLI_TIMEOUT_MS, env = {} }) {
  const invocation = resolveCliInvocation(root);
  const workerEnv = resolveWorkerEnv(root);
  const commandArgs = [...invocation.prefixArgs, ...args];
  const startedAt = Date.now();
  const child = spawn(invocation.command, commandArgs, {
    cwd: root,
    env: { ...process.env, ...workerEnv, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let spawnError = null;
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

  let forceKillTimer;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    forceKillTimer = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 2_000);
    forceKillTimer.unref();
  }, timeoutMs);

  const outcome = await new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    child.once("error", (error) => {
      spawnError = error;
      finish({ code: null, signal: null });
    });
    child.once("exit", (code, signal) => finish({ code, signal }));
  });
  clearTimeout(timer);
  if (forceKillTimer) clearTimeout(forceKillTimer);

  return {
    command: invocation.command,
    args: commandArgs,
    kind: invocation.kind,
    code: outcome.code ?? 1,
    signal: outcome.signal,
    timedOut,
    spawnError: spawnError ? String(spawnError) : null,
    stdout,
    stderr,
    durationMs: Date.now() - startedAt,
  };
}

export function parseJsonDocument(result, label) {
  if (result.spawnError) throw new Error(`${label} failed to spawn: ${result.spawnError}`);
  if (result.timedOut) throw new Error(`${label} exceeded its process timeout`);
  try {
    return JSON.parse(result.stdout.trim());
  } catch (error) {
    throw new Error(`${label} did not return one JSON document: ${error.message}\n${result.stdout}`);
  }
}

export function parseJsonLines(result, label) {
  if (result.spawnError) throw new Error(`${label} failed to spawn: ${result.spawnError}`);
  if (result.timedOut) throw new Error(`${label} exceeded its process timeout`);
  const lines = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) throw new Error(`${label} returned no JSONL output`);
  const values = lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${label} line ${index + 1} is not JSON: ${error.message}\n${line}`);
    }
  });
  return { values, final: values.at(-1) };
}

export async function inspectWebExport(outDir) {
  const required = [
    "index.html",
    "game.manifest.json",
    "asset.manifest.json",
    "manifest.webmanifest",
    "runtime/bundle.js",
    "renderer/bundle.js",
    "content/graph.json",
    "content/meta.json",
  ].map((relative) => path.join(outDir, relative));
  await waitForFiles(required);
  const gameManifest = await readJson(path.join(outDir, "game.manifest.json"));
  const assetManifest = await readJson(path.join(outDir, "asset.manifest.json"));
  const index = await readFile(path.join(outDir, "index.html"), "utf8");
  const runtime = await readFile(path.join(outDir, "runtime/bundle.js"), "utf8");
  const assets = Array.isArray(assetManifest.assets) ? assetManifest.assets : [];
  await waitForFiles(assets.map((asset) => path.join(outDir, asset.path)));
  return {
    requiredFiles: required.map((file) => path.relative(outDir, file).split(path.sep).join("/")),
    gameManifest,
    assetCount: assets.length,
    contentHash: gameManifest.contentHash,
    assetManifestHash: gameManifest.assetManifestHash,
    payload: {
      indexReferencesRuntime: index.includes("runtime/bundle.js"),
      runtimeBytes: Buffer.byteLength(runtime),
      assetManifestEntries: assets.length,
    },
  };
}

export async function inspectDesktopExport(outDir) {
  await waitForFiles([path.join(outDir, "desktop.manifest.json")]);
  const desktopManifest = await readJson(path.join(outDir, "desktop.manifest.json"));
  const webDist = resolveInside(outDir, desktopManifest.webDist, "desktop web payload");
  const executable = resolveInside(outDir, desktopManifest.executable, "desktop executable");
  await waitForFiles([
    executable,
    path.join(webDist, "index.html"),
    path.join(webDist, "game.manifest.json"),
    path.join(webDist, "asset.manifest.json"),
    path.join(webDist, "runtime/bundle.js"),
    path.join(webDist, "content/graph.json"),
  ]);
  return {
    desktopManifest,
    payload: {
      webDist: path.relative(outDir, webDist).split(path.sep).join("/"),
      executable: path.relative(outDir, executable).split(path.sep).join("/"),
      executableBytes: (await stat(executable)).size,
    },
  };
}

export async function writeArtifact(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function resolveWorkerEnv(root) {
  const env = {
    VIBEGAL_NODE: process.execPath,
    VIBEGAL_EXPORT_WORKER: path.join(root, "packages/studio/scripts/build-web-export.mjs"),
    VIBEGAL_DESKTOP_WORKER: path.join(root, "packages/studio/scripts/build-desktop-export.mjs"),
  };
  const tauriPlayer = [
    path.join(root, "packages/studio/src-tauri/target/debug", executableName("vibegal-player-tauri")),
    path.join(root, "packages/studio/src-tauri/target/debug/player", executableName("vibegal-player-tauri")),
    path.join(root, "packages/studio/src-tauri/target/release", executableName("vibegal-player-tauri")),
  ].find((candidate) => isFileSync(candidate));
  if (tauriPlayer) env.VIBEGAL_TAURI_PLAYER = tauriPlayer;
  return env;
}

function resolveInside(root, relative, label) {
  if (typeof relative !== "string" || relative.trim() === "") {
    throw new Error(`${label} path is missing from desktop.manifest.json`);
  }
  const resolved = path.resolve(root, relative);
  const rootWithSeparator = `${path.resolve(root)}${path.sep}`;
  if (resolved !== path.resolve(root) && !resolved.startsWith(rootWithSeparator)) {
    throw new Error(`${label} escapes the desktop output directory: ${relative}`);
  }
  return resolved;
}

function executableName(name) {
  return process.platform === "win32" ? `${name}.exe` : name;
}

function isFileSync(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

async function listFiles(root) {
  const result = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) result.push(file);
    }
  }
  await visit(root);
  result.sort();
  return result;
}
