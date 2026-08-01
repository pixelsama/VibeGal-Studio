import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDesktopInvocation,
  desktopQaBuildMarkerPath,
  validateDesktopQaBuildMetadata,
  resolveDesktopWebdriverPort,
} from "./build-desktop-core.mjs";

test("desktop Agent build passes Tauri an absolute QA config path", () => {
  const invocation = buildDesktopInvocation("/workspace/project", { platform: "darwin" });

  assert.equal(invocation.command, "pnpm");
  assert.equal(invocation.cwd, "/workspace/project");
  assert.deepEqual(invocation.args, [
    "tauri",
    "build",
    "--debug",
    "--no-bundle",
    "--features",
    "agent-qa",
    "--config",
    "/workspace/project/packages/studio/src-tauri/tauri.agent-qa.conf.json",
    "--ci",
  ]);
});

test("desktop Agent build selects the platform pnpm executable", () => {
  assert.equal(buildDesktopInvocation("C:\\project", { platform: "win32" }).command, "pnpm.cmd");
});

test("desktop Agent run rejects a binary that is not the recorded QA build", () => {
  const binary = "/workspace/project/packages/studio/src-tauri/target/debug/vibegal-studio";
  assert.equal(
    desktopQaBuildMarkerPath(binary),
    "/workspace/project/packages/studio/src-tauri/target/debug/vibegal-studio.agent-qa.json",
  );
  assert.doesNotThrow(() => validateDesktopQaBuildMetadata({
    binary,
    metadata: { schemaVersion: 1, flavor: "agent-qa", size: 12, sha256: "abc" },
    actualSize: 12,
    actualSha256: "abc",
  }));
  assert.throws(
    () => validateDesktopQaBuildMetadata({
      binary,
      metadata: { schemaVersion: 1, flavor: "agent-qa", size: 12, sha256: "old" },
      actualSize: 12,
      actualSha256: "new",
    }),
    /stale|rebuild.*Agent QA/i,
  );
});

test("desktop Agent uses one explicit port for WebDriver and DirectEval", () => {
  assert.equal(resolveDesktopWebdriverPort({ VIBEGAL_AGENT_QA_WEBDRIVER_PORT: "4457" }), 4457);
  assert.equal(resolveDesktopWebdriverPort({ TAURI_WEBDRIVER_PORT: "4461" }), 4461);
  assert.equal(resolveDesktopWebdriverPort({}), 4445);
  assert.throws(
    () => resolveDesktopWebdriverPort({ VIBEGAL_AGENT_QA_WEBDRIVER_PORT: "not-a-port" }),
    /port/i,
  );
});
