import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Instruction } from "@vibegal/engine";
import { describe, expect, it, vi } from "vitest";
import {
  clampNodeInspectorPaneWidth,
  conflictDraftCopyPath,
  insertScenarioCommandAtCursor,
  isWriteConflictError,
  NodeEditor,
  nodeEditorKeepsDraftOnWriteConflict,
  resolveNodeInspectorPaneLayout,
  scenarioCommandTriggerAtCursor,
} from "./NodeEditor";
import { isSaveKeyboardShortcut } from "./unsavedChanges";
import { NodeEditorToolbar } from "./NodeEditorToolbar";
import type { ProjectData } from "../../lib/types";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

describe("NodeEditor safe persistence", () => {
  it("supports the platform save shortcut", () => {
    expect(isSaveKeyboardShortcut({ key: "s", metaKey: true, ctrlKey: false })).toBe(true);
    expect(isSaveKeyboardShortcut({ key: "s", metaKey: false, ctrlKey: true })).toBe(true);
  });

  it("nodeEditorKeepsDraftOnWriteConflict", () => {
    const draft = {
      text: '[{"t":"narrate","text":"local draft"}]',
      instructions: [{ t: "narrate", text: "local draft" }] as Instruction[],
    };
    const error = JSON.stringify({ code: "write_conflict", file: "content/nodes/start.json" });

    const result = nodeEditorKeepsDraftOnWriteConflict(draft, error);

    expect(result.conflict).toBe(true);
    expect(result.draft).toBe(draft);
    expect(isWriteConflictError(error)).toBe(true);
  });

  it("builds conflict draft copy path next to the node file", () => {
    expect(conflictDraftCopyPath("nodes/act1/start.json", 123)).toBe("nodes/act1/start.conflict-123.json");
  });
});

describe("NodeEditor scenario command surface", () => {
  it("detects @ and / command triggers at the current line", () => {
    expect(scenarioCommandTriggerAtCursor("@b", 2)).toMatchObject({
      trigger: "@",
      query: "b",
      replaceStart: 0,
      replaceEnd: 2,
    });
    expect(scenarioCommandTriggerAtCursor("第一句\n/ch", "第一句\n/ch".length)).toMatchObject({
      trigger: "/",
      query: "ch",
      replaceStart: 4,
      replaceEnd: 7,
    });
    expect(scenarioCommandTriggerAtCursor("明里: @", "明里: @".length)).toBeNull();
  });

  it("replaces command triggers or inserts after the current nonblank line", () => {
    expect(insertScenarioCommandAtCursor("@b", 2, "@bg classroom fade")).toEqual({
      text: "@bg classroom fade",
      cursorOffset: "@bg classroom fade".length,
    });
    expect(insertScenarioCommandAtCursor("第一句\n第二句", 2, "@wait 800")).toEqual({
      text: "第一句\n@wait 800\n第二句",
      cursorOffset: "第一句\n@wait 800".length,
    });
  });
});

describe("NodeEditor scenario surface", () => {
  it("uses line-local command insertion instead of a fixed insert toolbar", () => {
    const node = { id: "start", title: "开始", file: "nodes/start.json", position: { x: 0, y: 0 } };
    const project: ProjectData = {
      path: "/tmp/vibegal-test",
      meta: { name: "Test", activeRendererId: "default", createdAt: "2026-01-01T00:00:00.000Z" },
      content: {
        manifest: { characters: {}, backgrounds: {}, audio: { bgm: {}, sfx: {}, voice: {} } },
        meta: { stage: { width: 1280, height: 720 } },
      },
      rendererIds: ["default"],
      graph: { version: 1, entryNodeId: "start", nodes: [node], edges: [] },
      nodes: [{ relPath: "nodes/start.json", data: [{ t: "narrate", text: "新的故事从这里开始。" }] }],
      projectReport: { projectIssues: [] },
    };

    const html = renderToStaticMarkup(createElement(NodeEditor, {
      project,
      rendererId: "default",
      node,
      nodeData: [{ t: "narrate", text: "新的故事从这里开始。" }],
      onSaved: () => {},
    }));

    expect(html).not.toContain("大纲");
    expect(html).not.toContain("+ 背景");
    expect(html).not.toContain("+ 台词");
    expect(html).toContain("aria-label=\"插入当前行命令\"");
    expect(html).toContain("data-node-view-layout=\"editor-preview-inspector\"");
    expect(html).toContain("aria-label=\"切换 Inspector 面板\"");
    expect(html).toContain("aria-label=\"调整 Inspector 宽度\"");
    expect(html).not.toContain("节点出口");
    expect(html).not.toContain("连接下一个节点");
    expect(html).not.toContain("添加玩家选择");
  });

  it("shows starter templates instead of a blank editor when the node is empty", () => {
    const node = { id: "start", title: "开始", file: "nodes/start.json", position: { x: 0, y: 0 } };
    const project: ProjectData = {
      path: "/tmp/vibegal-test",
      meta: { name: "Test", activeRendererId: "default", createdAt: "2026-01-01T00:00:00.000Z" },
      content: {
        manifest: { characters: {}, backgrounds: {}, audio: { bgm: {}, sfx: {}, voice: {} } },
        meta: { stage: { width: 1280, height: 720 } },
      },
      rendererIds: ["default"],
      graph: { version: 1, entryNodeId: "start", nodes: [node], edges: [] },
      nodes: [{ relPath: "nodes/start.json", data: [] }],
      projectReport: { projectIssues: [] },
    };

    const html = renderToStaticMarkup(createElement(NodeEditor, {
      project,
      rendererId: "default",
      node,
      nodeData: [],
      onSaved: () => {},
    }));

    expect(html).toContain("data-region=\"scenario-starter-guide\"");
    expect(html).toContain("从模板开始");
  });
});

describe("NodeEditorToolbar external update entry", () => {
  function renderToolbar(overrides: { hasExternalUpdate?: boolean; writeConflict?: boolean }) {
    return renderToStaticMarkup(createElement(NodeEditorToolbar, {
      title: "开始",
      file: "nodes/start.json",
      dirty: true,
      diagnosticsCount: 0,
      hasExternalUpdate: overrides.hasExternalUpdate ?? false,
      writeConflict: overrides.writeConflict ?? false,
      saving: false,
      canSave: true,
      status: "",
      draftCopyPath: null,
      onModeToggle: () => {},
      onOpenExternalDiff: () => {},
      onSaveDraftCopy: () => {},
      onSave: () => {},
    }));
  }

  it("routes external updates through the diff view instead of a blind load", () => {
    const html = renderToolbar({ hasExternalUpdate: true });

    expect(html).toContain("外部已更新，查看差异");
    expect(html).not.toContain("载入外部版本");
  });

  it("routes write conflicts through the diff view and keeps the draft-copy escape", () => {
    const html = renderToolbar({ writeConflict: true });

    expect(html).toContain("冲突：查看差异");
    expect(html).toContain("另存为副本");
    expect(html).not.toContain("载入外部版本");
  });
});

describe("NodeEditor inspector pane layout", () => {
  it("clamps inspector width to min and dynamic max bounds", () => {
    expect(clampNodeInspectorPaneWidth(120)).toBe(320);
    expect(clampNodeInspectorPaneWidth(900)).toBe(720);
    expect(clampNodeInspectorPaneWidth(900, 800)).toBe(480);
  });

  it("collapses the right pane without discarding the last usable width", () => {
    expect(resolveNodeInspectorPaneLayout({ collapsed: true, width: 520 }, 1200)).toEqual({
      collapsed: true,
      width: 520,
      paneWidth: 0,
      gridTemplateColumns: "minmax(0, 1fr) 0px",
    });
  });
});
