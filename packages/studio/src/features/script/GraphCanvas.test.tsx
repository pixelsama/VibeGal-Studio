import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GraphCanvas } from "./GraphCanvas";
import type { ProjectGraph } from "../../lib/types";

vi.mock("@xyflow/react", async () => {
  const React = await import("react");

  return {
    ReactFlow: ({ children }: { children?: React.ReactNode }) =>
      React.createElement("div", { "data-testid": "react-flow" }, children),
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

const graph: ProjectGraph = {
  version: 1,
  entryNodeId: "start",
  nodes: [
    { id: "start", title: "Start", file: "nodes/start.json", position: { x: 0, y: 0 } },
  ],
  edges: [],
};

const noop = () => {};

describe("GraphCanvas", () => {
  it("keeps canvas navigation actions together and removes the floating quick-create button", () => {
    const html = renderToStaticMarkup(
      <GraphCanvas
        graph={graph}
        selectedNodeId={null}
        selectedEdgeId={null}
        onSelect={noop}
        onSelectEdge={noop}
        onEnter={noop}
        onMoveNode={noop}
        onConnect={noop}
        onDeleteNodes={noop}
        onDeleteEdge={noop}
        onCreateNodeAt={noop}
      />,
    );

    expect(html).toContain('data-testid="graph-controls"');
    expect(html).toContain('data-control-title="定位入口节点"');
    expect(html).not.toContain('title="在视口中心新建节点"');
  });
});
