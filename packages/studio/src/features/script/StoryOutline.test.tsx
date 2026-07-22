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
    { id: "loose", title: "待整理", file: "nodes/loose.json", position: { x: 400, y: 0 } },
  ],
  edges: [],
};

describe("StoryOutline", () => {
  it("shows ordered chapters, counts, all-nodes, and unassigned navigation", () => {
    const html = renderToStaticMarkup(createElement(StoryOutline, {
      graph,
      scope: { kind: "chapter", chapterId: "choice" },
      selectedNodeId: null,
      onScopeChange: () => {},
      onSelectNode: () => {},
      onCreateChapter: () => {},
      onRenameChapter: () => {},
      onMoveChapter: () => {},
      onDeleteChapter: () => {},
    }));

    expect(html).toContain("故事结构");
    expect(html).toContain("全部流程");
    expect(html).toContain("序章");
    expect(html).toContain("黎明抉择");
    expect(html).toContain("未分章");
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('aria-label="新建章节"');
    expect(html).toContain('aria-label="搜索故事"');
  });
});
