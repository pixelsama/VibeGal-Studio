import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyCodexRun,
  codexRunRequiresOutput,
  createSerialRunner,
  parseCodexDispatcherArgs,
} from "./codex-mailbox-dispatcher-core.mjs";

test("Codex dispatcher resolves its workspace config from the current worktree", () => {
  assert.deepEqual(parseCodexDispatcherArgs(["--config", "/workspace/exchange/workspace.json"]), {
    configPath: "/workspace/exchange/workspace.json",
    once: false,
    dryRun: false,
  });
  assert.equal(parseCodexDispatcherArgs(["--config", "/workspace/config.json", "--once"]).once, true);
  assert.equal(
    parseCodexDispatcherArgs(["--config", "../exchange/workspace.json"], "/workspace/test").configPath,
    "/workspace/exchange/workspace.json",
  );
  assert.throws(() => parseCodexDispatcherArgs([]), /--config is required/i);
});

test("Codex claims are archived only after a successful structured completion", () => {
  assert.deepEqual(classifyCodexRun({ exitCode: 0, result: { status: "completed", summary: "done", outputMessageIds: ["result-1"] } }), {
    mailboxState: "archive",
    status: "completed",
  });
  assert.deepEqual(classifyCodexRun({ exitCode: 0, result: { status: "blocked", summary: "missing auth", outputMessageIds: [] } }), {
    mailboxState: "failed",
    status: "blocked",
  });
  assert.deepEqual(classifyCodexRun({ exitCode: 1, result: null }), {
    mailboxState: "failed",
    status: "process_failed",
  });
  assert.deepEqual(classifyCodexRun({ exitCode: 0, result: { status: "completed", summary: "done" } }), {
    mailboxState: "failed",
    status: "invalid_result",
  });
  assert.deepEqual(classifyCodexRun({
    exitCode: 0,
    result: { status: "completed", summary: "done", outputMessageIds: ["result-1"] },
    outputsVerified: false,
  }), {
    mailboxState: "failed",
    status: "missing_output_message",
  });
  assert.deepEqual(classifyCodexRun({
    exitCode: 0,
    result: { status: "completed", summary: "pass acknowledged", outputMessageIds: [] },
    requiresOutput: false,
  }), {
    mailboxState: "archive",
    status: "completed",
  });
  assert.deepEqual(classifyCodexRun({
    exitCode: 0,
    result: { status: "completed", summary: "missing result", outputMessageIds: [] },
    requiresOutput: true,
  }), {
    mailboxState: "failed",
    status: "invalid_result",
  });
});

test("only passed test results are terminal acknowledgements without a new mailbox message", () => {
  assert.equal(codexRunRequiresOutput({ type: "test_request" }), true);
  assert.equal(codexRunRequiresOutput({ type: "test_result", status: "failed" }), true);
  assert.equal(codexRunRequiresOutput({ type: "test_result", status: "stale" }), true);
  assert.equal(codexRunRequiresOutput({ type: "test_result", status: "blocked" }), true);
  assert.equal(codexRunRequiresOutput({ type: "test_result", status: "passed" }), false);
});

test("filesystem bursts share one active Codex drain", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const run = createSerialRunner(async () => {
    calls += 1;
    await gate;
    return "done";
  });

  const first = run();
  const second = run();
  assert.equal(calls, 0);
  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  assert.equal(await first, "done");
  assert.equal(await second, "done");
  assert.equal(calls, 1);
});
