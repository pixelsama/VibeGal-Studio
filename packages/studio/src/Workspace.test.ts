import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { graphFocusTargetFromIssue, projectIssueSourceLabel, shouldStartWindowDrag } from "./Workspace";
import { Workspace } from "./Workspace";
import { SIDEBAR_PREFS_STORAGE_KEY } from "./lib/sidebarPrefs";
import type { ProjectData } from "./lib/types";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ startDragging: vi.fn() }),
}));

vi.mock("./features/preview/Preview", () => ({
  Preview: ({ rendererId }: { rendererId: string }) => createElement("div", { "data-preview-renderer": rendererId }),
}));

vi.mock("./features/script/ScriptWorkspace", () => ({
  ScriptWorkspace: ({ outlineCollapsed }: { outlineCollapsed: boolean }) => createElement("div", {
    "data-testid": "script-workspace",
    "data-outline-collapsed": String(outlineCollapsed),
  }),
}));

vi.mock("./features/assets/AssetsWorkspace", () => ({
  AssetsWorkspace: ({ sidebarCollapsed }: { sidebarCollapsed: boolean }) => createElement("div", {
    "data-testid": "assets-workspace",
    "data-sidebar-collapsed": String(sidebarCollapsed),
  }),
}));

vi.mock("./features/project/ProjectSettings", () => ({
  ProjectSettings: () => createElement("div", { "data-testid": "project-settings-workspace" }, "项目设置内容"),
}));

vi.mock("./features/common/StatusPanel", () => ({
  StatusPanel: () => createElement("div", { "data-testid": "status-panel" }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

function targetWithClosest(result: Element | null): EventTarget {
  return {
    closest: () => result,
  } as unknown as EventTarget;
}

describe("shouldStartWindowDrag", () => {
  it("starts dragging when the primary button presses a non-interactive title bar area", () => {
    expect(shouldStartWindowDrag({ button: 0, target: targetWithClosest(null) })).toBe(true);
  });

  it("does not start dragging from interactive controls", () => {
    expect(shouldStartWindowDrag({ button: 0, target: targetWithClosest({} as Element) })).toBe(false);
  });

  it("does not start dragging from non-primary mouse buttons", () => {
    expect(shouldStartWindowDrag({ button: 1, target: targetWithClosest(null) })).toBe(false);
  });

  it("allows dragging when the event target has no closest helper", () => {
    expect(shouldStartWindowDrag({ button: 0, target: {} as EventTarget })).toBe(true);
  });
});

describe("graphFocusTargetFromIssue", () => {
  it("creates a node focus request for graph issues with nodeId", () => {
    expect(graphFocusTargetFromIssue({ source: "graph", nodeId: "intro" }, 3)).toEqual({
      requestId: 3,
      nodeId: "intro",
    });
  });

  it("creates an edge focus request for graph issues with edgeId", () => {
    expect(graphFocusTargetFromIssue({ source: "graph", edgeId: "intro__end" }, 4)).toEqual({
      requestId: 4,
      edgeId: "intro__end",
    });
  });

  it("ignores non-graph issues", () => {
    expect(graphFocusTargetFromIssue({ source: "asset", nodeId: "intro" }, 1)).toBeNull();
    expect(graphFocusTargetFromIssue({ source: "manifest" }, 1)).toBeNull();
  });

  it("creates a node focus request for node content issues with nodeId", () => {
    expect(graphFocusTargetFromIssue({ source: "node", nodeId: "intro" }, 5)).toEqual({
      requestId: 5,
      nodeId: "intro",
    });
  });

  it("resolves node content issues by file when nodeId is missing", () => {
    expect(
      graphFocusTargetFromIssue(
        { source: "node", file: "content/nodes/intro.json" },
        6,
        { nodes: [{ id: "intro", title: "Intro", file: "nodes/intro.json", position: { x: 0, y: 0 } }] },
      ),
    ).toEqual({
      requestId: 6,
      nodeId: "intro",
    });
  });
});

describe("projectIssueSourceLabel", () => {
  it("labels node issues as node content", () => {
    expect(projectIssueSourceLabel("node")).toBe("节点内容");
  });

  it("labels meta issues as project settings", () => {
    expect(projectIssueSourceLabel("meta")).toBe("项目设置");
  });
});

const project: ProjectData = {
  path: "/project",
  meta: { name: "Galgame-test", activeRendererId: "default", createdAt: "0" },
  content: {
    manifest: { characters: {}, backgrounds: {}, audio: { bgm: {}, sfx: {}, voice: {} } },
    meta: {},
  },
  rendererIds: ["default", "mobile"],
};

describe("Workspace renderer chrome", () => {
  it("shows the current renderer as read-only title bar text instead of a select", () => {
    const html = renderToStaticMarkup(createElement(Workspace, {
      project,
      location: { type: "workspace", workspace: "render" },
      canGoBack: false,
      canGoForward: false,
      onBack: () => {},
      onForward: () => {},
      onNavigate: () => {},
      onReplaceLocation: () => {},
      onProjectChanged: () => {},
      onOpenSettings: () => {},
    }));

    expect(html).toContain("当前渲染层");
    expect(html).toContain("default");
    expect(html).not.toContain("<select");
  });

  it("renders project workspace tabs and keeps global settings as a gear action", () => {
    const html = renderToStaticMarkup(createElement(Workspace, {
      project,
      location: { type: "workspace", workspace: "project" },
      canGoBack: false,
      canGoForward: false,
      onBack: () => {},
      onForward: () => {},
      onNavigate: () => {},
      onReplaceLocation: () => {},
      onProjectChanged: () => {},
      onOpenSettings: () => {},
    }));

    expect(html).toContain("渲染");
    expect(html).toContain("脚本");
    expect(html).toContain("资产");
    expect(html).toContain("项目");
    expect(html).not.toContain(">Render<");
    expect(html).not.toContain(">Script<");
    expect(html).not.toContain(">Assets<");
    expect(html).not.toContain(">设置<");
    expect(html).toContain('aria-label="设置"');
    expect(html).toContain("⚙");
    expect(html).toContain("项目设置内容");
  });

  it("restores persisted sidebar collapse preferences", () => {
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => key === SIDEBAR_PREFS_STORAGE_KEY
        ? JSON.stringify({
          renderSidebarCollapsed: true,
          assetsSidebarCollapsed: true,
          scriptOutlineCollapsed: true,
        })
        : null),
      setItem: vi.fn(),
    });

    const baseProps = {
      project,
      canGoBack: false,
      canGoForward: false,
      onBack: () => {},
      onForward: () => {},
      onNavigate: () => {},
      onReplaceLocation: () => {},
      onProjectChanged: () => {},
      onOpenSettings: () => {},
    };

    const renderHtml = renderToStaticMarkup(createElement(Workspace, {
      ...baseProps,
      location: { type: "workspace", workspace: "render" },
    }));
    const scriptHtml = renderToStaticMarkup(createElement(Workspace, {
      ...baseProps,
      location: { type: "script-graph" },
    }));
    const assetsHtml = renderToStaticMarkup(createElement(Workspace, {
      ...baseProps,
      location: { type: "workspace", workspace: "assets" },
    }));

    expect(renderHtml).toContain('aria-label="展开渲染层"');
    expect(scriptHtml).toContain('data-outline-collapsed="true"');
    expect(assetsHtml).toContain('data-sidebar-collapsed="true"');
  });
});
