#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
run("pnpm", ["build"], { VITE_AGENT_QA: "1" });
run("node", ["scripts/prepare-web-exporter.mjs"]);

function run(command, args, extraEnv = {}) {
  // Windows 上 pnpm 是 .cmd 批处理：spawnSync 直接执行会 EINVAL，
  // 用显式 cmd.exe /d /s /c 解释。
  const isPnpmOnWindows = process.platform === "win32" && (command === "pnpm" || command === "pnpm.cmd");
  const result = isPnpmOnWindows
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", "pnpm", ...args], {
        cwd: studioRoot,
        env: { ...process.env, ...extraEnv },
        encoding: "utf8",
        stdio: "inherit",
      })
    : spawnSync(command, args, {
        cwd: studioRoot,
        env: { ...process.env, ...extraEnv },
        encoding: "utf8",
        stdio: "inherit",
      });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
