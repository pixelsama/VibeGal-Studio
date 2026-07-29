import assert from "node:assert/strict";
import test from "node:test";

import { buildDesktopInvocation } from "./build-desktop-core.mjs";

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
