import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Instruction } from "@vibegal/engine";
import { describe, expect, it, vi } from "vitest";
import {
  clampNodeInspectorPaneWidth,
  createConflictClipboardText,
  externalSnapshotRequestIsCurrent,
  insertScenarioCommandAtCursor,
  isWriteConflictError,
  JSON_IDENTITY_GUIDANCE,
  keptLocalDraftBase,
  loadNodeInspectorPaneState,
  loadNodeEditorDraft,
  nodeEditorInitialText,
  nodeExternalChange,
  NodeEditor,
  nodeEditorKeepsDraftOnWriteConflict,
  resolveNodeInspectorPaneLayout,
  scenarioCommandTriggerAtCursor,
} from "./NodeEditor";
import { isSaveKeyboardShortcut } from "./unsavedChanges";
import { NodeEditorToolbar } from "./NodeEditorToolbar";
import { statusError, statusOk, statusWarn, type StatusMessage } from "./statusMessage";
import type { ProjectData } from "../../lib/types";
import { StudioI18nProvider } from "../../lib/i18n";

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

  it("copies base, local, and exact external text without merging", () => {
    const copied = createConflictClipboardText({
      relPath: "nodes/start.json",
      baseText: '[{"text":"base"}]',
      localText: '[{"text":"local"}]',
      externalSnapshot: {
        relPath: "nodes/start.json",
        state: "present",
        text: '[ { "text": "external" } ]\n',
        revision: {
          relPath: "content/nodes/start.json",
          mtimeMs: 2,
          size: 28,
          sha256: "a".repeat(64),
        },
      },
    });

    expect(copied).toContain("===== BASE =====\n[{\"text\":\"base\"}]");
    expect(copied).toContain("===== LOCAL DRAFT =====\n[{\"text\":\"local\"}]");
    expect(copied).toContain("===== EXTERNAL =====\n[ { \"text\": \"external\" } ]\n");
  });

  it("copies a readable draft even when the renamed external file cannot be fetched", () => {
    const copied = createConflictClipboardText({
      relPath: "nodes/start.json",
      baseText: '[{"text":"base"}]',
      localText: '[{"text":"local"}]',
      externalState: "renamed",
      relatedPaths: ["content/nodes/renamed.json"],
    });

    expect(copied).toContain("External state: renamed");
    expect(copied).toContain("Related path(s): content/nodes/renamed.json");
    expect(copied).toContain('===== LOCAL DRAFT =====\n[{"text":"local"}]');
    expect(copied).toContain("===== EXTERNAL =====\n(unavailable)");
  });

  it("preserves watcher rename, delete, and burst metadata for the edited path", () => {
    const base = {
      projectPath: "/project",
      rendererChanged: false,
      eventCount: 3,
    };

    expect(nodeExternalChange({
      ...base,
      changes: [{
        kind: "rename",
        paths: ["content/nodes/start.json", "content/nodes/renamed.json"],
      }],
    }, "nodes/start.json")).toEqual({
      kind: "renamed",
      eventCount: 3,
      relatedPaths: ["content/nodes/renamed.json"],
    });
    expect(nodeExternalChange({
      ...base,
      changes: [{ kind: "remove", paths: ["content/nodes/start.json"] }],
    }, "nodes/start.json")).toEqual({ kind: "deleted", eventCount: 3 });
    expect(nodeExternalChange({
      ...base,
      changes: [{ kind: "modify", paths: ["content/nodes/other.json"] }],
    }, "nodes/start.json")).toBeNull();
  });

  it("keeps a clean local draft writable after an external delete", () => {
    expect(keptLocalDraftBase({
      relPath: "nodes/start.json",
      state: "deleted",
    })).toEqual({
      text: "",
      revision: null,
      dirty: true,
    });
  });

  it("rejects a completed snapshot request after the editor path changes", () => {
    expect(externalSnapshotRequestIsCurrent({
      requestId: 3,
      currentRequestId: 3,
      requestedRelPath: "nodes/start.json",
      currentRelPath: "nodes/renamed.json",
    })).toBe(false);
    expect(externalSnapshotRequestIsCurrent({
      requestId: 3,
      currentRequestId: 4,
      requestedRelPath: "nodes/start.json",
      currentRelPath: "nodes/start.json",
    })).toBe(false);
    expect(externalSnapshotRequestIsCurrent({
      requestId: 3,
      currentRequestId: 3,
      requestedRelPath: "nodes/start.json",
      currentRelPath: "nodes/start.json",
    })).toBe(true);
  });

  it("restores pending backend-assigned identity provenance from the session draft", () => {
    const storage = {
      getItem: () => JSON.stringify({
        version: 1,
        mode: "json",
        text: '[{"t":"narrate","text":"edited"}]',
        instructions: [{ t: "narrate", id: "sp_backend", text: "edited" }],
        baseJsonText: '[{"t":"narrate","id":"sp_backend","text":"saved"}]',
        pendingAssignedIdentitySources: [{
          savedInstructions: [{ t: "narrate", id: "sp_backend", text: "saved" }],
          assigned: [{ id: "sp_backend" }],
        }],
      }),
      setItem: () => {},
      removeItem: () => {},
    };

    expect(loadNodeEditorDraft(storage, "draft")?.pendingAssignedIdentitySources).toEqual([{
      savedInstructions: [{ t: "narrate", id: "sp_backend", text: "saved" }],
      assigned: [{ id: "sp_backend" }],
    }]);
  });

  it("hydrates restored JSON text with identities merged into the draft instructions", () => {
    const draft = {
      version: 1 as const,
      mode: "json" as const,
      text: '[{"t":"narrate","text":"edited"}]',
      instructions: [{ t: "narrate", id: "sp_backend", text: "edited" }] as Instruction[],
      baseJsonText: "[]",
    };

    expect(nodeEditorInitialText(draft, draft.instructions, "scenario")).toContain('"id": "sp_backend"');
  });

  it("preserves invalid restored JSON text instead of replacing the user's draft", () => {
    const draft = {
      version: 1 as const,
      mode: "json" as const,
      text: '[{"t":"narrate",',
      instructions: [{ t: "narrate", id: "sp_backend", text: "last valid" }] as Instruction[],
      baseJsonText: "[]",
    };

    expect(nodeEditorInitialText(draft, draft.instructions, "scenario")).toBe(draft.text);
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
    expect(html).toContain("aria-label=\"切换属性面板\"");
    expect(html).toContain("aria-label=\"调整属性面板宽度\"");
    expect(html).not.toContain("节点出口");
    expect(html).not.toContain("连接下一个节点");
    expect(html).not.toContain("添加玩家选择");
  });

  it("renders editor chrome in English while preserving the creator-authored node", () => {
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
    const html = renderToStaticMarkup(
      createElement(
        StudioI18nProvider,
        { preference: "en" },
        createElement(NodeEditor, {
          project,
          rendererId: "default",
          node,
          nodeData: [{ t: "narrate", text: "新的故事从这里开始。" }],
          onSaved: () => {},
        }),
      ),
    );

    expect(html).toContain('aria-label="Script text"');
    expect(html).toContain('aria-label="Toggle properties panel"');
    expect(html).toContain('aria-label="Resize properties panel"');
    expect(html).toContain("Node summary");
    expect(html).toContain("开始");
    expect(html).toContain("新的故事从这里开始。");
    expect(html).not.toContain("切换属性面板");
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

describe("NodeEditor JSON identity guidance", () => {
  it("warns that editing existing story-point IDs can invalidate persistent state", () => {
    expect(JSON_IDENTITY_GUIDANCE).toContain("修改已有 ID 可能使旧记录失效");
    expect(JSON_IDENTITY_GUIDANCE).toContain("删除后保存会生成新 ID");
  });
});

describe("NodeEditorToolbar external update entry", () => {
  function renderToolbar(overrides: { hasExternalUpdate?: boolean; writeConflict?: boolean; status?: StatusMessage | null }) {
    return renderToStaticMarkup(createElement(NodeEditorToolbar, {
      title: "开始",
      file: "nodes/start.json",
      dirty: true,
      diagnosticsCount: 0,
      hasExternalUpdate: overrides.hasExternalUpdate ?? false,
      writeConflict: overrides.writeConflict ?? false,
      saving: false,
      canSave: true,
      status: overrides.status ?? null,
      onModeToggle: () => {},
      onOpenExternalDiff: () => {},
      onCopyConflict: () => {},
      onSave: () => {},
    }));
  }

  it("routes external updates through the diff view instead of a blind load", () => {
    const html = renderToolbar({ hasExternalUpdate: true });

    expect(html).toContain("外部已更新，查看差异");
    expect(html).not.toContain("载入外部版本");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>保存<\/button>/);
  });

  it("routes write conflicts through the diff view and keeps the draft-copy escape", () => {
    const html = renderToolbar({ writeConflict: true });

    expect(html).toContain("冲突：查看差异");
    expect(html).toContain("复制差异");
    expect(html).not.toContain("载入磁盘版本");
  });

  it("colors the status by explicit severity instead of regex-guessing the text", () => {
    // 警告类文案（含"请先…"、不含"失败"）以前被正则误判为成功绿色。
    const warnHtml = renderToolbar({ status: statusWarn("请先将节点移动到其他章节") });
    expect(warnHtml).toContain("var(--status-warn-text)");
    expect(warnHtml).not.toContain("var(--status-ok-text)");

    const errorHtml = renderToolbar({ status: statusError("保存失败") });
    expect(errorHtml).toContain("var(--status-error-text)");

    const okHtml = renderToolbar({ status: statusOk("已保存") });
    expect(okHtml).toContain("var(--status-ok-text)");
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

  it("always starts expanded and only restores the stored width", () => {
    const storage = {
      getItem: () => JSON.stringify({ collapsed: true, width: 520 }),
      setItem: () => {},
    };

    const state = loadNodeInspectorPaneState(storage);

    expect(state.collapsed).toBe(false);
    expect(state.width).toBe(520);
  });
});
