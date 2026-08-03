import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProjectGraph } from "../../lib/types";
import { StoryOutline } from "./StoryOutline";

const graph: ProjectGraph = {
  version: 1,
  entryNodeId: "start",
  chapters: [
    { id: "prologue", title: "序章" },
    { id: "choice", title: "黎明抉择" },
  ],
  nodes: [
    { id: "start", title: "开始", file: "nodes/start.json", position: { x: 0, y: 0 }, chapterId: "prologue" },
    { id: "turn", title: "分岔", file: "nodes/turn.json", position: { x: 200, y: 0 }, chapterId: "choice" },
    { id: "finale", title: "尾声", file: "nodes/finale.json", position: { x: 400, y: 0 }, chapterId: "choice" },
  ],
  edges: [],
};

describe("StoryOutline", () => {
  it("shows a global view and ordered chapters without an unassigned bucket", () => {
    const html = renderToStaticMarkup(createElement(StoryOutline, {
      graph,
      scope: { kind: "chapter", chapterId: "choice" },
      selectedNodeId: null,
      onScopeChange: () => {},
      onSelectNode: () => {},
      onCreateNode: () => {},
      onCreateChapter: () => {},
      onRenameChapter: () => {},
      onMoveChapter: () => {},
      onDeleteChapter: () => {},
    }));

    expect(html).toContain("故事结构");
    expect(html).toContain("全局视图");
    expect(html).toContain("序章");
    expect(html).toContain("黎明抉择");
    expect(html).not.toContain("未分章");
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('aria-label="新建章节"');
    expect(html).toContain('aria-label="搜索故事"');
  });

  it("does not suppress the keyboard focus outline on the search input", () => {
    const html = renderToStaticMarkup(createElement(StoryOutline, {
      graph,
      scope: { kind: "all" },
      selectedNodeId: null,
      onScopeChange: () => {},
      onSelectNode: () => {},
      onCreateNode: () => {},
      onCreateChapter: () => {},
      onRenameChapter: () => {},
      onMoveChapter: () => {},
      onDeleteChapter: () => {},
    }));

    expect(html).toContain('aria-label="搜索故事"');
    // 搜索框不应内联 outline:none 吞掉全局 :focus-visible 焦点环
    expect(html).not.toContain("outline:none");
  });

  it("offers node creation when the selected chapter is empty", () => {
    const emptyChapterGraph: ProjectGraph = {
      ...graph,
      nodes: graph.nodes.filter((node) => node.chapterId === "prologue"),
    };
    const html = renderToStaticMarkup(createElement(StoryOutline, {
      graph: emptyChapterGraph,
      scope: { kind: "chapter", chapterId: "choice" },
      selectedNodeId: null,
      onScopeChange: () => {},
      onSelectNode: () => {},
      onCreateNode: () => {},
      onCreateChapter: () => {},
      onRenameChapter: () => {},
      onMoveChapter: () => {},
      onDeleteChapter: () => {},
    }));

    expect(html).toContain("这个章节还没有节点");
    expect(html).toContain("节点用来承载剧情内容");
    expect(html).toContain(">新建节点</button>");
  });
});
