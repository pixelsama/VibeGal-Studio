import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { prepareAgentQaFixture } from "./fixture.mjs";

const root = path.resolve(import.meta.dirname, "../..");

test("Agent QA copies the sample into an isolated path and seeds deterministic titles", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "vibegal-agent-qa-fixture-test-"));
  try {
    const originalMetaPath = path.join(root, "examples/sample-novel/content/meta.json");
    const originalMeta = await readFile(originalMetaPath, "utf8");
    const fixture = await prepareAgentQaFixture({ root, temporary });

    assert.match(fixture.projectPath, /Project With Spaces$/);
    assert.equal(fixture.projectName, "VibeGal Agent QA");
    assert.equal(fixture.initialTitle, "Agent QA Original Title");
    assert.equal(JSON.parse(await readFile(path.join(fixture.projectPath, "gal.project.json"), "utf8")).name, fixture.projectName);
    assert.equal(JSON.parse(await readFile(path.join(fixture.projectPath, "content/meta.json"), "utf8")).title, fixture.initialTitle);
    assert.equal(await readFile(originalMetaPath, "utf8"), originalMeta);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
