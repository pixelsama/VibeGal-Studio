#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { prepareAgentQaFixture } from "./fixture.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const artifacts = path.resolve(process.env.VIBEGAL_AGENT_QA_ARTIFACTS ?? path.join(root, "artifacts/agent-qa/standalone"));
const desktopArtifacts = path.join(artifacts, "desktop");
const temporary = await mkdtemp(path.join(os.tmpdir(), "vibegal-agent-qa-"));
await mkdir(desktopArtifacts, { recursive: true });

let fixture;
let beforeMeta = "";
let exitCode = 1;
try {
  fixture = await prepareAgentQaFixture({ root, temporary });
  const metaFile = path.join(fixture.projectPath, "content/meta.json");
  beforeMeta = await readFile(metaFile, "utf8");
  exitCode = await runWdio({ ...fixture, artifacts });
  const afterMeta = await readFile(metaFile, "utf8");
  await writeFile(path.join(desktopArtifacts, "project-before-after.json"), `${JSON.stringify({
    projectPath: fixture.projectPath,
    before: JSON.parse(beforeMeta),
    after: JSON.parse(afterMeta),
  }, null, 2)}\n`, "utf8");
} finally {
  if (process.env.VIBEGAL_AGENT_QA_KEEP_FIXTURE === "1") {
    process.stdout.write(`[agent-qa] fixture kept at ${fixture?.projectPath ?? temporary}\n`);
  } else {
    await rm(temporary, { recursive: true, force: true });
  }
}
process.exit(exitCode);

async function runWdio({ projectPath, projectName, initialTitle, artifacts: artifactsDir }) {
  // Windows 上 pnpm 是 .cmd 批处理：spawn 直接执行会 EINVAL，经 cmd.exe 解释。
  const isPnpmOnWindows = process.platform === "win32";
  const child = isPnpmOnWindows
    ? spawn("cmd.exe", ["/d", "/s", "/c", "pnpm", "exec", "wdio", "run", "qa/agent/wdio.conf.mjs"], {
        cwd: root,
        env: {
          ...process.env,
          VIBEGAL_AGENT_QA_PROJECT: projectPath,
          VIBEGAL_AGENT_QA_PROJECT_NAME: projectName,
          VIBEGAL_AGENT_QA_INITIAL_TITLE: initialTitle,
          VIBEGAL_AGENT_QA_ARTIFACTS: artifactsDir,
        },
        stdio: "inherit",
      })
    : spawn("pnpm", ["exec", "wdio", "run", "qa/agent/wdio.conf.mjs"], {
        cwd: root,
        env: {
          ...process.env,
          VIBEGAL_AGENT_QA_PROJECT: projectPath,
          VIBEGAL_AGENT_QA_PROJECT_NAME: projectName,
          VIBEGAL_AGENT_QA_INITIAL_TITLE: initialTitle,
          VIBEGAL_AGENT_QA_ARTIFACTS: artifactsDir,
        },
        stdio: "inherit",
      });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}
