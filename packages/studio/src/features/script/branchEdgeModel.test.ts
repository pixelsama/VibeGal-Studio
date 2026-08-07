import { describe, expect, it } from "vitest";
import type { VariableRegistry } from "@vibegal/engine";
import type { GraphEdge, NodeEntry, ProjectGraph } from "../../lib/types";
import {
  buildEdgeChoiceAnnotations,
  deriveEdgeKind,
  evaluateBranchOutcomes,
  moveEdge,
  moveEdgeById,
  orderDefaultAutoEdgeLast,
  replaceEdgeCondition,
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

  it("replaces a raw condition and keeps the fallback edge last", () => {
    const next = replaceEdgeCondition([
      { id: "fallback", from: "start", to: "normal", condition: null },
      { id: "conditional", from: "start", to: "confess", condition: "affection >= 30" },
    ], "conditional", "score >= 3 && route == \"stay\"");

    expect(next).toEqual([
      { id: "conditional", from: "start", to: "confess", condition: "score >= 3 && route == \"stay\"" },
      { id: "fallback", from: "start", to: "normal", condition: null },
    ]);
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

// ── buildEdgeChoiceAnnotations (Phase 4) ───────────────────────────────

describe("buildEdgeChoiceAnnotations", () => {
  const choiceGraph: ProjectGraph = {
    version: 1,
    entryNodeId: "start",
    chapters: [{ id: "c1", title: "第一章" }],
    nodes: [
      { id: "start", title: "天台", file: "nodes/start.json", chapterId: "c1", position: { x: 0, y: 0 } },
      { id: "left", title: "左边", file: "nodes/left.json", chapterId: "c1", position: { x: 200, y: 0 } },
      { id: "right", title: "右边", file: "nodes/right.json", chapterId: "c1", position: { x: 200, y: 80 } },
      { id: "merge", title: "合流", file: "nodes/merge.json", chapterId: "c1", position: { x: 400, y: 40 } },
    ],
    edges: [
      { id: "e_left", from: "start", to: "left", condition: null },
      { id: "e_right", from: "start", to: "right", condition: null },
      { id: "e_merge", from: "left", to: "merge", condition: null },
    ],
  };

  const choiceNodes: NodeEntry[] = [
    {
      relPath: "nodes/start.json",
      data: [
        { t: "choice", id: "branch", options: [
          { text: "去左边", to: "left" },
          { text: "去右边", to: "right" },
        ] },
      ],
    },
    { relPath: "nodes/left.json", data: [{ t: "narrate", id: "l1", text: "左" }] },
    { relPath: "nodes/right.json", data: [{ t: "narrate", id: "r1", text: "右" }] },
    { relPath: "nodes/merge.json", data: [{ t: "narrate", id: "m1", text: "合流" }] },
  ];

  it("annotates choice edges with option text", () => {
    const annotations = buildEdgeChoiceAnnotations(choiceGraph, choiceNodes);
    expect(annotations.get("e_left")).toEqual({ kind: "choice", options: ["去左边"] });
    expect(annotations.get("e_right")).toEqual({ kind: "choice", options: ["去右边"] });
  });

  it("does not annotate linear edges", () => {
    const annotations = buildEdgeChoiceAnnotations(choiceGraph, choiceNodes);
    expect(annotations.has("e_merge")).toBe(false);
  });

  it("collects multiple options targeting the same node", () => {
    const multiGraph: ProjectGraph = {
      ...choiceGraph,
      edges: [{ id: "e_both", from: "start", to: "left", condition: null }],
    };
    const multiNodes: NodeEntry[] = [
      {
        relPath: "nodes/start.json",
        data: [
          { t: "choice", id: "branch", options: [
            { text: "选项A", to: "left" },
            { text: "选项B", to: "left" },
          ] },
        ],
      },
      { relPath: "nodes/left.json", data: [] },
      { relPath: "nodes/right.json", data: [] },
      { relPath: "nodes/merge.json", data: [] },
    ];
    const annotations = buildEdgeChoiceAnnotations(multiGraph, multiNodes);
    expect(annotations.get("e_both")).toEqual({ kind: "choice", options: ["选项A", "选项B"] });
  });

  it("finds choice instructions nested inside if-then branches", () => {
    const nestedGraph: ProjectGraph = {
      ...choiceGraph,
      edges: [{ id: "e_nested", from: "start", to: "left", condition: null }],
    };
    const nestedNodes: NodeEntry[] = [
      {
        relPath: "nodes/start.json",
        data: [
          { t: "if", condition: "true", then: [
            { t: "choice", id: "inner", options: [{ text: "嵌套选项", to: "left" }] },
          ] },
        ],
      },
      { relPath: "nodes/left.json", data: [] },
      { relPath: "nodes/right.json", data: [] },
      { relPath: "nodes/merge.json", data: [] },
    ];
    const annotations = buildEdgeChoiceAnnotations(nestedGraph, nestedNodes);
    expect(annotations.get("e_nested")).toEqual({ kind: "choice", options: ["嵌套选项"] });
  });

  it("returns an empty map when nodeEntries is undefined", () => {
    const annotations = buildEdgeChoiceAnnotations(choiceGraph, undefined);
    expect(annotations.size).toBe(0);
  });
});
