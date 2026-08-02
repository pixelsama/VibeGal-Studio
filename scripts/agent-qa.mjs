#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  agentQaHelp,
  buildAgentQaPlan,
  createAgentQaReport,
  parseAgentQaArgs,
  redactAgentQaText,
  renderAgentQaHtml,
  selectAgentQaPlan,
} from "./agent-qa-core.mjs";

const root = path.resolve(import.meta.dirname, "..");
let options;
try {
  options = parseAgentQaArgs(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${agentQaHelp()}`);
  process.exit(2);
}

if (options.help) {
  process.stdout.write(agentQaHelp());
  process.exit(0);
}

const startedAt = new Date();
const runId = `${compactTimestamp(startedAt)}-${process.pid}`;
const artifactsDir = options.artifactsDir ?? path.join(root, "artifacts", "agent-qa", runId);
const fullPlan = buildAgentQaPlan(options.suite, {
  artifactsDir,
  scenario: options.scenario,
});
const selectedIds = new Set(options.only);
let plan;
try {
  plan = selectAgentQaPlan(fullPlan, options.only);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
}

if (options.list) {
  process.stdout.write(`${JSON.stringify({ suite: options.suite, artifactsDir, steps: plan }, null, 2)}\n`);
  process.exit(0);
}

await mkdir(path.join(artifactsDir, "logs"), { recursive: true });
const results = [];
const statusById = new Map();

for (const step of plan) {
  const blockedBy = step.dependencies.filter((dependency) => {
    if (selectedIds.size > 0 && !selectedIds.has(dependency)) return false;
    return statusById.get(dependency) !== "passed";
  });
  if (blockedBy.length > 0) {
    const result = skippedStep(step, `blocked by ${blockedBy.join(", ")}`);
    results.push(result);
    statusById.set(step.id, result.status);
    await writeReport();
    continue;
  }
  if (options.dryRun) {
    const result = skippedStep(step, "dry run", "not-run");
    results.push(result);
    statusById.set(step.id, result.status);
    await writeReport();
    continue;
  }

  const result = await runStep(step);
  results.push(result);
  statusById.set(step.id, result.status);
  await writeReport();
}

const report = await writeReport();
process.stdout.write(`${JSON.stringify({
  kind: report.kind,
  suite: report.suite,
  runId: report.runId,
  status: report.status,
  exitCode: report.exitCode,
  summary: path.join(artifactsDir, "summary.json"),
  html: path.join(artifactsDir, "report.html"),
}, null, 2)}\n`);
process.exitCode = report.exitCode;

async function runStep(step) {
  const started = new Date();
  const logRelative = `logs/${step.id}.log`;
  const logPath = path.join(artifactsDir, logRelative);
  const [command, ...args] = step.command;
  process.stdout.write(`\n[agent-qa] ${step.id}: ${[command, ...args].join(" ")}\n`);
  let output = "";
  let timedOut = false;
  // Windows 上 pnpm 是 .cmd 批处理：spawn 直接执行会 EINVAL，经 cmd.exe 解释。
  const isPnpmOnWindows = process.platform === "win32" && (command === "pnpm" || command === "pnpm.cmd");
  const child = isPnpmOnWindows
    ? spawn("cmd.exe", ["/d", "/s", "/c", "pnpm", ...args], {
        cwd: root,
        env: {
          ...process.env,
          VIBEGAL_AGENT_QA: "1",
          VIBEGAL_AGENT_QA_ARTIFACTS: artifactsDir,
          VIBEGAL_AGENT_QA_RUN_ID: runId,
        },
        stdio: ["ignore", "pipe", "pipe"],
      })
    : spawn(platformCommand(command), args, {
        cwd: root,
        env: {
          ...process.env,
          VIBEGAL_AGENT_QA: "1",
          VIBEGAL_AGENT_QA_ARTIFACTS: artifactsDir,
          VIBEGAL_AGENT_QA_RUN_ID: runId,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
  const append = (chunk, destination) => {
    const text = chunk.toString();
    output += text;
    destination.write(text);
  };
  child.stdout.on("data", (chunk) => append(chunk, process.stdout));
  child.stderr.on("data", (chunk) => append(chunk, process.stderr));
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    setTimeout(() => child.exitCode == null && child.kill("SIGKILL"), 2_000).unref();
  }, step.timeoutMs);
  const outcome = await new Promise((resolve) => {
    child.once("error", (error) => resolve({ code: 1, error }));
    child.once("exit", (code, signal) => resolve({ code: code ?? 1, signal }));
  });
  clearTimeout(timeout);
  const finished = new Date();
  await writeFile(logPath, redactAgentQaText(output), "utf8");
  const status = timedOut ? "timed-out" : outcome.code === 0 ? "passed" : "failed";
  return {
    id: step.id,
    status,
    command: step.command,
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    durationMs: finished.getTime() - started.getTime(),
    exitCode: outcome.code,
    ...(outcome.signal ? { signal: outcome.signal } : {}),
    log: logRelative,
    evidence: [logRelative, ...step.evidence],
    ...(status === "passed" ? {} : {
      error: timedOut
        ? `step exceeded ${step.timeoutMs}ms`
        : outcome.error instanceof Error
          ? outcome.error.message
          : `command exited with ${outcome.code}`,
    }),
  };
}

function skippedStep(step, reason, status = "skipped") {
  const now = new Date().toISOString();
  return {
    id: step.id,
    status,
    command: step.command,
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    exitCode: null,
    log: null,
    evidence: step.evidence,
    error: reason,
  };
}

async function writeReport() {
  const report = createAgentQaReport({
    suite: options.suite,
    runId,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    artifactsDir,
    environment: {
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
      hostname: os.hostname(),
      ci: process.env.CI === "true",
    },
    steps: results,
  });
  await Promise.all([
    writeFile(path.join(artifactsDir, "summary.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    writeFile(path.join(artifactsDir, "report.html"), renderAgentQaHtml(report), "utf8"),
  ]);
  return report;
}

function platformCommand(command) {
  return process.platform === "win32" && (command === "pnpm" || command === "pnpm.cmd") ? "pnpm.cmd" : command;
}

function compactTimestamp(value) {
  return value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
