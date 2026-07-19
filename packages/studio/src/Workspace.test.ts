import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  graphFocusTargetFromIssue,
  projectIssueSourceLabel,
  shouldConfirmUnsavedNavigation,
  shouldStartWindowDrag,
} from "./Workspace";
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

vi.mock("./features/export/ExportWorkspace", () => ({
  ExportWorkspace: ({ hasUnsavedChanges }: { hasUnsavedChanges: boolean }) => createElement("div", {
    "data-testid": "export-workspace",
    "data-unsaved": String(hasUnsavedChanges),
  }, "导出工作台内容"),
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

describe("workspace unsaved navigation", () => {
  it("guards workspace, history, settings, and project navigation while a draft is dirty", () => {
    expect(shouldConfirmUnsavedNavigation(true)).toBe(true);
    expect(shouldConfirmUnsavedNavigation(false)).toBe(false);
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
  it("顶栏以「界面风格」选择器作为渲染层唯一切换入口（Spec 19 §4.2）", () => {
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

    expect(html).toContain("界面风格");
    expect(html).not.toContain("当前渲染层");
    expect(html).toContain('aria-label="界面风格"');
    expect(html).toContain("<select");
    expect(html).toContain(">default</option>");
    expect(html).toContain(">mobile</option>");
    // 选择器附近带 AI 生成引导（title 级）
    expect(html).toContain("新界面风格可由 AI 在 renderers/ 目录下生成，出现后自动可选择");
  });

  it("预览工作区不再挂载渲染层侧栏与其管理按钮（Spec 19 §4.2）", () => {
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

    expect(html).not.toContain("渲染层列表");
    expect(html).not.toContain("渲染层诊断");
    expect(html).not.toContain(">新建</button>");
    expect(html).not.toContain(">重命名</button>");
  });

  it("renderers/ 为空时选择器为空态并展示 AI 生成引导文案（Spec 19 §6）", () => {
    const emptyProject: ProjectData = {
      ...project,
      meta: { ...project.meta, activeRendererId: "" },
      rendererIds: [],
    };
    const html = renderToStaticMarkup(createElement(Workspace, {
      project: emptyProject,
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

    expect(html).toContain("无界面风格");
    expect(html).toContain("新界面风格可由 AI 在 renderers/ 目录下生成，出现后自动可选择");
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

    expect(html).toContain("预览");
    expect(html).toContain("脚本");
    expect(html).toContain("资产");
    expect(html).toContain("项目");
    expect(html).toContain("导出");
    expect(html).not.toContain(">渲染<");
    expect(html).not.toContain(">Render<");
    expect(html).not.toContain(">Script<");
    expect(html).not.toContain(">Assets<");
    expect(html).not.toContain(">设置<");
    expect(html).toContain('aria-label="设置"');
    expect(html).toContain("lucide-settings");
    expect(html).toContain("项目设置内容");
  });

  it("renders the export workspace for the export location", () => {
    const html = renderToStaticMarkup(createElement(Workspace, {
      project,
      location: { type: "workspace", workspace: "export" },
      canGoBack: false,
      canGoForward: false,
      onBack: () => {},
      onForward: () => {},
      onNavigate: () => {},
      onReplaceLocation: () => {},
      onProjectChanged: () => {},
      onOpenSettings: () => {},
    }));

    expect(html).toContain("导出工作台内容");
  });

  it("restores persisted sidebar collapse preferences", () => {
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => key === SIDEBAR_PREFS_STORAGE_KEY
        ? JSON.stringify({
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

    const scriptHtml = renderToStaticMarkup(createElement(Workspace, {
      ...baseProps,
      location: { type: "script-graph" },
    }));
    const assetsHtml = renderToStaticMarkup(createElement(Workspace, {
      ...baseProps,
      location: { type: "workspace", workspace: "assets" },
    }));

    expect(scriptHtml).toContain('data-outline-collapsed="true"');
    expect(assetsHtml).toContain('data-sidebar-collapsed="true"');
  });
});
