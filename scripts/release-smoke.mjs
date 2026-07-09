#!/usr/bin/env node
import { execSync } from "node:child_process";
import { join } from "node:path";

const cli = `cargo run --manifest-path ${join(
  "packages/studio/src-tauri/Cargo.toml",
)} --bin vibegal-cli validate`;

const projectRoot = process.cwd();
const examplesRoot = `${projectRoot}/examples`;

function expectCode(command, expectedCode) {
  try {
    execSync(command, { stdio: "inherit" });
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
