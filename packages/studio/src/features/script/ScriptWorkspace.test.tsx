import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Breadcrumb } from "./Breadcrumb";
import {
  buildGraphPositionUpdates,
  persistCreatedNodeWithCompensation,
  ScriptWorkspace,
  takePendingGraphPositionUpdates,
} from "./ScriptWorkspace";
import type { FileRevision, ProjectData, ProjectGraph } from "../../lib/types";

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
  saveGraphPositions: vi.fn(),
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

describe("Breadcrumb", () => {
  it("shows direct Chinese labels for the script graph trail", () => {
    const html = renderToStaticMarkup(createElement(Breadcrumb, {
      view: "graph",
      selectedNodeTitle: null,
      onBackToGraph: () => {},
    }));

    expect(html).toContain("脚本");
    expect(html).toContain("流程图");
  });
});

describe("graph position patch", () => {
  it("graphPositionPatchBuildsOnlyMovedNodes", () => {
    const next: ProjectGraph = {
      ...graph,
      nodes: [
        { ...graph.nodes[0], position: { x: 24, y: 48 } },
        { id: "external", title: "External", file: "nodes/external.json", position: { x: 9, y: 9 } },
      ],
    };

    expect(buildGraphPositionUpdates(graph, next)).toEqual([
      { id: "prologue", position: { x: 24, y: 48 } },
    ]);
  });

  it("drains the latest debounced position for each node before navigation", () => {
    const pending = new Map([
      ["prologue", { x: 10, y: 20 }],
      ["ending", { x: 30, y: 40 }],
    ]);

    expect(takePendingGraphPositionUpdates(pending)).toEqual([
      { id: "prologue", position: { x: 10, y: 20 } },
      { id: "ending", position: { x: 30, y: 40 } },
    ]);
    expect(pending.size).toBe(0);
  });
});

describe("multi-file node creation", () => {
  it("removes the newly created file with its revision when graph persistence fails", async () => {
    const createdRevision: FileRevision = {
      relPath: "content/nodes/new.json",
      mtimeMs: 10,
      size: 2,
    };
    const deleted: Array<{ relPath: string; revision?: FileRevision | null }> = [];

    const result = await persistCreatedNodeWithCompensation({
      projectPath: "/project",
      nodeFile: "nodes/new.json",
      content: "[]",
      graph,
      saveFileFn: async () => createdRevision,
      persistGraphFn: async () => false,
      deleteFileFn: async (_projectPath, relPath, revision) => {
        deleted.push({ relPath, revision });
      },
    });

    expect(result).toEqual({ saved: false, rolledBack: true });
    expect(deleted).toEqual([{ relPath: "nodes/new.json", revision: createdRevision }]);
  });

  it("keeps the created node file after graph persistence succeeds", async () => {
    let deleted = false;

    const result = await persistCreatedNodeWithCompensation({
      projectPath: "/project",
      nodeFile: "nodes/new.json",
      content: "[]",
      graph,
      saveFileFn: async () => null,
      persistGraphFn: async () => true,
      deleteFileFn: async () => {
        deleted = true;
      },
    });

    expect(result).toEqual({ saved: true, rolledBack: false });
    expect(deleted).toBe(false);
  });
});
