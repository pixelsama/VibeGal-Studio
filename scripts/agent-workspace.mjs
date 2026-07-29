#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { initializeExchange } from "./agent-mailbox-core.mjs";
import {
  agentWorkspaceHelp,
  buildAgentWorkspacePlan,
  parseAgentWorkspaceArgs,
  renderLaunchAgentPlist,
} from "./agent-workspace-core.mjs";

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));

try {
  const options = parseAgentWorkspaceArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(agentWorkspaceHelp());
    process.exit(0);
  }
  const plan = buildAgentWorkspacePlan(options);
  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exit(0);
  }
  const result = await setupWorkspace(plan, { installService: options.installService });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`[agent-workspace] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(2);
}

async function setupWorkspace(plan, { installService }) {
  await assertSourceRepository(plan.repositoryRoot);
  await mkdir(plan.workspaceRoot, { recursive: true });
  const originUrl = await gitOutput(["remote", "get-url", "origin"], { cwd: plan.repositoryRoot });
  await ensureBareStore(plan, originUrl);

  for (const spec of plan.worktrees) {
    await ensureBranch(plan.gitDir, spec.branch, spec.startPoint);
    await ensureWorktree(plan.gitDir, spec);
  }

  await initializeExchange(plan.exchangeRoot);
  await installRuntime(plan);
  const codexPath = await findExecutable("codex");
  const service = serviceMetadata(plan.workspaceRoot);
  const config = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    workspaceRoot: plan.workspaceRoot,
    exchangeRoot: plan.exchangeRoot,
    repositoryGitDir: plan.gitDir,
    worktrees: Object.fromEntries(plan.worktrees.map((spec) => [spec.slot, spec.path])),
    branches: Object.fromEntries(plan.worktrees.map((spec) => [spec.slot, spec.branch])),
    codex: {
      binary: codexPath,
      timeoutMs: 3 * 60 * 60_000,
      staleAfterMs: 6 * 60 * 60_000,
      claimHeartbeatMs: 30_000,
      reconcileIntervalMs: 60_000,
      daemonHeartbeatMs: 10 * 60_000,
    },
    service,
  };
  const configPath = path.join(plan.exchangeRoot, "workspace.json");
  await writeJsonAtomically(configPath, config);

  let serviceStatus = "not-installed";
  if (installService) {
    await installLaunchAgent({ plan, configPath, service });
    serviceStatus = "running";
  }
  return {
    status: "ready",
    workspaceRoot: plan.workspaceRoot,
    configPath,
    service: serviceStatus,
    worktrees: config.worktrees,
    branches: config.branches,
  };
}

async function assertSourceRepository(repositoryRoot) {
  const inside = await gitOutput(["rev-parse", "--is-inside-work-tree"], { cwd: repositoryRoot });
  if (inside !== "true") throw new Error(`${repositoryRoot} is not a Git worktree`);
  const status = await gitOutput(["status", "--short"], { cwd: repositoryRoot });
  if (status) throw new Error("Source worktree must be clean before creating the Agent workspace");
  await gitOutput(["rev-parse", "--verify", "refs/heads/main^{commit}"], { cwd: repositoryRoot });
}

async function ensureBareStore(plan, originUrl) {
  if (!(await exists(plan.gitDir))) {
    await run("git", ["clone", "--bare", "--no-hardlinks", plan.repositoryRoot, plan.gitDir]);
  } else {
    const bare = await gitOutput(["--git-dir", plan.gitDir, "rev-parse", "--is-bare-repository"]);
    if (bare !== "true") throw new Error(`${plan.gitDir} exists but is not a bare Git repository`);
  }
  await run("git", ["--git-dir", plan.gitDir, "remote", "set-url", "origin", originUrl]);
  await run("git", ["--git-dir", plan.gitDir, "config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"]);
  await run("git", ["--git-dir", plan.gitDir, "config", "branch.main.remote", "origin"]);
  await run("git", ["--git-dir", plan.gitDir, "config", "branch.main.merge", "refs/heads/main"]);
}

async function ensureBranch(gitDir, branch, startPoint) {
  if (await gitRefExists(gitDir, `refs/heads/${branch}`)) return;
  await run("git", ["--git-dir", gitDir, "branch", branch, startPoint]);
}

async function ensureWorktree(gitDir, spec) {
  if (await exists(spec.path)) {
    const entries = await readdir(spec.path);
    if (entries.length === 0) {
      await rm(spec.path, { recursive: true });
    } else {
      const current = await gitOutput(["branch", "--show-current"], { cwd: spec.path }).catch(() => null);
      if (current === null) throw new Error(`${spec.path} exists and is not a Git worktree`);
      if (current === spec.branch) return;
      if (spec.persistent) throw new Error(`${spec.slot} worktree must stay on ${spec.branch}; found ${current || "detached HEAD"}`);
      const status = await gitOutput(["status", "--short"], { cwd: spec.path });
      if (status) throw new Error(`dev worktree has uncommitted changes on ${current || "detached HEAD"}`);
      await run("git", ["switch", spec.branch], { cwd: spec.path });
      return;
    }
  }
  await run("git", ["--git-dir", gitDir, "worktree", "add", spec.path, spec.branch]);
}

async function installRuntime(plan) {
  const runtimeDir = path.join(plan.exchangeRoot, "runtime", "codex");
  const schemaDir = path.join(plan.exchangeRoot, "schemas");
  await mkdir(path.join(runtimeDir, "logs"), { recursive: true });
  await mkdir(schemaDir, { recursive: true });
  for (const filename of [
    "agent-mailbox-core.mjs",
    "agent-mailbox.mjs",
    "codex-mailbox-dispatcher-core.mjs",
    "codex-mailbox-dispatcher.mjs",
  ]) {
    await copyFile(path.join(scriptDir, filename), path.join(runtimeDir, filename));
  }
  const sourceSchemas = path.resolve(scriptDir, "..", "qa", "agent-mailbox", "schemas");
  for (const entry of await readdir(sourceSchemas, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".json")) {
      await copyFile(path.join(sourceSchemas, entry.name), path.join(schemaDir, entry.name));
    }
  }
  await copyFile(path.resolve(scriptDir, "..", "docs", "agent-workflow.md"), path.join(plan.exchangeRoot, "PROTOCOL.md"));
}

async function installLaunchAgent({ plan, configPath, service }) {
  if (process.platform !== "darwin") throw new Error("Codex LaunchAgent installation is only supported on macOS");
  const logsDir = path.join(plan.exchangeRoot, "runtime", "codex", "logs");
  await mkdir(logsDir, { recursive: true });
  await mkdir(path.dirname(service.plistPath), { recursive: true });
  const plist = renderLaunchAgentPlist({
    label: service.label,
    nodePath: process.execPath,
    dispatcherPath: path.join(plan.exchangeRoot, "runtime", "codex", "codex-mailbox-dispatcher.mjs"),
    configPath,
    stdoutPath: path.join(logsDir, "dispatcher.log"),
    stderrPath: path.join(logsDir, "dispatcher.error.log"),
    environmentPath: process.env.PATH,
  });
  await writeTextAtomically(service.plistPath, plist);
  const domain = `gui/${process.getuid()}`;
  await execFileAsync("launchctl", ["bootout", domain, service.plistPath]).catch(() => undefined);
  await run("launchctl", ["bootstrap", domain, service.plistPath]);
  await run("launchctl", ["enable", `${domain}/${service.label}`]);
  await run("launchctl", ["kickstart", "-k", `${domain}/${service.label}`]);
}

function serviceMetadata(workspaceRoot) {
  const suffix = createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 10);
  const label = `com.vibegal.studio.codex-mailbox.${suffix}`;
  return {
    label,
    plistPath: path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`),
  };
}

async function findExecutable(name) {
  const configured = process.env.VIBEGAL_CODEX_BIN;
  if (configured) {
    if (!path.isAbsolute(configured)) throw new Error("VIBEGAL_CODEX_BIN must be absolute");
    return configured;
  }
  return gitOutput(["-lc", `command -v ${name}`], { command: "/bin/zsh" });
}

async function gitRefExists(gitDir, ref) {
  try {
    await gitOutput(["--git-dir", gitDir, "show-ref", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
}

async function gitOutput(args, { cwd, command = "git" } = {}) {
  const { stdout } = await execFileAsync(command, args, { cwd, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  return stdout.trim();
}

async function run(command, args, options = {}) {
  await execFileAsync(command, args, { ...options, maxBuffer: 10 * 1024 * 1024 });
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function writeJsonAtomically(target, value) {
  await writeTextAtomically(target, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeTextAtomically(target, value) {
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, value, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
}
