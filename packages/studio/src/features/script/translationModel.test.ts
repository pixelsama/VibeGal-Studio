import { describe, expect, it } from "vitest";
import type { NodeEntry, ProjectGraph } from "../../lib/types";
import {
  assignInstructionTextKey,
  buildTranslationReport,
  collectTranslationRows,
  generateTranslationKey,
} from "./translationModel";

const graph: ProjectGraph = {
  version: 1,
  entryNodeId: "opening",
  chapters: [{ id: "chapter-1", title: "第一章" }],
  nodes: [{
    id: "opening",
    title: "开场",
    file: "nodes/opening.json",
    position: { x: 0, y: 0 },
    chapterId: "chapter-1",
  }],
  edges: [],
};

const nodes: NodeEntry[] = [{
  relPath: "nodes/opening.json",
  data: [
    { t: "say", id: "hello", who: "hero", expr: "default", text: "早上好。", textKey: "opening.hello" },
    { t: "narrate", text: "风停了。" },
  ],
}];

describe("translation model", () => {
  it("collects source rows with chapter node and story-point locations", () => {
    expect(collectTranslationRows(graph, nodes)).toEqual([
      expect.objectContaining({ chapterTitle: "第一章", nodeTitle: "开场", instructionId: "hello", textKey: "opening.hello" }),
      expect.objectContaining({ chapterTitle: "第一章", nodeTitle: "开场", instructionId: "index:1", textKey: undefined }),
    ]);
  });

  it("reports missing keys translations orphans and default drift", () => {
    const rows = collectTranslationRows(graph, nodes);
    expect(buildTranslationReport(
      rows,
      { orphan: "unused" },
      { "opening.hello": "漂移文本" },
    )).toEqual({
      missingKeys: 1,
      missingTranslations: 1,
      orphanKeys: ["orphan"],
      defaultTextDrift: 1,
    });
  });

  it("generates stable explicit keys and assigns them immutably", () => {
    const row = collectTranslationRows(graph, nodes)[1];
    const key = generateTranslationKey(row, new Set(["opening.line-1"]));
    expect(key).toBe("opening.line-1-2");
    expect(assignInstructionTextKey(nodes[0].data, 1, key)?.[1]).toEqual({
      t: "narrate",
      text: "风停了。",
      textKey: key,
    });
    expect((nodes[0].data as unknown[])[1]).not.toHaveProperty("textKey");
  });
});
