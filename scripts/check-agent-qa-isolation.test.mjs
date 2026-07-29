import assert from "node:assert/strict";
import test from "node:test";

import {
  agentQaLeakInFiles,
  validateAgentQaCargoPackage,
  validateAgentQaTauriConfig,
} from "./check-agent-qa-isolation.mjs";

const validPackage = {
  features: {
    "agent-qa": [
      "dep:tauri-plugin-wdio",
      "dep:tauri-plugin-wdio-webdriver",
    ],
  },
  dependencies: [
    { name: "tauri-plugin-wdio", optional: true },
    { name: "tauri-plugin-wdio-webdriver", optional: true },
  ],
};

test("Agent QA Cargo dependencies are optional and feature gated", () => {
  assert.doesNotThrow(() => validateAgentQaCargoPackage(validPackage));
  assert.throws(
    () => validateAgentQaCargoPackage({ ...validPackage, features: {} }),
    /agent-qa feature/i,
  );
  assert.throws(
    () => validateAgentQaCargoPackage({
      ...validPackage,
      dependencies: validPackage.dependencies.map((dependency) => (
        dependency.name === "tauri-plugin-wdio" ? { ...dependency, optional: false } : dependency
      )),
    }),
    /must be optional/i,
  );
});

test("production frontend scan rejects WDIO test bridge markers", () => {
  assert.equal(agentQaLeakInFiles([
    { path: "dist/assets/index.js", content: "console.log('production')" },
  ]), null);
  assert.deepEqual(agentQaLeakInFiles([
    { path: "dist/assets/index.js", content: "window.wdioTauri = {}" },
  ]), {
    path: "dist/assets/index.js",
    marker: "wdioTauri",
  });
});

test("Agent QA uses a distinct application identifier for settings isolation", () => {
  assert.doesNotThrow(() => validateAgentQaTauriConfig(
    { identifier: "com.vibegal.studio.agent-qa" },
    { identifier: "com.vibegal.studio" },
  ));
  assert.throws(
    () => validateAgentQaTauriConfig(
      { identifier: "com.vibegal.studio" },
      { identifier: "com.vibegal.studio" },
    ),
    /distinct application identifier/i,
  );
});
