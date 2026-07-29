import { describe, expect, it } from "vitest";
import type { Manifest, VariableRegistry } from "@vibegal/engine";
import type { NodeCreatorSummary, NodeEntry, ProjectGraph } from "../../lib/types";
import { resolveCatalogMessage } from "../../lib/i18n";
import { creatorEdgeLabel, creatorNodeSummary } from "./graphCreatorLanguage";

const graph: ProjectGraph = {
  version: 1,
  entryNodeId: "start",
  chapters: [],
  nodes: [
    { id: "start", title: "开场", file: "nodes/start.json", position: { x: 0, y: 0 } },
    { id: "ending", title: "结局", file: "nodes/ending.json", position: { x: 200, y: 0 } },
  ],
  edges: [],
};

const variables: VariableRegistry = {
  version: 1,
  variables: {
    affection: {
      kind: "meter",
      type: "number",
      default: 0,
      nullable: false,
      scope: "run",
      label: "好感度",
      min: 0,
      max: 100,
      bands: [{ id: "close", label: "亲密", upTo: 59 }, { id: "love", label: "喜欢" }],
    },
  },
};

const manifest = {
  characters: {}, backgrounds: {}, audio: { bgm: {}, sfx: {}, voice: {} },
  unlocks: { endings: { true_end: { title: "真结局", nodeId: "ending" } } },
} as unknown as Manifest;

describe("creatorEdgeLabel", () => {
  it("keeps choice copy and sentenceizes auto conditions", () => {
    expect(creatorEdgeLabel(
      { mode: "choice", label: "留下来" },
      { graph, variables, manifest },
    )).toBe("留下来");
    expect(creatorEdgeLabel(
      { mode: "auto", condition: "affection >= 60" },
      { graph, variables, manifest },
    )).toBe("好感度 达到 喜欢");
  });

  it("calls an unconditional auto edge otherwise", () => {
    expect(creatorEdgeLabel(
      { mode: "auto", condition: null },
      { graph, variables, manifest },
    )).toBe("否则");
  });

  it("uses the active Studio language for generated labels", () => {
    const t = (key: Parameters<typeof resolveCatalogMessage>[1], params?: Parameters<typeof resolveCatalogMessage>[2]) => (
      resolveCatalogMessage("en", key, params, { strictMissingEnglish: true })
    );
    expect(creatorEdgeLabel(
      { mode: "choice", label: null },
      { graph, variables, manifest, t },
    )).toBe("Choice");
    expect(creatorEdgeLabel(
      { mode: "auto", condition: null },
      { graph, variables, manifest, t },
    )).toBe("Otherwise");
  });

  it("preserves raw expressions that cannot be sentenceized", () => {
    expect(creatorEdgeLabel(
      { mode: "auto", condition: "a + b > c" },
      { graph, variables, manifest },
    )).toBe("a + b > c");
  });

  it("does not label ordinary linear edges", () => {
    expect(creatorEdgeLabel(
      { mode: "linear", condition: null },
      { graph, variables, manifest },
    )).toBeUndefined();
  });
});

describe("creatorNodeSummary", () => {
  const nodes: NodeEntry[] = [
    {
      relPath: "nodes/ending.json",
      data: [
        { t: "say", who: "akari", text: "一" },
        { t: "say", who: "akari", text: "二" },
        { t: "set", key: "affection", value: 60 },
      ],
    },
  ];

  it("summarizes dialogue, story-state changes, and formal endings", () => {
    expect(creatorNodeSummary("ending", "nodes/ending.json", nodes, manifest)).toEqual([
      "2 句台词",
      "改变故事状态",
      "正式结局",
    ]);
  });

  it("uses lazy summaries and still identifies formal endings without loaded node bodies", () => {
    const summaries: NodeCreatorSummary[] = [{
      id: "ending",
      relPath: "nodes/ending.json",
      sayCount: 2,
      changesState: true,
    }];
    expect(creatorNodeSummary("ending", "nodes/ending.json", undefined, manifest, summaries)).toEqual([
      "2 句台词",
      "改变故事状态",
      "正式结局",
    ]);
  });

  it("handles missing and malformed node data without inventing content", () => {
    expect(creatorNodeSummary("start", "nodes/start.json", nodes, manifest)).toEqual([]);
    expect(creatorNodeSummary("ending", "nodes/missing.json", undefined, manifest)).toEqual(["正式结局"]);
  });
});
