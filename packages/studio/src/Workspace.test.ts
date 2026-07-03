import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { graphFocusTargetFromIssue, shouldStartWindowDrag } from "./Workspace";
import { Workspace } from "./Workspace";
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
  ScriptWorkspace: () => createElement("div", { "data-testid": "script-workspace" }),
}));

vi.mock("./features/assets/AssetsWorkspace", () => ({
  AssetsWorkspace: () => createElement("div", { "data-testid": "assets-workspace" }),
}));

vi.mock("./features/common/StatusPanel", () => ({
  StatusPanel: () => createElement("div", { "data-testid": "status-panel" }),
}));

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
});

const project: ProjectData = {
  path: "/project",
  meta: { name: "Galgame-test", activeRendererId: "default", createdAt: "0" },
  content: {
    manifest: { characters: {}, backgrounds: {}, audio: { bgm: {}, sfx: {}, voice: {} } },
    meta: {},
    chapters: [],
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
    }));

    expect(html).toContain("当前渲染层");
    expect(html).toContain("default");
    expect(html).not.toContain("<select");
  });
});
