import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  assertLaunchAgentWorkspaceAccessible,
  buildAgentWorkspacePlan,
  parseAgentWorkspaceArgs,
  renderLaunchAgentPlist,
} from "./agent-workspace-core.mjs";

const execFileAsync = promisify(execFile);

test("workspace plan keeps worktrees and exchange as sibling slots", () => {
  const plan = buildAgentWorkspacePlan({
    repositoryRoot: "/projects/galstudio",
    workspaceRoot: "/projects/galstudio-workspace",
    featureBranch: "codex/agent-orchestration",
    featureStart: "codex/agent-qa-pipeline",
  });

  assert.deepEqual(plan.worktrees, [
    { slot: "main", path: "/projects/galstudio-workspace/main", branch: "main", startPoint: "main", persistent: true },
    { slot: "test", path: "/projects/galstudio-workspace/test", branch: "test", startPoint: "main", persistent: true },
    {
      slot: "dev",
      path: "/projects/galstudio-workspace/dev",
      branch: "codex/agent-orchestration",
      startPoint: "codex/agent-qa-pipeline",
      persistent: false,
    },
  ]);
  assert.equal(plan.exchangeRoot, "/projects/galstudio-workspace/exchange");
});

test("workspace root may not be nested inside the source worktree", () => {
  assert.throws(
    () => buildAgentWorkspacePlan({
      repositoryRoot: "/projects/galstudio",
      workspaceRoot: "/projects/galstudio/workspace",
      featureBranch: "feature/example",
      featureStart: "main",
    }),
    /must not be nested/i,
  );
});

test("workspace CLI requires a named feature branch and resolves paths", () => {
  assert.deepEqual(
    parseAgentWorkspaceArgs([
      "setup",
      "--",
      "--workspace", "../galstudio-workspace",
      "--feature-branch", "feature/example",
      "--feature-start", "main",
    ], "/projects/galstudio"),
    {
      command: "setup",
      repositoryRoot: "/projects/galstudio",
      workspaceRoot: path.resolve("/projects/galstudio", "../galstudio-workspace"),
      featureBranch: "feature/example",
      featureStart: "main",
      workspaceLink: null,
      installService: false,
      dryRun: false,
    },
  );
  assert.throws(
    () => parseAgentWorkspaceArgs(["--workspace", "../workspace"], "/projects/galstudio"),
    /--feature-branch is required/i,
  );
});

test("macOS LaunchAgent refuses privacy-protected workspace roots", () => {
  assert.throws(
    () => assertLaunchAgentWorkspaceAccessible("/Users/alice/Documents/project-workspace", {
      platform: "darwin",
      homeDirectory: "/Users/alice",
    }),
    /privacy-protected.*--link/i,
  );
  assert.doesNotThrow(() => assertLaunchAgentWorkspaceAccessible("/Users/alice/.local/share/project-workspace", {
    platform: "darwin",
    homeDirectory: "/Users/alice",
  }));
  assert.doesNotThrow(() => assertLaunchAgentWorkspaceAccessible("/Users/alice/Documents/project-workspace", {
    platform: "linux",
    homeDirectory: "/Users/alice",
  }));
});

test("LaunchAgent plist starts only the installed Codex mailbox runtime", () => {
  const plist = renderLaunchAgentPlist({
    label: "com.vibegal.codex-mailbox.test",
    nodePath: "/opt/homebrew/bin/node",
    dispatcherPath: "/workspace/exchange/runtime/codex-mailbox-dispatcher.mjs",
    configPath: "/workspace/exchange/workspace.json",
    stdoutPath: "/workspace/exchange/runtime/logs/dispatcher.log",
    stderrPath: "/workspace/exchange/runtime/logs/dispatcher.error.log",
  });

  assert.match(plist, /<string>\/opt\/homebrew\/bin\/node<\/string>/);
  assert.match(plist, /<string>--config<\/string>/);
  assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.doesNotMatch(plist, /dangerously-bypass/);
});

test("workspace setup creates a shared bare store and three real worktrees", async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "vibegal-agent-workspace-"));
  const repositoryRoot = path.join(fixtureRoot, "source");
  const workspaceRoot = path.join(fixtureRoot, "workspace");
  const workspaceLink = path.join(fixtureRoot, "visible-workspace");
  await execFileAsync("git", ["init", "--initial-branch=main", repositoryRoot]);
  await writeFile(path.join(repositoryRoot, "README.md"), "fixture\n");
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "Agent Workspace Test",
    GIT_AUTHOR_EMAIL: "agent@example.invalid",
    GIT_COMMITTER_NAME: "Agent Workspace Test",
    GIT_COMMITTER_EMAIL: "agent@example.invalid",
  };
  await execFileAsync("git", ["add", "README.md"], { cwd: repositoryRoot, env: gitEnv });
  await execFileAsync("git", ["commit", "-m", "fixture"], { cwd: repositoryRoot, env: gitEnv });
  await execFileAsync("git", ["branch", "feature/example"], { cwd: repositoryRoot });
  await execFileAsync("git", ["remote", "add", "origin", "https://example.invalid/project.git"], { cwd: repositoryRoot });

  const script = new URL("agent-workspace.mjs", import.meta.url);
  const { stdout } = await execFileAsync(process.execPath, [
    script.pathname,
    "setup",
    "--repo", repositoryRoot,
    "--workspace", workspaceRoot,
    "--link", workspaceLink,
    "--feature-branch", "feature/example",
    "--feature-start", "main",
  ]);
  const result = JSON.parse(stdout);

  assert.equal(result.status, "ready");
  assert.equal(await gitBranch(path.join(workspaceRoot, "main")), "main");
  assert.equal(await gitBranch(path.join(workspaceRoot, "test")), "test");
  assert.equal(await gitBranch(path.join(workspaceRoot, "dev")), "feature/example");
  assert.equal((await execFileAsync("git", ["--git-dir", path.join(workspaceRoot, ".git-store"), "rev-parse", "--is-bare-repository"])).stdout.trim(), "true");
  assert.equal((await execFileAsync("git", ["config", "branch.main.remote"], { cwd: path.join(workspaceRoot, "main") })).stdout.trim(), "origin");
  assert.equal((await execFileAsync("git", ["config", "branch.main.merge"], { cwd: path.join(workspaceRoot, "main") })).stdout.trim(), "refs/heads/main");
  const config = JSON.parse(await readFile(path.join(workspaceRoot, "exchange", "workspace.json"), "utf8"));
  assert.equal(config.worktrees.test, path.join(workspaceRoot, "test"));
  await stat(path.join(workspaceRoot, "exchange", "runtime", "codex", "codex-mailbox-dispatcher.mjs"));
  await stat(path.join(workspaceRoot, "exchange", "PROTOCOL.md"));
  assert.equal((await stat(workspaceLink)).isDirectory(), true);
});

async function gitBranch(worktree) {
  return (await execFileAsync("git", ["branch", "--show-current"], { cwd: worktree })).stdout.trim();
}
