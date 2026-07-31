#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const AGENT_QA_DEPENDENCIES = ["tauri-plugin-wdio", "tauri-plugin-wdio-webdriver"];
const LEAK_MARKERS = ["wdioTauri", "@wdio/tauri-plugin", "TAURI_WEBDRIVER_PORT", "wdio-webdriver"];

export function validateAgentQaCargoPackage(pkg) {
  const feature = pkg.features?.["agent-qa"];
  if (!Array.isArray(feature)) throw new Error("Cargo package must declare the agent-qa feature");
  for (const name of AGENT_QA_DEPENDENCIES) {
    const dependency = pkg.dependencies?.find((entry) => entry.name === name);
    if (!dependency) throw new Error(`Cargo package is missing ${name}`);
    if (!dependency.optional) throw new Error(`${name} must be optional`);
    if (!feature.includes(`dep:${name}`)) throw new Error(`agent-qa feature must enable dep:${name}`);
  }
}

export function agentQaLeakInFiles(files) {
  for (const file of files) {
    for (const marker of LEAK_MARKERS) {
      if (file.content.includes(marker)) return { path: file.path, marker };
    }
  }
  return null;
}

export function validateAgentQaTauriConfig(agentConfig, productionConfig) {
  if (!agentConfig.identifier || agentConfig.identifier === productionConfig.identifier) {
    throw new Error("Agent QA must use a distinct application identifier for settings isolation");
  }
}

export async function checkAgentQaIsolation(root) {
  const manifest = path.join(root, "packages/studio/src-tauri/Cargo.toml");
  const configDir = path.dirname(manifest);
  const [productionConfig, agentConfig] = await Promise.all([
    readFile(path.join(configDir, "tauri.conf.json"), "utf8").then(JSON.parse),
    readFile(path.join(configDir, "tauri.agent-qa.conf.json"), "utf8").then(JSON.parse),
  ]);
  validateAgentQaTauriConfig(agentConfig, productionConfig);
  const metadata = commandJson("cargo", ["metadata", "--format-version", "1", "--no-deps", "--manifest-path", manifest], root);
  const pkg = metadata.packages.find((entry) => entry.name === "vibegal-studio");
  if (!pkg) throw new Error("vibegal-studio package missing from cargo metadata");
  validateAgentQaCargoPackage(pkg);

  run("pnpm", ["--filter", "@vibegal/studio", "build"], root);
  const distFiles = await readTextFiles(path.join(root, "packages/studio/dist"));
  const leak = agentQaLeakInFiles(distFiles);
  if (leak) throw new Error(`production frontend contains Agent QA marker ${leak.marker} in ${leak.path}`);

  const tree = run("cargo", [
    "tree",
    "--locked",
    "--edges",
    "normal",
    "--no-default-features",
    "--manifest-path",
    manifest,
  ], root, true);
  const dependencyLeak = AGENT_QA_DEPENDENCIES.find((name) => tree.split(/\r?\n/).some((line) => line.includes(name)));
  if (dependencyLeak) throw new Error(`production Cargo tree contains test-only dependency ${dependencyLeak}`);
  return {
    cargoFeature: "agent-qa",
    applicationIdentifier: agentConfig.identifier,
    productionFilesScanned: distFiles.length,
  };
}

async function readTextFiles(dir, root = dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...await readTextFiles(fullPath, root));
    } else if (/\.(?:html|js|mjs|css|json)$/i.test(entry.name)) {
      result.push({ path: path.relative(root, fullPath), content: await readFile(fullPath, "utf8") });
    }
  }
  return result;
}

function commandJson(command, args, cwd) {
  return JSON.parse(run(command, args, cwd, true));
}

function run(command, args, cwd, capture = false) {
  // Windows 上 pnpm 是 .cmd 批处理：spawnSync 直接执行会 EINVAL，
  // 用显式 cmd.exe /d /s /c 解释（args 均为简单字面量，无注入面）。
  const isPnpmOnWindows = process.platform === "win32" && command === "pnpm";
  const result = isPnpmOnWindows
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", "pnpm", ...args], {
        cwd,
        encoding: "utf8",
        stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
      })
    : spawnSync(command, args, {
        cwd,
        encoding: "utf8",
        stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
      });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `${command} exited with ${result.status}`);
  return capture ? result.stdout : "";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  checkAgentQaIsolation(root).then(
    (result) => process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`),
    (error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
