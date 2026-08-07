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
    expect(html).toContain("全部节点");
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

  it("marks the selected node with aria-current in a plain list", () => {
    const html = renderToStaticMarkup(createElement(StoryOutline, {
      graph,
      scope: { kind: "chapter", chapterId: "choice" },
      selectedNodeId: "turn",
      onScopeChange: () => {},
      onSelectNode: () => {},
      onCreateNode: () => {},
      onCreateChapter: () => {},
      onRenameChapter: () => {},
      onMoveChapter: () => {},
      onDeleteChapter: () => {},
    }));

    // 节点列表是普通 list（不再假声明 listbox 契约），选中节点用 aria-current 标记
    expect(html).toContain('role="list"');
    expect(html).not.toContain('role="listbox"');
    expect(html).toMatch(/<div[^>]*role="listitem"[^>]*aria-current="true"[^>]*>[\s\S]*?<button[^>]*>[\s\S]*?分岔/);
    expect(html).toMatch(/<div[^>]*role="listitem"[^>]*aria-posinset="1"[^>]*aria-setsize="2"/);
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

  it("keeps delete enabled for a chapter that still contains nodes", () => {
    // graph 有两个章节且都含节点；以前含节点即禁用（点了没反应），现在应可点，
    // 交由 handleDeleteChapter 的 moveNodesFirst 提示反馈。
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

    // More menu trigger exists per chapter row
    const moreButton = html.match(/<summary[^>]*aria-label="更多操作"[^>]*>/);
    expect(moreButton).toBeTruthy();
    // Delete action exists inside the menu and is not disabled for a chapter with nodes
    const deleteButton = html.match(/<button[^>]*aria-label="删除章节 序章"[^>]*>/);
    expect(deleteButton).toBeTruthy();
    expect(deleteButton![0]).not.toContain('disabled=""');
  });

  it("disables delete and relabels it when there is only one chapter", () => {
    const single: ProjectGraph = { ...graph, chapters: [graph.chapters[0]] };
    const html = renderToStaticMarkup(createElement(StoryOutline, {
      graph: single,
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

    const deleteButton = html.match(/<button[^>]*aria-label="至少保留一个章节"[^>]*>/);
    expect(deleteButton).toBeTruthy();
    expect(deleteButton![0]).toContain('disabled=""');
  });
});
