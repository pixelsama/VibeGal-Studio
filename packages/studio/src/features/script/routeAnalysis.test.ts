import { describe, expect, it } from "vitest";
import { analyzeEndingRouteMatrix, analyzeEndingRoutes, collectUnregisteredTerminals } from "./routeAnalysis";
import { EMPTY_MANIFEST, type Manifest } from "../../lib/types";

describe("bounded ending route analysis", () => {
  it("tolerates a manifest whose raw JSON lacks the unlocks registry", () => {
    // open_project 原样返回 manifest.json，不套用 schema 默认值；
    // 缺省 unlocks 的项目（如 examples/sample-novel）不应让分析面板崩溃。
    const manifest = { ...EMPTY_MANIFEST, unlocks: undefined } as unknown as Manifest;
    const graph = {
      version: 1, entryNodeId: "start",
      nodes: [{ id: "start", title: "Start", file: "nodes/start.json", position: { x: 0, y: 0 } }],
      edges: [],
    };
    expect(analyzeEndingRouteMatrix({ graph, manifest }).rows).toEqual([]);
    expect(collectUnregisteredTerminals(graph, manifest)).toEqual([{ nodeId: "start", title: "Start" }]);
  });

  it("reports reachable completion and unknown on exhausted budget", () => {
    const manifest = { ...EMPTY_MANIFEST, unlocks: { ...EMPTY_MANIFEST.unlocks, endings: { true_end: { title: "True" } } } };
    const graph = { version: 1, entryNodeId: "start", nodes: [{ id: "start", title: "Start", file: "nodes/start.json", position: { x: 0, y: 0 } }], edges: [] };
    expect(analyzeEndingRoutes({ graph, manifest, nodes: [{ relPath: "nodes/start.json", data: [{ t: "completeEnding", id: "end", endingId: "true_end" }] }] })[0].reachability).toBe("reachable");
    expect(analyzeEndingRoutes({ graph, manifest, transitionBudget: 0 })[0].reachability).toBe("unknown");
  });

  it("uses registered ending IDs and keeps unregistered terminals separate", () => {
    const manifest = { ...EMPTY_MANIFEST, unlocks: { ...EMPTY_MANIFEST.unlocks, endings: { true_end: { title: "True", nodeId: "registered" } } } };
    const graph = {
      version: 1, entryNodeId: "start",
      nodes: [
        { id: "start", title: "Start", file: "nodes/start.json", position: { x: 0, y: 0 } },
        { id: "registered", title: "Registered", file: "nodes/registered.json", position: { x: 1, y: 0 } },
        { id: "draft", title: "Draft", file: "nodes/draft.json", position: { x: 1, y: 1 } },
      ],
      edges: [
        { id: "a", from: "start", to: "registered", condition: null },
        { id: "b", from: "start", to: "draft", condition: null },
      ],
    };
    const analysis = analyzeEndingRoutes({ graph, manifest });
    expect(analysis.map((entry) => entry.endingId)).toEqual(["true_end"]);
    expect(analysis[0].reachability).toBe("unknown");
    expect(collectUnregisteredTerminals(graph, manifest)).toEqual([{ nodeId: "draft", title: "Draft" }]);
  });

  it("builds entry and choice-branch columns with per-ending cells", () => {
    const manifest = { ...EMPTY_MANIFEST, unlocks: { ...EMPTY_MANIFEST.unlocks, endings: {
      a_end: { title: "A" }, b_end: { title: "B" },
    } } };
    const graph = {
      version: 1, entryNodeId: "start",
      nodes: [
        { id: "start", title: "Start", file: "nodes/start.json", position: { x: 0, y: 0 } },
        { id: "a", title: "A", file: "nodes/a.json", position: { x: 1, y: 0 } },
        { id: "b", title: "B", file: "nodes/b.json", position: { x: 1, y: 1 } },
      ],
      edges: [
        { id: "choose-a", from: "start", to: "a", condition: null },
        { id: "choose-b", from: "start", to: "b", condition: null },
      ],
    };
    // Spec 35 Phase 3：路由矩阵列从节点 choice 指令的 options 派生（option.to 与
    // 图边目标对齐），不再读 edge.mode/label。option.text 成为列标题。
    const nodes = [
      { relPath: "nodes/start.json", data: [{ t: "choice", id: "start_choice", options: [
        { text: "Choose A", to: "a" },
        { text: "Choose B", to: "b" },
      ] }] },
      { relPath: "nodes/a.json", data: [{ t: "completeEnding", id: "a", endingId: "a_end" }] },
      { relPath: "nodes/b.json", data: [{ t: "completeEnding", id: "b", endingId: "b_end" }] },
    ];

    const matrix = analyzeEndingRouteMatrix({ graph, manifest, nodes });

    expect(matrix.columns.map((column) => column.id)).toEqual(["entry", "choice:start_choice:0", "choice:start_choice:1"]);
    expect(matrix.columns.map((column) => column.title)).toEqual(["入口", "Choose A", "Choose B"]);
    expect(matrix.rows.find((row) => row.endingId === "a_end")?.cells.map((cell) => cell.reachability))
      .toEqual(["reachable", "reachable", "unreachable"]);
  });

  it("propagates assignment expressions through first-match auto routes", () => {
    const manifest = { ...EMPTY_MANIFEST, unlocks: { ...EMPTY_MANIFEST.unlocks, endings: {
      true_end: { title: "True" }, bad_end: { title: "Bad" },
    } } };
    const graph = {
      version: 1,
      entryNodeId: "start",
      nodes: [
        { id: "start", title: "Start", file: "nodes/start.json", position: { x: 0, y: 0 } },
        { id: "true", title: "True", file: "nodes/true.json", position: { x: 1, y: 0 } },
        { id: "bad", title: "Bad", file: "nodes/bad.json", position: { x: 1, y: 1 } },
      ],
      edges: [
        { id: "true-route", from: "start", to: "true", condition: "affection >= 3" },
        { id: "fallback", from: "start", to: "bad", condition: null },
      ],
    };
    const nodes = [
      { relPath: "nodes/start.json", data: [{ t: "set", key: "affection", expr: "affection + 1" }] },
      { relPath: "nodes/true.json", data: [{ t: "completeEnding", id: "true", endingId: "true_end" }] },
      { relPath: "nodes/bad.json", data: [{ t: "completeEnding", id: "bad", endingId: "bad_end" }] },
    ];
    const variables = { version: 1 as const, variables: { affection: { type: "number" as const, default: 2, nullable: false, scope: "run" as const } } };

    const result = analyzeEndingRoutes({ graph, manifest, nodes, variables });

    expect(result.find((item) => item.endingId === "true_end")?.reachability).toBe("reachable");
    expect(result.find((item) => item.endingId === "bad_end")?.reachability).toBe("unreachable");
  });

  it("treats choice option targets as structural routes even without graph edges", () => {
    const manifest = { ...EMPTY_MANIFEST, unlocks: { ...EMPTY_MANIFEST.unlocks, endings: {
      target_end: { title: "Target", nodeId: "target" },
    } } };
    const graph = {
      version: 1,
      entryNodeId: "start",
      nodes: [
        { id: "start", title: "Start", file: "nodes/start.json", position: { x: 0, y: 0 } },
        { id: "target", title: "Target", file: "nodes/target.json", position: { x: 1, y: 0 } },
      ],
      edges: [],
    };
    const nodes = [
      { relPath: "nodes/start.json", data: [{ t: "choice", id: "route", options: [{ text: "去", to: "target" }] }] },
      { relPath: "nodes/target.json", data: [{ t: "completeEnding", id: "finish", endingId: "target_end" }] },
    ];

    expect(analyzeEndingRoutes({ graph, manifest, nodes })[0].reachability).toBe("reachable");
    expect(collectUnregisteredTerminals(graph, manifest, nodes)).toEqual([]);
  });
});
