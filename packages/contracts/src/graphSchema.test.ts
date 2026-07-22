import { describe, expect, it } from "vitest";
import { ProjectGraphSchema } from "./schema";

const validGraph = {
  version: 1,
  entryNodeId: "start",
  chapters: [{ id: "chapter_1", title: "第一章" }],
  nodes: [{
    id: "start",
    file: "nodes/start.json",
    chapterId: "chapter_1",
    position: { x: 0, y: 0 },
  }],
  edges: [],
};

describe("ProjectGraphSchema chapter ownership", () => {
  it("requires at least one chapter", () => {
    expect(ProjectGraphSchema.safeParse({ ...validGraph, chapters: [] }).success).toBe(false);
  });

  it("requires every node to name an existing chapter", () => {
    const withoutChapter = {
      ...validGraph,
      nodes: validGraph.nodes.map(({ chapterId: _chapterId, ...node }) => node),
    };
    expect(ProjectGraphSchema.safeParse(withoutChapter).success).toBe(false);
    expect(ProjectGraphSchema.safeParse({
      ...validGraph,
      nodes: validGraph.nodes.map((node) => ({ ...node, chapterId: "missing" })),
    }).success).toBe(false);
  });
});
