#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function parseTomlVersion(path) {
  const text = readFileSync(path, "utf8");
  const match = text.match(/^\s*version\s*=\s*"([^"]+)"\s*$/m);
  if (!match) {
    throw new Error(`无法从 ${path} 读取 version`);
  }
  return match[1];
}

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const targets = [
  {
    name: "root package.json",
    version: loadJson(resolve(workspaceRoot, "package.json")).version,
  },
  {
    name: "studio package.json",
    version: loadJson(resolve(workspaceRoot, "packages/studio/package.json")).version,
  },
  {
    name: "engine package.json",
    version: loadJson(resolve(workspaceRoot, "packages/engine/package.json")).version,
  },
  {
    name: "src-tauri/Cargo.toml",
    version: parseTomlVersion(resolve(workspaceRoot, "packages/studio/src-tauri/Cargo.toml")),
  },
  {
    name: "src-tauri/tauri.conf.json",
    version: loadJson(
      resolve(workspaceRoot, "packages/studio/src-tauri/tauri.conf.json"),
    ).version,
  },
];

const expected = targets[0].version;
const invalid = targets.filter((target) => target.version !== expected);
if (invalid.length === 0) {
  process.stdout.write(`版本一致：${expected}\n`);
  process.exit(0);
}

process.stderr.write("版本不一致：\n");
for (const target of invalid) {
  process.stderr.write(`- ${target.name}: ${target.version}\n`);
}
process.stderr.write(`应统一为：${expected}\n`);
process.exit(1);
