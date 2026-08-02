#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { DESKTOP_SCENARIO_IDS } from "./desktop-qa-core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const artifactsRoot = path.resolve(
  process.env.VIBEGAL_AGENT_QA_ARTIFACTS ?? path.join(root, "artifacts/agent-qa/standalone"),
);
const results = [];

for (const scenario of DESKTOP_SCENARIO_IDS) {
  const startedAt = new Date().toISOString();
  const exitCode = await runScenario(scenario);
  results.push({
    scenario,
    startedAt,
    finishedAt: new Date().toISOString(),
    status: exitCode === 0 ? "passed" : "failed",
    exitCode,
  });
}

const matrixDir = path.join(artifactsRoot, "desktop", "scenarios");
await mkdir(matrixDir, { recursive: true });
await writeFile(path.join(matrixDir, "matrix.json"), `${JSON.stringify({
  schemaVersion: 1,
  scenarios: results,
}, null, 2)}\n`, "utf8");

process.exitCode = results.every((result) => result.status === "passed") ? 0 : 1;

function runScenario(scenario) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(root, "qa/agent/run-desktop.mjs"), "--scenario", scenario],
      {
        cwd: root,
        env: {
          ...process.env,
          VIBEGAL_AGENT_QA_SCENARIO: scenario,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}
