import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Manifest, VariableDeclaration, VariableRegistry } from "@vibegal/engine";
import type { ProjectGraph } from "../../lib/types";
import { StudioI18nProvider } from "../../lib/i18n";
import { StateUsage, stateReferenceCount, shouldConfirmStateRemoval } from "./StoryStateView";
import type { VariableEntry } from "./variableAnalysis";

const graph: ProjectGraph = {
  version: 1,
  entryNodeId: "start",
  chapters: [{ id: "c1", title: "第一章" }],
  nodes: [{ id: "start", title: "开始", file: "nodes/start.json", chapterId: "c1", position: { x: 0, y: 0 } }],
  edges: [],
};

const declaration: VariableDeclaration = {
  kind: "meter",
  type: "number",
  default: 0,
  nullable: false,
  scope: "run",
  label: "好感度",
};

const registry: VariableRegistry = { version: 1, variables: { affection: declaration } };
const manifest = { characters: {}, backgrounds: {}, audio: { bgm: {}, sfx: {}, voice: {} } } as unknown as Manifest;

function usage(severity: "error" | "warn"): VariableEntry {
  return {
    name: "affection",
    types: ["number"],
    writes: [],
    reads: [],
    issues: [{
      code: severity === "error" ? "read_before_write" : "write_without_read",
      message: "raw",
      severity,
    }],
  };
}

describe("StoryStateView local problem feedback", () => {
  it("keeps error and warning severity visible in the nearby issue", () => {
    const html = renderToStaticMarkup(createElement(
      StudioI18nProvider,
      { preference: "zh-CN" },
      createElement(StateUsage, {
        name: "affection",
        declaration,
        usage: usage("error"),
        graph,
        registry,
        manifest,
        t: (key) => key,
      }),
    ));

    expect(html).toContain('data-severity="error"');
    expect(html).toContain("status.severity.error");
    expect(html).toContain("gs-branch__problem--error");

    const warningHtml = renderToStaticMarkup(createElement(
      StudioI18nProvider,
      { preference: "zh-CN" },
      createElement(StateUsage, {
        name: "affection",
        declaration,
        usage: usage("warn"),
        graph,
        registry,
        manifest,
        t: (key) => key,
      }),
    ));
    expect(warningHtml).toContain('data-severity="warn"');
    expect(warningHtml).toContain("status.severity.warning");
    expect(warningHtml).toContain("gs-branch__problem--warn");
  });

  it("requires confirmation only when the state still has references", () => {
    expect(stateReferenceCount(usage("warn"))).toBe(0);
    expect(shouldConfirmStateRemoval(usage("warn"))).toBe(false);
    expect(shouldConfirmStateRemoval({ ...usage("warn"), reads: [{
      edgeId: "start__next",
      nodeId: "start",
      file: "content/graph.json",
      jsonPath: "$.edges[0].condition",
      preview: "affection >= 1",
    }] })).toBe(true);
  });
});
