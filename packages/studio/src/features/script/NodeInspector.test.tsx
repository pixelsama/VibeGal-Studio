import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProjectGraph } from "../../lib/types";
import { NodeInspector } from "./NodeInspector";

const graph: ProjectGraph = {
  version: 1,
  entryNodeId: "start",
  nodes: [
    { id: "start", title: "开始", file: "nodes/start.json", position: { x: 0, y: 0 } },
    { id: "left", title: "左线", file: "nodes/left.json", position: { x: 200, y: -60 } },
    { id: "right", title: "右线", file: "nodes/right.json", position: { x: 200, y: 60 } },
  ],
  edges: [
    { id: "start__left", from: "start", to: "left", mode: "choice", label: "去左边", condition: null },
    { id: "start__right", from: "start", to: "right", mode: "choice", label: "去右边", condition: null },
  ],
};

describe("NodeInspector graph exits", () => {
  it("shows multi-exit branch controls in graph view instead of the text editor", () => {
    const html = renderToStaticMarkup(createElement(NodeInspector, {
      graph,
      selectedNodeId: "start",
      onEnter: () => {},
      onRename: () => {},
      onUpdateOutgoingEdges: () => {},
    }));

    expect(html).toContain("结束方式");
    expect(html).toContain("玩家选择");
    expect(html).toContain("自动判断");
    expect(html).toContain("去左边");
    expect(html).toContain("左线");
    expect(html).not.toContain("节点播放完后");
  });
});
