import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Breadcrumb } from "./Breadcrumb";
import {
  buildGraphPositionUpdates,
  editorSnapshotAfterRefresh,
  nodeExternalChange,
  nodeFileForEditorRoute,
  persistCreatedNodeWithCompensation,
  projectChangeAfterResolution,
  ScriptWorkspace,
  takePendingGraphPositionUpdates,
} from "./ScriptWorkspace";
import type { FileRevision, ProjectData, ProjectGraph } from "../../lib/types";
import { StudioI18nProvider } from "../../lib/i18n";

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
  saveLocale: vi.fn(),
  saveNode: vi.fn(),
  saveManifest: vi.fn(),
  saveVariables: vi.fn(),
  renameVariable: vi.fn(),
  readNodeCreatorSummaries: vi.fn().mockResolvedValue([]),
  readNodeDetail: vi.fn(),
  readProjectNodes: vi.fn(),
}));

const graph: ProjectGraph = {
  version: 1,
  entryNodeId: "prologue",
  chapters: [{ id: "opening", title: "序章" }],
  nodes: [
    { id: "prologue", title: "序章", file: "nodes/prologue.json", position: { x: 0, y: 0 }, chapterId: "opening" },
  ],
  edges: [],
};

const project: ProjectData = {
  path: "/project",
  meta: { name: "T", activeRendererId: "default", createdAt: "0" },
  content: {
    manifest: { characters: {}, backgrounds: {}, audio: { bgm: {}, sfx: {}, voice: {} } },
    meta: {},
    variables: { version: 1, variables: {} },
  },
  rendererIds: ["default"],
  graph,
  nodes: [{ relPath: "nodes/prologue.json", data: [] }],
};

describe("ScriptWorkspace sidebar", () => {
  it("renders the primary script workspace surface in English while preserving creator content", () => {
    const html = renderToStaticMarkup(createElement(
      StudioI18nProvider,
      { preference: "en" },
      createElement(ScriptWorkspace, {
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
      }),
    ));

    expect(html).toContain('aria-label="Story structure"');
    expect(html).toContain("Story flow");
    expect(html).toContain("Story state");
    expect(html).toContain("Translation comparison");
    expect(html).toContain('class="gs-graph-layout"');
    expect(html).toContain("flex-wrap:wrap");
    // Spec 33 E10：面板内 tab（三级导航）用弱化变体，与工作区 tab 区分层级
    expect(html).toContain("gs-tab--pane");
    expect(html).toContain("New node");
    expect(html).toContain("序章");
    expect(html).not.toContain("剧情流程");
  });

  it("keeps the story structure visible inside the expanded collapsible sidebar in graph view", () => {
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

    expect(html).toContain("aria-label=\"故事结构\"");
    expect(html).toContain("aria-expanded=\"true\"");
    expect(html).toContain("序章");
    expect(html).toContain("全部节点");
    expect(html).toContain("翻译对照");
  });

  it("wires the script view tabs with roving tabindex and panel association", () => {
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

    // 默认 flow tab 在 tab 序列中（tabindex 0），其余 -1（roving tabindex）
    expect(html).toMatch(/<button[^>]*id="script-tab-flow"[^>]*tabindex="0"[^>]*>/);
    expect(html).toMatch(/<button[^>]*id="script-tab-state"[^>]*tabindex="-1"[^>]*>/);
    expect(html).toMatch(/<button[^>]*id="script-tab-translation"[^>]*tabindex="-1"[^>]*>/);
    // tab 关联面板
    expect(html).toContain('aria-controls="script-tabpanel"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('aria-labelledby="script-tab-flow"');
  });

});

describe("external node refresh retention", () => {
  const baseDetail = {
    relPath: "nodes/prologue.json",
    data: [{ t: "narrate", text: "base" }],
    text: '[{"t":"narrate","text":"base"}]',
    revision: {
      relPath: "content/nodes/prologue.json",
      mtimeMs: 1,
      size: 32,
    },
  };
  const diskDetail = {
    ...baseDetail,
    data: [{ t: "narrate", text: "disk" }],
    text: '[{"t":"narrate","text":"disk"}]',
    revision: { ...baseDetail.revision, mtimeMs: 2 },
  };

  it("loads the newly selected node instead of a retained snapshot from the previous route", () => {
    expect(nodeFileForEditorRoute({
      location: { view: "node", nodeId: "ending" },
      projectPath: "/project",
      selectedNodeFile: "nodes/ending.json",
      retainedNode: {
        projectPath: "/project",
        nodeId: "prologue",
        nodeFile: "nodes/prologue.json",
      },
    })).toBe("nodes/ending.json");
  });

  it("keeps the retained path only when it belongs to the active node route", () => {
    expect(nodeFileForEditorRoute({
      location: { view: "node", nodeId: "prologue" },
      projectPath: "/project",
      selectedNodeFile: undefined,
      retainedNode: {
        projectPath: "/project",
        nodeId: "prologue",
        nodeFile: "nodes/prologue.json",
      },
    })).toBe("nodes/prologue.json");
    expect(nodeFileForEditorRoute({
      location: { view: "node", nodeId: "prologue" },
      projectPath: "/another-project",
      selectedNodeFile: "nodes/replacement.json",
      retainedNode: {
        projectPath: "/project",
        nodeId: "prologue",
        nodeFile: "nodes/prologue.json",
      },
    })).toBe("nodes/replacement.json");
    expect(nodeFileForEditorRoute({
      location: { view: "graph" },
      projectPath: "/project",
      selectedNodeFile: "nodes/prologue.json",
      retainedNode: null,
    })).toBe("");
  });

  it("retains the last good base while a dirty draft receives a refreshed detail", () => {
    expect(editorSnapshotAfterRefresh({
      current: baseDetail,
      incoming: diskDetail,
      dirty: true,
      externalChange: { kind: "modified", eventCount: 2 },
    })).toBe(baseDetail);
  });

  it("retains the last good base when deletion or rename removes the incoming detail", () => {
    expect(editorSnapshotAfterRefresh({
      current: baseDetail,
      incoming: null,
      dirty: true,
      externalChange: { kind: "deleted", eventCount: 1 },
    })).toBe(baseDetail);
    expect(editorSnapshotAfterRefresh({
      current: baseDetail,
      incoming: null,
      dirty: true,
      externalChange: {
        kind: "renamed",
        eventCount: 3,
        relatedPaths: ["content/nodes/renamed.json"],
      },
    })).toBe(baseDetail);
  });

  it("uses the refreshed detail after a clean editor refresh", () => {
    expect(editorSnapshotAfterRefresh({
      current: baseDetail,
      incoming: diskDetail,
      dirty: false,
      externalChange: null,
    })).toBe(diskDetail);
  });

  it("does not reopen a resolved watcher payload on an unrelated rerender", () => {
    const payload = {
      projectPath: "/project",
      rendererChanged: false,
      eventCount: 1,
      changes: [{
        kind: "modify" as const,
        paths: ["content/nodes/prologue.json"],
      }],
    };

    expect(projectChangeAfterResolution({
      payload,
      resolved: {
        payload,
        nodeFile: "nodes/prologue.json",
      },
      nodeFile: "nodes/prologue.json",
    })).toBeNull();
    expect(projectChangeAfterResolution({
      payload,
      resolved: {
        payload,
        nodeFile: "nodes/prologue.json",
      },
      nodeFile: "nodes/ending.json",
    })).toBe(payload);
    expect(projectChangeAfterResolution({
      payload: { ...payload },
      resolved: {
        payload,
        nodeFile: "nodes/prologue.json",
      },
      nodeFile: "nodes/prologue.json",
    })).not.toBeNull();
  });

  it("classifies a rename before a coalesced remove in the same watcher burst", () => {
    expect(nodeExternalChange({
      projectPath: "/project",
      rendererChanged: false,
      eventCount: 2,
      changes: [
        { kind: "remove", paths: ["content/nodes/prologue.json"] },
        {
          kind: "rename",
          paths: ["content/nodes/prologue.json", "content/nodes/renamed.json"],
        },
      ],
    }, "nodes/prologue.json")).toEqual({
      kind: "renamed",
      eventCount: 2,
      relatedPaths: ["content/nodes/renamed.json"],
    });
  });
});

describe("Breadcrumb", () => {
  it("shows direct Chinese labels for the script graph trail", () => {
    const html = renderToStaticMarkup(createElement(Breadcrumb, {
      view: "graph",
      selectedNodeTitle: null,
      onBackToGraph: () => {},
    }));

    expect(html).toContain("剧情");
    expect(html).not.toContain("脚本");
    expect(html).toContain("流程图");
  });
});

describe("graph position patch", () => {
  it("graphPositionPatchBuildsOnlyMovedNodes", () => {
    const next: ProjectGraph = {
      ...graph,
      nodes: [
        { ...graph.nodes[0], position: { x: 24, y: 48 } },
        { id: "external", title: "External", file: "nodes/external.json", position: { x: 9, y: 9 }, chapterId: "opening" },
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
