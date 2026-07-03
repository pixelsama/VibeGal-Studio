import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ScriptWorkspace } from "./ScriptWorkspace";
import type { ProjectData, ProjectGraph } from "../../lib/types";

vi.mock("@xyflow/react", async () => {
  const React = await import("react");
  return {
    ReactFlow: ({ children }: { children?: React.ReactNode }) =>
      React.createElement("div", { "data-testid": "react-flow" }, children),
    Background: () => React.createElement("div", { "data-testid": "background" }),
    Controls: ({ children }: { children?: React.ReactNode }) =>
      React.createElement("div", { "data-testid": "graph-controls" }, children),
    ControlButton: ({ children, title, ...rest }: { children?: React.ReactNode; title?: string }) =>
      React.createElement("button", { type: "button", title, ...rest }, children),
    MiniMap: () => React.createElement("div", { "data-testid": "mini-map" }),
    Handle: () => null,
    Position: { Left: "left", Right: "right" },
    applyEdgeChanges: (_changes: unknown, edges: unknown) => edges,
    applyNodeChanges: (_changes: unknown, nodes: unknown) => nodes,
  };
});

vi.mock("../../lib/tauri", () => ({
  deleteFile: vi.fn(),
  saveFile: vi.fn(),
  saveGraph: vi.fn(),
}));

const graph: ProjectGraph = {
  version: 1,
  entryNodeId: "prologue",
  nodes: [
    { id: "prologue", title: "序章", file: "nodes/prologue.json", position: { x: 0, y: 0 } },
  ],
  edges: [],
};

const project: ProjectData = {
  path: "/project",
  meta: { name: "T", activeRendererId: "default", createdAt: "0" },
  content: {
    manifest: { characters: {}, backgrounds: {}, audio: { bgm: {}, sfx: {}, voice: {} } },
    meta: {},
    chapters: [],
  },
  rendererIds: ["default"],
  graph,
  nodes: [{ relPath: "nodes/prologue.json", data: [] }],
};

describe("ScriptWorkspace sidebar", () => {
  it("keeps the node outline visible inside the expanded collapsible sidebar in graph view", () => {
    const html = renderToStaticMarkup(createElement(ScriptWorkspace, {
      project,
      rendererId: "default",
      refreshKey: 0,
      outlineCollapsed: false,
      onOutlineCollapsedChange: () => {},
      location: { view: "graph" },
      onOpenGraph: () => {},
      onOpenNode: () => {},
      onReplaceWithGraph: () => {},
      onSaved: () => {},
    }));

    expect(html).toContain("aria-label=\"节点\"");
    expect(html).toContain("aria-expanded=\"true\"");
    expect(html).toContain("序章");
  });
});
