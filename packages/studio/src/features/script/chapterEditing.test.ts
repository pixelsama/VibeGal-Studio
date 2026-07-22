import { describe, expect, it } from "vitest";
import type { ProjectGraph } from "../../lib/types";
import {
  addChapter,
  chapterScopeForNode,
  deleteChapter,
  generateChapterId,
  graphForChapterScope,
  moveChapter,
  nodeIdsForChapterScope,
  renameChapter,
  setNodeChapter,
} from "./chapterEditing";

const graph: ProjectGraph = {
  version: 1,
  entryNodeId: "start",
  chapters: [
    { id: "prologue", title: "序章" },
    { id: "route", title: "黎明抉择" },
  ],
  nodes: [
    { id: "start", title: "开始", file: "nodes/start.json", position: { x: 0, y: 0 }, chapterId: "prologue" },
    { id: "choice", title: "抉择", file: "nodes/choice.json", position: { x: 240, y: 0 }, chapterId: "route" },
    { id: "ending", title: "结束", file: "nodes/ending.json", position: { x: 480, y: 0 } },
  ],
  edges: [
    { id: "start__choice", from: "start", to: "choice", mode: "linear", label: null, condition: null },
    { id: "choice__ending", from: "choice", to: "ending", mode: "linear", label: null, condition: null },
  ],
};

describe("chapter editing", () => {
  it("creates stable chapter ids and appends ordered chapters", () => {
    expect(generateChapterId(graph)).toBe("chapter");
    const withChapter = addChapter(graph, { id: "chapter", title: "尾声" });
    expect(withChapter.chapters?.at(-1)).toEqual({ id: "chapter", title: "尾声" });
    expect(generateChapterId(withChapter)).toBe("chapter_2");
  });

  it("renames and reorders chapters without changing node flow", () => {
    const renamed = renameChapter(graph, "route", "共同线");
    const reordered = moveChapter(renamed, "route", -1);

    expect(reordered.chapters).toEqual([
      { id: "route", title: "共同线" },
      { id: "prologue", title: "序章" },
    ]);
    expect(reordered.nodes).toEqual(graph.nodes);
    expect(reordered.edges).toEqual(graph.edges);
  });

  it("deletes only chapter metadata and leaves its nodes unassigned", () => {
    const next = deleteChapter(graph, "route");

    expect(next.chapters?.map((chapter) => chapter.id)).toEqual(["prologue"]);
    expect(next.nodes.map((node) => node.id)).toEqual(["start", "choice", "ending"]);
    expect(next.nodes.find((node) => node.id === "choice")).not.toHaveProperty("chapterId");
    expect(next.edges).toEqual(graph.edges);
  });

  it("assigns or unassigns a node without touching other graph data", () => {
    const assigned = setNodeChapter(graph, "ending", "route");
    expect(assigned.nodes[2].chapterId).toBe("route");

    const unassigned = setNodeChapter(assigned, "ending", null);
    expect(unassigned.nodes[2]).not.toHaveProperty("chapterId");
    expect(unassigned.edges).toEqual(graph.edges);
  });
});

describe("chapter canvas scope", () => {
  it("shows every node in all scope and only assigned nodes in chapter scope", () => {
    expect([...nodeIdsForChapterScope(graph, { kind: "all" })]).toEqual(["start", "choice", "ending"]);
    expect([...nodeIdsForChapterScope(graph, { kind: "chapter", chapterId: "route" })]).toEqual(["choice"]);
    expect([...nodeIdsForChapterScope(graph, { kind: "unassigned" })]).toEqual(["ending"]);
  });

  it("resolves a selected node to its chapter or the unassigned scope", () => {
    expect(chapterScopeForNode(graph, "choice")).toEqual({ kind: "chapter", chapterId: "route" });
    expect(chapterScopeForNode(graph, "ending")).toEqual({ kind: "unassigned" });
  });

  it("filters only the authoring view and hides edges with an endpoint outside the scope", () => {
    const scoped = graphForChapterScope(graph, { kind: "chapter", chapterId: "route" });

    expect(scoped.nodes.map((node) => node.id)).toEqual(["choice"]);
    expect(scoped.edges).toEqual([]);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(2);
  });
});
