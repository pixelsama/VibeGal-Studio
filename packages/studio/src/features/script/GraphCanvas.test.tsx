import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { filterVisibleCanvasElements, GraphCanvas, shouldLocateSelectedNode } from "./GraphCanvas";
import type { ProjectGraph } from "../../lib/types";
import { StudioI18nProvider } from "../../lib/i18n";

vi.mock("@xyflow/react", async () => {
  const React = await import("react");

  return {
    ReactFlow: ({
      children,
      connectOnClick,
      nodeClickDistance,
      colorMode,
      nodes,
      edges,
    }: {
      children?: React.ReactNode;
      connectOnClick?: boolean;
      nodeClickDistance?: number;
      colorMode?: string;
      nodes?: unknown[];
      edges?: unknown[];
    }) =>
      React.createElement(
        "div",
        {
          "data-testid": "react-flow",
          "data-connect-on-click": String(connectOnClick),
          "data-node-click-distance": nodeClickDistance,
          "data-color-mode": colorMode,
          "data-node-count": nodes?.length ?? 0,
          "data-edge-count": edges?.length ?? 0,
        },
        children,
      ),
    Background: () => React.createElement("div", { "data-testid": "background" }),
    Controls: ({ children }: { children?: React.ReactNode }) =>
      React.createElement("div", { "data-testid": "graph-controls" }, children),
    ControlButton: ({ children, title, ...rest }: { children?: React.ReactNode; title?: string }) =>
      React.createElement("button", { type: "button", "data-control-title": title, title, ...rest }, children),
    MiniMap: () => React.createElement("div", { "data-testid": "mini-map" }),
    Handle: () => null,
    Position: { Left: "left", Right: "right" },
    applyEdgeChanges: (_changes: unknown, edges: unknown) => edges,
    applyNodeChanges: (_changes: unknown, nodes: unknown) => nodes,
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const graph: ProjectGraph = {
  version: 1,
  entryNodeId: "start",
  chapters: [{ id: "opening", title: "第一章" }],
  nodes: [
    { id: "start", title: "Start", file: "nodes/start.json", position: { x: 0, y: 0 }, chapterId: "opening" },
  ],
  edges: [],
};

const noop = () => {};

const baseProps = {
  graph,
  selectedNodeId: null,
  selectedEdgeId: null,
  onSelect: noop,
  onSelectEdge: noop,
  onEnter: noop,
  onMoveNode: noop,
  onConnect: noop,
  onDeleteNodes: noop,
  onDeleteEdge: noop,
};

describe("GraphCanvas", () => {
  it("relocates only for a new selection or an explicit programmatic locate request", () => {
    expect(shouldLocateSelectedNode("node", "node", false)).toBe(false);
    expect(shouldLocateSelectedNode("node", "other", false)).toBe(true);
    expect(shouldLocateSelectedNode("node", "node", true)).toBe(true);
    expect(shouldLocateSelectedNode(null, null, true)).toBe(false);
  });

  it("surfaces auto-layout and fit-view as persistent canvas controls (spec 33 E5)", () => {
    const html = renderToStaticMarkup(
      <GraphCanvas
        {...baseProps}
        onAutoLayout={noop}
      />,
    );

    expect(html).toContain('data-control-title="自动排布"');
    expect(html).toContain('data-control-title="重置视图"');
  });

  it("keeps canvas navigation actions together and removes the floating quick-create button", () => {
    const html = renderToStaticMarkup(
      <GraphCanvas
        {...baseProps}
        canUndo
        canRedo
        onUndo={noop}
        onRedo={noop}
        onCreateNodeAt={noop}
      />,
    );

    expect(html).toContain('data-testid="graph-controls"');
    expect(html).toContain('data-control-title="定位入口节点"');
    expect(html).toContain('data-control-title="撤销图编辑（Ctrl+Z）"');
    expect(html).toContain('data-control-title="重做图编辑（Ctrl+Shift+Z）"');
    expect(html).not.toContain('title="在视口中心新建节点"');
  });

  it("keeps node selection tolerant to slight pointer movement", () => {
    const html = renderToStaticMarkup(
      <GraphCanvas {...baseProps} canUndo={false} canRedo={false} onUndo={noop} onRedo={noop} />,
    );

    expect(html).toContain('data-node-click-distance="6"');
    expect(html).toContain('data-connect-on-click="false"');
  });

  it("defaults the canvas color mode to dark", () => {
    const html = renderToStaticMarkup(<GraphCanvas {...baseProps} />);

    expect(html).toContain('data-color-mode="dark"');
  });

  it("follows the applied light theme for the canvas color mode", () => {
    vi.stubGlobal("document", { documentElement: { dataset: { theme: "light" } } });

    const html = renderToStaticMarkup(<GraphCanvas {...baseProps} />);

    expect(html).toContain('data-color-mode="light"');
  });

  it("renders graph controls in English without translating project content", () => {
    const html = renderToStaticMarkup(
      <StudioI18nProvider preference="en">
        <GraphCanvas
          {...baseProps}
          canUndo
          canRedo
          onUndo={noop}
          onRedo={noop}
        />
      </StudioI18nProvider>,
    );

    expect(html).toContain('data-control-title="Locate entry node"');
    expect(html).toContain('data-control-title="Undo graph edit (Ctrl+Z)"');
    expect(html).toContain('data-control-title="Redo graph edit (Ctrl+Shift+Z)"');
    expect(html).not.toContain('data-control-title="定位入口节点"');
  });

  it("filters visible elements after full-graph status mapping", () => {
    const elements = filterVisibleCanvasElements(
      [{ id: "start", status: "normal" }, { id: "next", status: "ending" }],
      [{ id: "start__next", source: "start", target: "next" }],
      new Set(["start"]),
    );

    expect(elements.nodes).toEqual([{ id: "start", status: "normal" }]);
    expect(elements.edges).toEqual([]);
  });
});
