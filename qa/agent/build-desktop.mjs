#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { buildDesktopInvocation } from "./build-desktop-core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const artifacts = path.resolve(process.env.VIBEGAL_AGENT_QA_ARTIFACTS ?? path.join(root, "artifacts/agent-qa/standalone"));
const binary = path.join(
  root,
  "packages/studio/src-tauri/target/debug",
  process.platform === "win32" ? "vibegal-studio.exe" : "vibegal-studio",
);

run(buildDesktopInvocation(root));

const bytes = await readFile(binary);
await mkdir(path.join(artifacts, "desktop"), { recursive: true });
await writeFile(path.join(artifacts, "desktop/build.json"), `${JSON.stringify({
  schemaVersion: 1,
  flavor: "agent-qa",
  binary,
  size: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
}, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ ok: true, binary })}\n`);

function run({ command, args, cwd }) {
  // Windows 上 pnpm 是 .cmd 批处理：spawnSync 直接执行会 EINVAL，须经 shell 解释。
  const isPnpmOnWindows = process.platform === "win32" && command === "pnpm";
  const executable = isPnpmOnWindows ? "pnpm.cmd" : command;
  const result = spawnSync(executable, args, { cwd, env: process.env, stdio: "inherit", shell: isPnpmOnWindows });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
