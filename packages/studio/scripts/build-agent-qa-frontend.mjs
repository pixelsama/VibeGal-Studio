#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
run("pnpm", ["build"], { VITE_AGENT_QA: "1" });
run("node", ["scripts/prepare-web-exporter.mjs"]);

function run(command, args, extraEnv = {}) {
  const executable = process.platform === "win32" && command === "pnpm" ? "pnpm.cmd" : command;
  const result = spawnSync(executable, args, {
    cwd: studioRoot,
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
