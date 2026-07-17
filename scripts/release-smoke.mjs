#!/usr/bin/env node
import { execSync } from "node:child_process";
import { join } from "node:path";

/**
 * Windows 上优先使用已安装的 MSVC Rust 工具链。
 *
 * 背景：rustup 默认工具链若是 windows-gnu 且安装不完整（缺 dlltool.exe），
 * 重新编译 getrandom 等依赖时会直接失败；而本仓库的 Tauri 依赖在 MSVC 下
 * 才是 Windows CI 使用的形态。这里只在「机器上确实装了 MSVC 工具链」时
 * 通过 RUSTUP_TOOLCHAIN 切换，其余平台/环境保持默认行为。
 */
function detectWindowsMsvcToolchain() {
  if (process.platform !== "win32") return null;
  let output;
  try {
    output = execSync("rustup toolchain list", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
  const names = output
    .split(/\r?\n/)
    .map((line) => line.replace(/\s*\([^)]*\)\s*$/, "").trim())
    .filter(Boolean);
  const msvc = names.filter((name) => name.endsWith("-pc-windows-msvc"));
  return msvc.find((name) => name.startsWith("stable-")) ?? msvc[0] ?? null;
}

const msvcToolchain = detectWindowsMsvcToolchain();
const cargoEnv = msvcToolchain
  ? { ...process.env, RUSTUP_TOOLCHAIN: msvcToolchain }
  : process.env;
if (msvcToolchain) {
  console.log(`[release-smoke] Windows 检测到 MSVC Rust 工具链，使用: ${msvcToolchain}`);
}

const cli = `cargo run --manifest-path ${join(
  "packages/studio/src-tauri/Cargo.toml",
)} --bin vibegal-cli validate`;

const projectRoot = process.cwd();
const examplesRoot = `${projectRoot}/examples`;

function expectCode(command, expectedCode) {
  try {
    execSync(command, { stdio: "inherit", env: cargoEnv });
    if (expectedCode !== 0) {
      throw new Error(`命令 "${command}" 预期返回码 ${expectedCode}，实际为 0`);
    }
    return;
  } catch (error) {
    const code = typeof error.status === "number" ? error.status : 1;
    if (code !== expectedCode) {
      throw new Error(`命令 "${command}" 预期返回码 ${expectedCode}，实际为 ${code}`);
    }
  }
}

expectCode(`${cli} ${examplesRoot}/sample-novel --format json`, 0);
expectCode(`${cli} ${examplesRoot}/broken-projects/missing-node-file --format json`, 2);
expectCode(`${cli} ${examplesRoot}/broken-projects/dangling-edge --format json`, 2);

console.log("Smoke 路径执行通过（clean sample exit 0，broken samples exit 非 0）。");
