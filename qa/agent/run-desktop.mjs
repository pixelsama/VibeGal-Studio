#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  buildDesktopPhasePlan,
  desktopArtifactDirectory,
  getDesktopScenarioDefinition,
  parseDesktopArgs,
  resolveDesktopSpec,
} from "./desktop-qa-core.mjs";
import {
  desktopQaBinaryPath,
  desktopQaBuildMarkerPath,
  resolveDesktopWebdriverPort,
  validateDesktopQaBuildMetadata,
} from "./build-desktop-core.mjs";
import { prepareAgentQaFixture } from "./fixture.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = parseDesktopArgs(process.argv.slice(2));
const definition = getDesktopScenarioDefinition(args.scenario);
const phases = buildDesktopPhasePlan(definition, { phase: args.phase });
const artifactsRoot = path.resolve(
  process.env.VIBEGAL_AGENT_QA_ARTIFACTS ?? path.join(root, "artifacts/agent-qa/standalone"),
);
const explicitScenario = process.argv.slice(2).includes("--scenario");
const scenarioArtifacts = desktopArtifactDirectory(artifactsRoot, args.scenario, {
  legacyCompatible: !explicitScenario,
});
await assertDesktopQaBinary(root);
const temporary = await mkdtemp(path.join(os.tmpdir(), `vibegal-agent-qa-${args.scenario}-`));
const configuredPort = process.env.VIBEGAL_AGENT_QA_WEBDRIVER_PORT ?? process.env.TAURI_WEBDRIVER_PORT;
await mkdir(scenarioArtifacts, { recursive: true });

let fixture;
let beforeMeta = null;
let exitCode = 1;
const phaseResults = [];
try {
  fixture = await prepareAgentQaFixture({
    root,
    temporary,
    scenarioId: args.scenario,
    fixtureProfile: args.fixtureProfile,
  });
  beforeMeta = await readOptionalMeta(fixture.projectPath);

  for (const phase of phases) {
    const startedAt = new Date().toISOString();
    const webdriverPort = configuredPort === undefined
      ? await allocateDesktopWebdriverPort()
      : resolveDesktopWebdriverPort(process.env);
    await assertDesktopWebdriverPortFree(webdriverPort);
    const phaseExitCode = await runWdio({
      projectPath: fixture.projectPath,
      projectParentPath: fixture.projectParentPath,
      projectName: fixture.projectName,
      initialTitle: fixture.initialTitle,
      // The legacy spec itself appends /desktop to this value. Keep its old
      // root unchanged; explicit scenarios receive their isolated root and
      // therefore write into <scenario>/desktop.
      artifacts: explicitScenario ? scenarioArtifacts : artifactsRoot,
      scenarioId: args.scenario,
      phase,
      spec: resolveDesktopSpec(root, definition),
      fixtureProfile: args.fixtureProfile,
      legacyCompatible: !explicitScenario,
      webdriverPort,
    });
    const result = {
      id: phase.id,
      restart: phase.restart,
      startedAt,
      finishedAt: new Date().toISOString(),
      exitCode: phaseExitCode,
      status: phaseExitCode === 0 ? "passed" : "failed",
    };
    phaseResults.push(result);
    if (phaseExitCode !== 0) {
      exitCode = phaseExitCode;
      break;
    }
  }

  const afterMeta = await readOptionalMeta(fixture.projectPath);
  await writeFile(path.join(scenarioArtifacts, "project-before-after.json"), `${JSON.stringify({
    schemaVersion: 1,
    scenario: args.scenario,
    fixtureProfile: args.fixtureProfile,
    projectPath: fixture.projectPath,
    before: beforeMeta ? JSON.parse(beforeMeta) : null,
    after: afterMeta ? JSON.parse(afterMeta) : null,
  }, null, 2)}\n`, "utf8");
  await writeFile(path.join(scenarioArtifacts, "phases.json"), `${JSON.stringify({
    schemaVersion: 1,
    scenario: args.scenario,
    projectPath: fixture.projectPath,
    phases: phaseResults,
  }, null, 2)}\n`, "utf8");
  if (phaseResults.length === phases.length && phaseResults.every((phase) => phase.status === "passed")) {
    exitCode = 0;
  }
} finally {
  if (process.env.VIBEGAL_AGENT_QA_KEEP_FIXTURE === "1") {
    process.stdout.write(`[agent-qa] fixture kept at ${fixture?.projectPath ?? temporary}\n`);
  } else {
    await rm(temporary, { recursive: true, force: true });
  }
}
process.exit(exitCode);

async function assertDesktopQaBinary(projectRoot) {
  const binary = desktopQaBinaryPath(projectRoot);
  const marker = desktopQaBuildMarkerPath(binary);
  try {
    const [binaryBytes, markerText] = await Promise.all([
      readFile(binary),
      readFile(marker, "utf8"),
    ]);
    validateDesktopQaBuildMetadata({
      binary,
      metadata: JSON.parse(markerText),
      actualSize: binaryBytes.length,
      actualSha256: createHash("sha256").update(binaryBytes).digest("hex"),
    });
  } catch (error) {
    if (error instanceof Error && /Desktop Agent QA binary/.test(error.message)) throw error;
    throw new Error(
      `Desktop Agent QA binary is not prepared at ${binary}; run node qa/agent/build-desktop.mjs first (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

async function allocateDesktopWebdriverPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!port) throw new Error("Unable to allocate a desktop WebDriver port");
  return port;
}

async function assertDesktopWebdriverPortFree(port) {
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (error) => {
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    socket.once("connect", () => finish(new Error(
      `Desktop WebDriver port ${port} is already in use; stop the stale Tauri/WDIO process or choose another port`,
    )));
    socket.once("error", () => finish());
  });
}

async function runWdio({
  projectPath,
  projectParentPath,
  projectName,
  initialTitle,
  artifacts: artifactsDir,
  scenarioId,
  phase,
  spec,
  fixtureProfile,
  legacyCompatible,
  webdriverPort,
}) {
  // Windows 上 pnpm 是 .cmd 批处理：spawn 直接执行会 EINVAL，经 cmd.exe 解释。
  const isPnpmOnWindows = process.platform === "win32";
  const command = isPnpmOnWindows ? "cmd.exe" : "pnpm";
  const commandArgs = isPnpmOnWindows
    ? ["/d", "/s", "/c", "pnpm", "exec", "wdio", "run", "qa/agent/wdio.conf.mjs"]
    : ["exec", "wdio", "run", "qa/agent/wdio.conf.mjs"];
  const child = spawn(command, commandArgs, {
    cwd: root,
    env: {
      ...process.env,
      VIBEGAL_AGENT_QA_PROJECT: projectPath,
      VIBEGAL_AGENT_QA_PROJECT_PARENT: projectParentPath,
      VIBEGAL_AGENT_QA_PROJECT_NAME: projectName,
      VIBEGAL_AGENT_QA_INITIAL_TITLE: initialTitle,
      VIBEGAL_AGENT_QA_ARTIFACTS: artifactsDir,
      VIBEGAL_AGENT_QA_SCENARIO: scenarioId,
      VIBEGAL_AGENT_QA_PHASE: phase.id,
      VIBEGAL_AGENT_QA_PHASE_INDEX: String(phase.index),
      VIBEGAL_AGENT_QA_FIXTURE_PROFILE: fixtureProfile,
      VIBEGAL_AGENT_QA_WEBDRIVER_PORT: String(webdriverPort),
      TAURI_WEBDRIVER_PORT: String(webdriverPort),
      VIBEGAL_AGENT_QA_SPEC: spec,
      VIBEGAL_AGENT_QA_LEGACY_COMPAT: legacyCompatible ? "1" : "0",
    },
    stdio: "inherit",
  });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

async function readOptionalMeta(projectPath) {
  try {
    return await readFile(path.join(projectPath, "content/meta.json"), "utf8");
  } catch {
    return null;
  }
}
