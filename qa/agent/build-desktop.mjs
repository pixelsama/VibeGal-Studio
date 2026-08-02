#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { buildDesktopInvocation, desktopQaBinaryPath, desktopQaBuildMarkerPath } from "./build-desktop-core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const artifacts = path.resolve(process.env.VIBEGAL_AGENT_QA_ARTIFACTS ?? path.join(root, "artifacts/agent-qa/standalone"));
const binary = desktopQaBinaryPath(root);

run(buildDesktopInvocation(root));

const bytes = await readFile(binary);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const metadata = {
  schemaVersion: 1,
  flavor: "agent-qa",
  binary,
  size: bytes.length,
  sha256,
};
await writeFile(desktopQaBuildMarkerPath(binary), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
await mkdir(path.join(artifacts, "desktop"), { recursive: true });
await writeFile(path.join(artifacts, "desktop/build.json"), `${JSON.stringify({
  ...metadata,
  marker: desktopQaBuildMarkerPath(binary),
}, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ ok: true, binary })}\n`);

function run({ command, args, cwd }) {
  // Windows 上 pnpm 是 .cmd 批处理：spawnSync 直接执行会 EINVAL，
  // 用显式 cmd.exe /d /s /c 解释（shell: true 的拼接在本机也触发 EINVAL）。
  const isPnpmOnWindows = process.platform === "win32" && (command === "pnpm" || command === "pnpm.cmd");
  const result = isPnpmOnWindows
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", "pnpm", ...args], { cwd, env: process.env, stdio: "inherit" })
    : spawnSync(command, args, { cwd, env: process.env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
