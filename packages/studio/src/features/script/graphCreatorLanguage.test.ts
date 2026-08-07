import { describe, expect, it } from "vitest";
import type { Manifest } from "@vibegal/engine";
import type { NodeCreatorSummary, NodeEntry } from "../../lib/types";
import { creatorNodeSummary } from "./graphCreatorLanguage";

const manifest = {
  characters: {}, backgrounds: {}, audio: { bgm: {}, sfx: {}, voice: {} },
  unlocks: { endings: { true_end: { title: "真结局", nodeId: "ending" } } },
} as unknown as Manifest;

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
      instructionCount: 3,
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
