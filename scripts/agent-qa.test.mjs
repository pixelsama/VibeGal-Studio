import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAgentQaPlan,
  createAgentQaReport,
  parseAgentQaArgs,
  redactAgentQaText,
  renderAgentQaHtml,
  selectAgentQaPlan,
} from "./agent-qa-core.mjs";
import { DESKTOP_SCENARIO_IDS } from "../qa/agent/desktop-qa-core.mjs";

test("Agent QA exposes deterministic quick, desktop, package, and release suites", () => {
  assert.equal(parseAgentQaArgs([]).suite, "quick");
  assert.equal(parseAgentQaArgs(["--suite", "desktop"]).suite, "desktop");
  assert.equal(parseAgentQaArgs(["--", "--suite", "desktop"]).suite, "desktop");
  assert.equal(parseAgentQaArgs([]).scenario, null);
  assert.equal(parseAgentQaArgs(["--suite", "desktop", "--scenario", "core-authoring"]).scenario, "core-authoring");
  assert.throws(() => parseAgentQaArgs(["--suite", "unknown"]), /unknown Agent QA suite/i);
  assert.throws(() => parseAgentQaArgs(["--scenario"]), /--scenario requires a value/i);

  assert.deepEqual(
    buildAgentQaPlan("quick").map((step) => step.id),
    ["repository-contracts", "browser-behavior"],
  );
  assert.ok(!buildAgentQaPlan("quick")[1].command.includes("--baseline"));
  assert.deepEqual(
    selectAgentQaPlan(buildAgentQaPlan("quick"), ["browser-behavior"]).map((step) => step.id),
    ["browser-behavior"],
  );
  assert.throws(
    () => selectAgentQaPlan(buildAgentQaPlan("quick"), ["desktop-authoring-loop"]),
    /not part of the selected suite/i,
  );
  assert.deepEqual(
    buildAgentQaPlan("desktop", { scenario: null }).map((step) => step.id),
    ["agent-qa-isolation", "desktop-agent-build", "desktop-authoring-loop"],
  );
  assert.ok(DESKTOP_SCENARIO_IDS.includes("desktop-authoring-loop"));
  assert.ok(DESKTOP_SCENARIO_IDS.includes("core-authoring"));
  assert.deepEqual(
    buildAgentQaPlan("desktop", { scenario: "core-authoring" })
      .find((step) => step.id === "desktop-authoring-loop").command,
    ["node", "qa/agent/run-desktop.mjs", "--scenario", "core-authoring"],
  );
  assert.deepEqual(
    buildAgentQaPlan("desktop", { scenario: "project-lifecycle" })
      .find((step) => step.id === "desktop-authoring-loop").command,
    [
      "node",
      "qa/agent/run-desktop.mjs",
      "--scenario",
      "project-lifecycle",
      "--fixture",
      "empty-parent",
    ],
  );
  assert.deepEqual(
    buildAgentQaPlan("desktop", { artifactsDir: "/tmp/agent-qa", scenario: "core-authoring" })
      .find((step) => step.id === "desktop-authoring-loop").evidence,
    [
      "desktop/scenarios/core-authoring/desktop/scenarios.ndjson",
      "desktop/scenarios/core-authoring/desktop/junit",
      "desktop/scenarios/core-authoring/project-before-after.json",
      "desktop/scenarios/core-authoring/desktop/screenshots",
      "desktop/scenarios/core-authoring/phases.json",
    ],
  );
  const desktopPlan = buildAgentQaPlan("desktop", { scenario: null });
  assert.deepEqual(desktopPlan[1].evidence, ["desktop/build.json"]);
  assert.deepEqual(desktopPlan[2].evidence, [
    "desktop/scenarios.ndjson",
    "desktop/junit/agent-qa.xml",
    "desktop/project-before-after.json",
    "desktop/screenshots",
  ]);
  assert.deepEqual(
    buildAgentQaPlan("package").map((step) => step.id),
    ["release-smoke", "platform-bundle"],
  );
  assert.ok(buildAgentQaPlan("package")[1].evidence.some((item) => item.includes("bundle")));
  assert.deepEqual(
    buildAgentQaPlan("release", { scenario: null }).map((step) => step.id),
    [
      "repository-contracts",
      "browser-behavior",
      "agent-qa-isolation",
      "desktop-agent-build",
      "desktop-authoring-loop",
      "release-smoke",
      "platform-bundle",
    ],
  );
});

test("Agent QA report is machine readable and preserves failed-step evidence", () => {
  const report = createAgentQaReport({
    suite: "desktop",
    runId: "20260729T120000Z-deadbeef",
    startedAt: "2026-07-29T12:00:00.000Z",
    finishedAt: "2026-07-29T12:01:00.000Z",
    artifactsDir: "/tmp/agent-qa",
    steps: [
      {
        id: "desktop-authoring-loop",
        status: "failed",
        command: ["pnpm", "exec", "wdio"],
        startedAt: "2026-07-29T12:00:10.000Z",
        finishedAt: "2026-07-29T12:00:30.000Z",
        durationMs: 20_000,
        exitCode: 1,
        log: "logs/desktop-authoring-loop.log",
        evidence: ["screenshots/desktop-authoring-loop-failed.png", "junit/desktop.xml"],
        error: "expected saved title",
      },
    ],
  });

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.kind, "vibegal-agent-qa");
  assert.equal(report.status, "failed");
  assert.equal(report.exitCode, 1);
  assert.equal(report.steps[0].evidence[0], "screenshots/desktop-authoring-loop-failed.png");
  assert.match(renderAgentQaHtml(report), /desktop-authoring-loop/);
  assert.match(renderAgentQaHtml(report), /expected saved title/);
});

test("Agent QA reports visual evidence as a required Agent review", () => {
  const report = createAgentQaReport({
    suite: "desktop",
    runId: "visual-review",
    startedAt: "2026-07-29T12:00:00.000Z",
    finishedAt: "2026-07-29T12:01:00.000Z",
    artifactsDir: "/tmp/agent-qa",
    steps: [{
      id: "desktop-authoring-loop",
      status: "passed",
      evidence: ["desktop/screenshots"],
    }],
  });

  assert.deepEqual(report.requiredReviews, [{
    kind: "visual",
    path: "desktop/screenshots",
    status: "pending",
    instructions: "Inspect every screenshot for clipping, overlap, loading states, and visual regressions.",
  }]);
  assert.match(renderAgentQaHtml(report), /Visual review required/);
});

test("Agent QA recognizes visual evidence in an isolated scenario directory", () => {
  const report = createAgentQaReport({
    suite: "desktop",
    runId: "isolated-visual-review",
    startedAt: "2026-07-29T12:00:00.000Z",
    finishedAt: "2026-07-29T12:01:00.000Z",
    artifactsDir: "/tmp/agent-qa",
    steps: [{
      id: "desktop-authoring-loop",
      status: "passed",
      evidence: ["desktop/scenarios/core-authoring/desktop/screenshots"],
    }],
  });

  assert.equal(report.requiredReviews[0].path, "desktop/scenarios/core-authoring/desktop/screenshots");
});

test("Agent QA redacts release credentials from logs", () => {
  const text = [
    "APPLE_CERTIFICATE_PASSWORD=hunter2",
    "WINDOWS_CERTIFICATE_BASE64=ZmFrZS1jZXJ0",
    "VIBEGAL_UPDATER_SIGNING_KEY=super-secret-key",
    "safe output",
  ].join("\n");

  const redacted = redactAgentQaText(text);
  assert.doesNotMatch(redacted, /hunter2|ZmFrZS1jZXJ0|super-secret-key/);
  assert.match(redacted, /APPLE_CERTIFICATE_PASSWORD=\[REDACTED\]/);
  assert.match(redacted, /safe output/);
});
