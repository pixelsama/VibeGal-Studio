import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildDesktopPhasePlan,
  desktopArtifactDirectory,
  getDesktopScenarioDefinition,
  parseDesktopArgs,
} from "./desktop-qa-core.mjs";
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

test("desktop QA exposes independent scenario and phase contracts", () => {
  assert.deepEqual(parseDesktopArgs([]), {
    scenario: "desktop-authoring-loop",
    phase: null,
    fixtureProfile: "sample-novel",
  });
  assert.deepEqual(parseDesktopArgs([
    "--scenario", "core-authoring",
    "--phase", "reopen",
    "--fixture", "sample-novel",
  ]), {
    scenario: "core-authoring",
    phase: "reopen",
    fixtureProfile: "sample-novel",
  });
  assert.throws(() => parseDesktopArgs(["--scenario", "../unsafe"]), /invalid desktop scenario/i);
  assert.throws(() => parseDesktopArgs(["--phase"]), /--phase requires a value/i);

  const definition = getDesktopScenarioDefinition("core-authoring");
  assert.equal(definition.id, "core-authoring");
  assert.match(definition.spec, /qa\/agent\/specs\/core-authoring\.e2e\.mjs$/);
  const reopenPlan = buildDesktopPhasePlan(definition, { phase: "reopen" });
  assert.deepEqual(reopenPlan.map((phase) => phase.id), ["reopen"]);
  assert.equal(reopenPlan[0].index, 1);
  assert.deepEqual(buildDesktopPhasePlan(getDesktopScenarioDefinition()).map((phase) => phase.id), ["authoring"]);

  const artifacts = desktopArtifactDirectory("/tmp/agent-qa", "core-authoring");
  assert.equal(artifacts, "/tmp/agent-qa/desktop/scenarios/core-authoring");
  assert.equal(
    desktopArtifactDirectory("/tmp/agent-qa", "desktop-authoring-loop", { legacyCompatible: true }),
    "/tmp/agent-qa/desktop",
  );
});

test("desktop QA fixture roots are independent and persist across phases", async () => {
  const firstTemporary = await mkdtemp(path.join(os.tmpdir(), "vibegal-agent-qa-phase-a-"));
  const secondTemporary = await mkdtemp(path.join(os.tmpdir(), "vibegal-agent-qa-phase-b-"));
  try {
    const first = await prepareAgentQaFixture({ root, temporary: firstTemporary, scenarioId: "core-authoring" });
    const second = await prepareAgentQaFixture({ root, temporary: secondTemporary, scenarioId: "core-authoring" });

    assert.notEqual(first.projectPath, second.projectPath);
    assert.equal(first.phaseProjectPath, first.projectPath);
    assert.equal(first.projectPath, first.phaseProjectPath);
    assert.equal(first.scenarioId, "core-authoring");
    assert.equal(second.scenarioId, "core-authoring");
    assert.notEqual(first.artifactsKey, second.artifactsKey);
  } finally {
    await rm(firstTemporary, { recursive: true, force: true });
    await rm(secondTemporary, { recursive: true, force: true });
  }
});
