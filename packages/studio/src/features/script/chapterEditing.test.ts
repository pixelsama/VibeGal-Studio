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
    { id: "ending", title: "结束", file: "nodes/ending.json", position: { x: 480, y: 0 }, chapterId: "route" },
  ],
  edges: [
    { id: "start__choice", from: "start", to: "choice", condition: null },
    { id: "choice__ending", from: "choice", to: "ending", condition: null },
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

  it("does not delete a chapter while it still owns nodes", () => {
    const next = deleteChapter(graph, "route");

    expect(next).toBe(graph);
  });

  it("does not delete the final chapter even when it is empty", () => {
    const onlyChapter = {
      ...graph,
      chapters: [{ id: "prologue", title: "序章" }],
      nodes: graph.nodes.filter((node) => node.chapterId === "prologue"),
      edges: [],
    };

    expect(deleteChapter({ ...onlyChapter, nodes: [] }, "prologue")).toEqual({ ...onlyChapter, nodes: [] });
  });

  it("deletes an empty chapter and keeps all node ownership intact", () => {
    const next = deleteChapter({
      ...graph,
      chapters: [...graph.chapters, { id: "empty", title: "空章节" }],
    }, "empty");

    expect(next.chapters.map((chapter) => chapter.id)).toEqual(["prologue", "route"]);
    expect(next.nodes).toEqual(graph.nodes);
    expect(next.edges).toEqual(graph.edges);
  });

  it("moves a node only to an existing chapter", () => {
    const assigned = setNodeChapter(graph, "ending", "prologue");
    expect(assigned.nodes[2].chapterId).toBe("prologue");
    expect(setNodeChapter(assigned, "ending", "missing")).toBe(assigned);
  });
});

describe("chapter canvas scope", () => {
  it("shows every node in all scope and only assigned nodes in chapter scope", () => {
    expect([...nodeIdsForChapterScope(graph, { kind: "all" })]).toEqual(["start", "choice", "ending"]);
    expect([...nodeIdsForChapterScope(graph, { kind: "chapter", chapterId: "route" })]).toEqual(["choice", "ending"]);
  });

  it("resolves a selected node to its chapter", () => {
    expect(chapterScopeForNode(graph, "choice")).toEqual({ kind: "chapter", chapterId: "route" });
    expect(chapterScopeForNode(graph, "ending")).toEqual({ kind: "chapter", chapterId: "route" });
  });

  it("filters only the authoring view and hides edges with an endpoint outside the scope", () => {
    const scoped = graphForChapterScope(graph, { kind: "chapter", chapterId: "route" });

    expect(scoped.nodes.map((node) => node.id)).toEqual(["choice", "ending"]);
    expect(scoped.edges).toEqual([graph.edges[1]]);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(2);
  });
});
