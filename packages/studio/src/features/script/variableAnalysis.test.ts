import { describe, expect, it } from "vitest";
import type { NodeEntry, ProjectGraph } from "../../lib/types";
import { buildRouteCoverage, analyzeGraphVariables } from "./variableAnalysis";

const graph: ProjectGraph = {
  version: 1,
  entryNodeId: "start",
  nodes: [
    { id: "start", title: "Start", file: "nodes/start.json", position: { x: 0, y: 0 } },
    { id: "mid", title: "Mid", file: "nodes/mid.json", position: { x: 240, y: 0 } },
    { id: "ending", title: "Ending", file: "nodes/ending.json", position: { x: 480, y: 0 } },
    { id: "orphan", title: "Orphan", file: "nodes/orphan.json", position: { x: 720, y: 0 } },
  ],
  edges: [
    { id: "start__mid", from: "start", to: "mid", mode: "auto", label: null, condition: "flags.ready && route == 'stay'" },
    { id: "mid__ending", from: "mid", to: "ending", mode: "linear", label: null, condition: null },
  ],
};

const nodeEntries: NodeEntry[] = [
  { relPath: "nodes/start.json", data: [{ t: "set", key: "route", value: "stay" }] },
  { relPath: "nodes/mid.json", data: [{ t: "set", key: "route", value: 1 }] },
  { relPath: "nodes/ending.json", data: [] },
  { relPath: "nodes/orphan.json", data: [] },
];

describe("variable analysis", () => {
  it("variableTableFindsReadBeforeWrite", () => {
    const report = analyzeGraphVariables(graph, nodeEntries);
    const entry = report.variables.find((variable) => variable.name === "flags.ready");

    expect(entry?.issues.map((issue) => issue.code)).toContain("read_before_write");
    expect(entry?.reads).toHaveLength(1);
  });

  it("variableTableFindsTypeConflict", () => {
    const report = analyzeGraphVariables(graph, nodeEntries);
    const entry = report.variables.find((variable) => variable.name === "route");

    expect(entry?.types).toEqual(["number", "string"]);
    expect(entry?.issues.map((issue) => issue.code)).toContain("type_conflict");
  });

  it("builds route coverage counts for reachable, ending and orphan nodes", () => {
    expect(buildRouteCoverage(graph)).toEqual({
      totalNodes: 4,
      reachableNodes: 3,
      endingNodes: 1,
      orphanNodes: 1,
    });
  });
});
