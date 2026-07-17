import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GraphCanvas } from "./GraphCanvas";
import type { ProjectGraph } from "../../lib/types";

vi.mock("@xyflow/react", async () => {
  const React = await import("react");

  return {
    ReactFlow: ({
      children,
      connectOnClick,
      nodeClickDistance,
      colorMode,
    }: {
      children?: React.ReactNode;
      connectOnClick?: boolean;
      nodeClickDistance?: number;
      colorMode?: string;
    }) =>
      React.createElement(
        "div",
        {
          "data-testid": "react-flow",
          "data-connect-on-click": String(connectOnClick),
          "data-node-click-distance": nodeClickDistance,
          "data-color-mode": colorMode,
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
  nodes: [
    { id: "start", title: "Start", file: "nodes/start.json", position: { x: 0, y: 0 } },
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
});
