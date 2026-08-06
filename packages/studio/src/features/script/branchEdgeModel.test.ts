import { describe, expect, it } from "vitest";
import type { VariableRegistry } from "@vibegal/engine";
import type { GraphEdge, NodeEntry, ProjectGraph } from "../../lib/types";
import {
  deriveEdgeKind,
  evaluateBranchOutcomes,
  moveEdge,
  moveEdgeById,
  orderDefaultAutoEdgeLast,
  targetTitle,
} from "./branchEdgeModel";
import { collectStateSources, stateSourceDefaults } from "./storyState";

const registry: VariableRegistry = {
  version: 1,
  variables: {
    affection: {
      kind: "meter", type: "number", default: 0, nullable: false, scope: "run", label: "好感度",
      min: 0, max: 100,
      bands: [{ id: "cold", label: "冷淡", upTo: 29 }, { id: "love", label: "喜欢" }],
    },
    has_key: { kind: "flag", type: "boolean", default: false, nullable: false, scope: "run", label: "拿到钥匙" },
  },
};

const graph: ProjectGraph = {
  version: 1,
  entryNodeId: "start",
  chapters: [{ id: "c1", title: "第一章" }],
  nodes: [
    { id: "start", title: "天台·夜", file: "nodes/start.json", chapterId: "c1", position: { x: 0, y: 0 } },
    { id: "confess", title: "雪·告白", file: "nodes/confess.json", chapterId: "c1", position: { x: 200, y: 0 } },
    { id: "normal", title: "普通结局", file: "nodes/normal.json", chapterId: "c1", position: { x: 200, y: 80 } },
  ],
  edges: [],
};

const sources = collectStateSources({ registry, graph });
const defaults = stateSourceDefaults(sources);

// Spec 35 Phase 3：edge 不再带 mode/label 字段。出口类型从节点指令派生。
const autoEdges: GraphEdge[] = [
  { id: "start__confess", from: "start", to: "confess", condition: "affection >= 30" },
  { id: "start__normal", from: "start", to: "normal", condition: null },
];

// ── deriveEdgeKind ─────────────────────────────────────────────────────

describe("deriveEdgeKind", () => {
  it("returns \"choice\" when the source node has a choice option targeting this edge's target", () => {
    const nodes: NodeEntry[] = [
      {
        relPath: "nodes/start.json",
        data: [
          { t: "narrate", text: "你站在天台上。" },
          {
            t: "choice",
            id: "rooftop_choice",
            prompt: null,
            options: [
              { text: "告白", to: "confess" },
              { text: "沉默", to: "normal" },
            ],
          },
        ],
      },
    ];
    const edge: GraphEdge = { id: "e1", from: "start", to: "confess", condition: null };
    expect(deriveEdgeKind(graph, nodes, edge)).toBe("choice");
  });

  it("returns \"auto\" for a multi-exit node without a choice instruction", () => {
    const multiExitGraph: ProjectGraph = {
      ...graph,
      edges: [
        { id: "e1", from: "start", to: "confess", condition: "affection >= 30" },
        { id: "e2", from: "start", to: "normal", condition: null },
      ],
    };
    const nodes: NodeEntry[] = [
      { relPath: "nodes/start.json", data: [{ t: "narrate", text: "夜风。" }] },
    ];
    const edge: GraphEdge = { id: "e1", from: "start", to: "confess", condition: "affection >= 30" };
    expect(deriveEdgeKind(multiExitGraph, nodes, edge)).toBe("auto");
  });

  it("returns \"linear\" for a single-exit node without a choice instruction", () => {
    const nodes: NodeEntry[] = [
      { relPath: "nodes/start.json", data: [{ t: "narrate", text: "夜风。" }] },
    ];
    const edge: GraphEdge = { id: "e1", from: "start", to: "confess", condition: null };
    expect(deriveEdgeKind(graph, nodes, edge)).toBe("linear");
  });

  it("returns \"linear\" when the choice option does not target this edge's target", () => {
    const nodes: NodeEntry[] = [
      {
        relPath: "nodes/start.json",
        data: [
          {
            t: "choice",
            id: "rooftop_choice",
            prompt: null,
            options: [{ text: "告白", to: "confess" }],
          },
        ],
      },
    ];
    // Edge targets "normal" but the choice option targets "confess".
    const edge: GraphEdge = { id: "e1", from: "start", to: "normal", condition: null };
    expect(deriveEdgeKind(graph, nodes, edge)).toBe("linear");
  });

  it("handles missing node entries gracefully", () => {
    const edge: GraphEdge = { id: "e1", from: "start", to: "confess", condition: null };
    expect(deriveEdgeKind(graph, undefined, edge)).toBe("linear");
  });
});

// ── evaluateBranchOutcomes ─────────────────────────────────────────────

describe("evaluateBranchOutcomes", () => {
  it("marks the first satisfied branch as the winner and stops there", () => {
    const outcomes = evaluateBranchOutcomes(autoEdges, { ...defaults, affection: 60 });
    expect(outcomes[0].winner).toBe(true);
    expect(outcomes[1].winner).toBe(false);
  });

  it("falls through to the fallback when nothing matches", () => {
    const outcomes = evaluateBranchOutcomes(autoEdges, { ...defaults, affection: 0 });
    expect(outcomes[0].winner).toBe(false);
    expect(outcomes[1].winner).toBe(true);
  });

  it("explains an unreachable branch and how to fix it", () => {
    const shadowed: GraphEdge[] = [
      { ...autoEdges[1], condition: null },
      { ...autoEdges[0], condition: "affection >= 30" },
    ];
    const outcomes = evaluateBranchOutcomes(shadowed, defaults);
    expect(outcomes[1].problem?.message).toContain("这条永远走不到");
    expect(outcomes[1].problem?.message).toContain("第 1 条不带条件");
    expect(outcomes[0].problem).toBeNull();
  });

  it("does not call a branch unreachable just because this trial did not reach it", () => {
    const outcomes = evaluateBranchOutcomes(
      [
        { ...autoEdges[0], condition: "has_key" },
        { ...autoEdges[1], condition: "affection >= 30" },
      ],
      { ...defaults, has_key: true, affection: 60 },
    );
    expect(outcomes[0].winner).toBe(true);
    expect(outcomes[1].problem).toBeNull();
  });

  it("reports an uncomputable condition instead of silently failing", () => {
    const outcomes = evaluateBranchOutcomes(
      [{ ...autoEdges[0], condition: "affection >= \"x\"" }],
      defaults,
    );
    expect(outcomes[0].problem?.message).toContain("无法计算");
    expect(outcomes[0].problem?.severity).toBe("error");
  });

  it("keeps structural problems as warnings while evaluation failures are errors", () => {
    const shadowed: GraphEdge[] = [
      { ...autoEdges[1], condition: null },
      { ...autoEdges[0], condition: "affection >= 30" },
    ];
    const outcomes = evaluateBranchOutcomes(shadowed, defaults);
    expect(outcomes[1].problem?.severity).toBe("warn");
  });

  it("does not report 未知变量 for story experience or system state", () => {
    const outcomes = evaluateBranchOutcomes(
      [{ ...autoEdges[0], condition: "system.playthroughCount >= 1" }],
      defaults,
    );
    expect(outcomes[0].problem).toBeNull();
  });
});

// ── edge ordering ──────────────────────────────────────────────────────

describe("edge ordering", () => {
  it("keeps the fallback last no matter how rows are moved", () => {
    const reordered = orderDefaultAutoEdgeLast(moveEdge(autoEdges, 1, -1));
    expect(reordered.map((edge) => edge.id)).toEqual(["start__confess", "start__normal"]);
  });

  it("drag and keyboard reordering agree", () => {
    expect(moveEdgeById(autoEdges, "start__normal", "start__confess").map((edge) => edge.id))
      .toEqual(moveEdge(autoEdges, 1, -1).map((edge) => edge.id));
  });
});

// ── targetTitle ────────────────────────────────────────────────────────

describe("targetTitle", () => {
  it("returns the node title when the target node exists", () => {
    expect(targetTitle(graph, "confess")).toBe("雪·告白");
  });

  it("falls back to the node id when the target node is missing", () => {
    expect(targetTitle(graph, "missing")).toBe("missing");
  });
});
