#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const commands = [
  ["pnpm", ["test"]],
  ["pnpm", ["build"]],
  ["pnpm", ["check:versions"]],
  ["pnpm", ["check:schemas"]],
  ["pnpm", ["check:engine-types"]],
  ["pnpm", ["check:renderer-template"]],
  ["pnpm", ["check:example-template"]],
  ["pnpm", ["check:doc-contract"]],
  ["cargo", ["test", "--locked", "--manifest-path", "packages/studio/src-tauri/Cargo.toml"]],
];

for (const [command, args] of commands) {
  const executable = process.platform === "win32" && command === "pnpm" ? "pnpm.cmd" : command;
  const result = spawnSync(executable, args, { cwd: root, env: process.env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
