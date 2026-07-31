import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Manifest, ProjectGraph } from "../../lib/types";
import { commitConditionDraft, moveEdge, moveEdgeById, NodeInspector, orderDefaultAutoEdgeLast } from "./NodeInspector";
import { StudioI18nProvider } from "../../lib/i18n";

const graph: ProjectGraph = {
  version: 1,
  entryNodeId: "start",
  chapters: [{ id: "opening", title: "序章" }],
  nodes: [
    { id: "start", title: "开始", file: "nodes/start.json", position: { x: 0, y: 0 }, chapterId: "opening" },
    { id: "left", title: "左线", file: "nodes/left.json", position: { x: 200, y: -60 }, chapterId: "opening" },
    { id: "right", title: "右线", file: "nodes/right.json", position: { x: 200, y: 60 }, chapterId: "opening" },
  ],
  edges: [
    { id: "start__left", from: "start", to: "left", mode: "choice", label: "去左边", condition: null },
    { id: "start__right", from: "start", to: "right", mode: "choice", label: "去右边", condition: null },
  ],
};

describe("NodeInspector graph exits", () => {
  it("renders a selected node when a legacy manifest has no unlock registry", () => {
    const legacyManifest = {
      characters: {},
      backgrounds: {},
      audio: { bgm: {}, sfx: {}, voice: {} },
    } as unknown as Manifest;

    expect(() => renderToStaticMarkup(createElement(NodeInspector, {
      graph,
      selectedNodeId: "start",
      manifest: legacyManifest,
      onEnter: () => {},
      onRename: () => {},
    }))).not.toThrow();
  });

  it("offers a create-node action in the empty state", () => {
    const html = renderToStaticMarkup(createElement(NodeInspector, {
      graph,
      selectedNodeId: null,
      onEnter: () => {},
      onRename: () => {},
      onCreateNode: () => {},
    }));

    expect(html).toContain("新建节点");
    expect(html).toContain("选择一个节点查看属性");
  });

  it("omits the create-node action when the callback is absent", () => {
    const html = renderToStaticMarkup(createElement(NodeInspector, {
      graph,
      selectedNodeId: null,
      onEnter: () => {},
      onRename: () => {},
    }));

    expect(html).not.toContain("新建节点");
  });

  it("disables the empty-state create-node action while saving (对齐工具栏防护)", () => {
    const savingHtml = renderToStaticMarkup(createElement(NodeInspector, {
      graph,
      selectedNodeId: null,
      onEnter: () => {},
      onRename: () => {},
      onCreateNode: () => {},
      saving: true,
    }));
    expect(savingHtml).toMatch(/<button[^>]*disabled[^>]*>新建节点<\/button>/);

    const idleHtml = renderToStaticMarkup(createElement(NodeInspector, {
      graph,
      selectedNodeId: null,
      onEnter: () => {},
      onRename: () => {},
      onCreateNode: () => {},
    }));
    expect(idleHtml).not.toMatch(/<button[^>]*disabled[^>]*>新建节点<\/button>/);
  });

  it("hides engineering fields (file path, coordinates, connection counts)", () => {
    const html = renderToStaticMarkup(createElement(NodeInspector, {
      graph,
      selectedNodeId: "start",
      onEnter: () => {},
      onRename: () => {},
    }));

    expect(html).not.toContain("nodes/start.json");
    expect(html).not.toContain("x 0 / y 0");
    expect(html).not.toContain("入 0 / 出 2");
    expect(html).not.toContain("结构角色");
  });

  it("offers chapter assignment for the selected node", () => {
    const grouped = {
      ...graph,
      chapters: [{ id: "opening", title: "序章" }, { id: "route", title: "分支章" }],
      nodes: graph.nodes.map((node) => node.id === "start" ? { ...node, chapterId: "opening" } : node),
    };
    const html = renderToStaticMarkup(createElement(NodeInspector, {
      graph: grouped,
      selectedNodeId: "start",
      onEnter: () => {},
      onRename: () => {},
      onSetChapter: () => {},
    }));

    expect(html).toContain("所属章节");
    expect(html).toContain("序章");
    expect(html).toContain("分支章");
    expect(html).not.toContain("未分章");
  });

  it("shows multi-exit branch controls in graph view instead of the text editor", () => {
    const html = renderToStaticMarkup(createElement(NodeInspector, {
      graph,
      selectedNodeId: "start",
      onEnter: () => {},
      onRename: () => {},
      onUpdateOutgoingEdges: () => {},
    }));

    expect(html).toContain("离开这个节点");
    expect(html).toContain("让玩家选择");
    expect(html).toContain("按故事状态自动分流");
    expect(html).toContain("去左边");
    expect(html).toContain("左线");
    expect(html).not.toContain("节点播放完后");
    // 出口在图上编辑，词汇不再暴露 auto/choice 这类实现术语。
    expect(html).not.toContain("自动判断");
  });

  it("renders product chrome in English while preserving creator-authored titles", () => {
    const html = renderToStaticMarkup(createElement(
      StudioI18nProvider,
      { preference: "en" },
      createElement(NodeInspector, {
        graph,
        selectedNodeId: "start",
        onEnter: () => {},
        onRename: () => {},
        onUpdateOutgoingEdges: () => {},
      }),
    ));

    expect(html).toContain("Properties");
    expect(html).toContain("Leaving this node");
    expect(html).toContain("Chapter");
    expect(html).toContain("Open editor");
    expect(html).toContain("序章");
    expect(html).toContain("开始");
    expect(html).toContain("去左边");
    expect(html).not.toContain("属性面板");
  });

  it("reorders outgoing edges without changing their identity", () => {
    const moved = moveEdge(graph.edges, 1, -1);
    expect(moved.map((edge) => edge.id)).toEqual(["start__right", "start__left"]);
    expect(moved[0]).toMatchObject(graph.edges[1]);
  });

  it("keeps invalid condition drafts local until they parse", () => {
    expect(commitConditionDraft("affection >")).toEqual({ ok: false, message: expect.any(String) });
    expect(commitConditionDraft("affection >= 3")).toEqual({ ok: true, condition: "affection >= 3" });
    expect(commitConditionDraft("   ")).toEqual({ ok: true, condition: null });
  });

  it("uses the same ordering model for drag and keeps the default auto edge last", () => {
    const auto = [
      { ...graph.edges[0], mode: "auto" as const, condition: null },
      { ...graph.edges[1], mode: "auto" as const, condition: "affection >= 3" },
    ];
    expect(orderDefaultAutoEdgeLast(auto).map((edge) => edge.id)).toEqual(["start__right", "start__left"]);
    expect(moveEdgeById(graph.edges, "start__right", "start__left").map((edge) => edge.id))
      .toEqual(moveEdge(graph.edges, 1, -1).map((edge) => edge.id));
  });
});
