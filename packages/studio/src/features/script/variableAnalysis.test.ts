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
    { id: "start__mid", from: "start", to: "mid", condition: "flags.ready && route == 'stay'" },
    { id: "mid__ending", from: "mid", to: "ending", condition: null },
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
      choiceBranches: [],
      autoBranches: [],
    });
  });

  it("routeCoverageReportsChoiceBranchEndings", () => {
    const choiceGraph: ProjectGraph = {
      version: 1,
      entryNodeId: "start",
      nodes: [
        { id: "start", title: "Start", file: "nodes/start.json", position: { x: 0, y: 0 } },
        { id: "good", title: "Good", file: "nodes/good.json", position: { x: 240, y: 0 } },
        { id: "bad", title: "Bad", file: "nodes/bad.json", position: { x: 240, y: 120 } },
        { id: "ending", title: "Ending", file: "nodes/ending.json", position: { x: 480, y: 0 } },
      ],
      edges: [
        { id: "start__good", from: "start", to: "good", condition: null },
        { id: "start__bad", from: "start", to: "bad", condition: null },
        { id: "good__ending", from: "good", to: "ending", condition: null },
        { id: "bad__bad", from: "bad", to: "bad", condition: null },
      ],
    };

    const choiceNodeEntries: NodeEntry[] = [
      {
        relPath: "nodes/start.json",
        data: [
          {
            t: "choice",
            id: "start_choice",
            options: [
              { text: "Go", to: "good" },
              { text: "Stay", to: "bad" },
            ],
          },
        ],
      },
      { relPath: "nodes/good.json", data: [] },
      { relPath: "nodes/bad.json", data: [] },
      { relPath: "nodes/ending.json", data: [] },
    ];

    expect(buildRouteCoverage(choiceGraph, choiceNodeEntries).choiceBranches).toEqual([
      expect.objectContaining({
        edgeId: "start__good",
        fromNodeId: "start",
        toNodeId: "good",
        label: "Go",
        reachesEnding: true,
        endingNodeIds: ["ending"],
      }),
      expect.objectContaining({
        edgeId: "start__bad",
        fromNodeId: "start",
        toNodeId: "bad",
        label: "Stay",
        reachesEnding: false,
        endingNodeIds: [],
      }),
    ]);
  });
});
