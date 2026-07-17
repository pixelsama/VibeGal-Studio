import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import {
  formatScenarioInstruction,
  formatScenarioText,
  parseScenarioText,
  type Instruction,
  type ScenarioDiagnostic,
} from "@vibegal/engine";
import { saveFile } from "../../lib/tauri";
import type { FileRevision, GraphIssueFocusRequest, GraphNode, ProjectData } from "../../lib/types";
import type { InsertableKind } from "./instructions";
import {
  instructionIndexFromJsonPath,
} from "./instructionEditing";
import {
  conflictDraftCopyPath,
  instructionsFromNodeData,
  nodeEditorKeepsDraftOnWriteConflict,
  parseJsonInstructionText,
  scenarioTextFromNodeData,
  serializeNodeData,
  type NodeEditorMode,
} from "./nodeEditorModel";
import { NodeEditorToolbar } from "./NodeEditorToolbar";
import { NodePreviewPanel } from "./NodePreviewPanel";
import {
  CommandMenuSource,
  defaultScenarioInstruction,
  insertScenarioCommandAtCursor,
  scenarioCommandOptionsForQuery,
  scenarioCommandTriggerAtCursor,
} from "./scenarioCommands";
import {
  getScenarioSelection,
  replaceScenarioSelectionInstruction,
  ScenarioInspector,
  ScenarioNodeLayout,
} from "./scenarioEditor";
import { ScenarioTextEditor } from "./ScenarioTextEditor";
import {
  createUndoHistory,
  recordUndoCheckpoint,
  redoScenarioText,
  undoScenarioText,
  undoShortcutType,
  type UndoHistory,
} from "./undoHistory";
import { isDraftSnapshotCurrent, preventUnloadWhenDirty } from "./unsavedChanges";
import { useSaveShortcut } from "../common/useSaveShortcut";
import {
  clearProjectDraft,
  getSessionDraftStorage,
  loadProjectDraft,
  projectDraftStorageKey,
  saveProjectDraft,
  type DraftStorage,
} from "../../lib/draftRecovery";

export {
  conflictDraftCopyPath,
  isWriteConflictError,
  nodeEditorKeepsDraftOnWriteConflict,
} from "./nodeEditorModel";
export {
  insertScenarioCommandAtCursor,
  scenarioCommandTriggerAtCursor,
} from "./scenarioCommands";

interface NodeEditorProps {
  project: ProjectData;
  rendererId: string;
  node: GraphNode;
  nodeData: unknown | null;
  focusRequest?: GraphIssueFocusRequest | null;
  onSaved: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

const NODE_INSPECTOR_PANE_STORAGE_KEY = "vibegal.nodeEditor.inspectorPane";
const NODE_INSPECTOR_PANE_DEFAULT_WIDTH = 440;
const NODE_INSPECTOR_PANE_MIN_WIDTH = 320;
const NODE_INSPECTOR_PANE_MAX_WIDTH = 720;
const NODE_INSPECTOR_PANE_MAX_RATIO = 0.6;
const NODE_INSPECTOR_REGION_ID = "node-editor-inspector-pane";

interface NodeInspectorPaneState {
  collapsed: boolean;
  width: number;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface NodeEditorStoredDraft {
  version: 1;
  mode: NodeEditorMode;
  text: string;
  instructions: Instruction[];
  baseJsonText: string;
  baseRevision?: FileRevision | null;
}

export function loadNodeEditorDraft(storage: DraftStorage | null, key: string): NodeEditorStoredDraft | null {
  const value = loadProjectDraft(storage, key);
  if (!value || typeof value !== "object") return null;
  const draft = value as Partial<NodeEditorStoredDraft>;
  if (draft.version !== 1) return null;
  if (draft.mode !== "scenario" && draft.mode !== "json") return null;
  if (typeof draft.text !== "string" || !Array.isArray(draft.instructions) || typeof draft.baseJsonText !== "string") return null;
  return draft as NodeEditorStoredDraft;
}

export function clampNodeInspectorPaneWidth(width: number, containerWidth?: number): number {
  const maxWidth = Number.isFinite(containerWidth) && (containerWidth ?? 0) > 0
    ? Math.max(
      NODE_INSPECTOR_PANE_MIN_WIDTH,
      Math.min(NODE_INSPECTOR_PANE_MAX_WIDTH, Math.floor((containerWidth ?? 0) * NODE_INSPECTOR_PANE_MAX_RATIO)),
    )
    : NODE_INSPECTOR_PANE_MAX_WIDTH;
  const safeWidth = Number.isFinite(width) ? Math.round(width) : NODE_INSPECTOR_PANE_DEFAULT_WIDTH;
  return Math.min(Math.max(safeWidth, NODE_INSPECTOR_PANE_MIN_WIDTH), maxWidth);
}

export function resolveNodeInspectorPaneLayout(state: NodeInspectorPaneState, containerWidth?: number) {
  const width = clampNodeInspectorPaneWidth(state.width, containerWidth);
  return {
    collapsed: state.collapsed,
    width,
    paneWidth: state.collapsed ? 0 : width,
    gridTemplateColumns: `minmax(0, 1fr) ${state.collapsed ? "0px" : `${width}px`}`,
  };
}

function getBrowserStorage(): StorageLike | null {
  return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
}

function loadNodeInspectorPaneState(storage: StorageLike | null = getBrowserStorage()): NodeInspectorPaneState {
  const fallback = { collapsed: false, width: NODE_INSPECTOR_PANE_DEFAULT_WIDTH };
  if (!storage) return fallback;

  try {
    const raw = storage.getItem(NODE_INSPECTOR_PANE_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<NodeInspectorPaneState>;
    return {
      collapsed: parsed.collapsed === true,
      width: clampNodeInspectorPaneWidth(parsed.width ?? fallback.width),
    };
  } catch {
    return fallback;
  }
}

function saveNodeInspectorPaneState(state: NodeInspectorPaneState, storage: StorageLike | null = getBrowserStorage()) {
  if (!storage) return;
  try {
    storage.setItem(NODE_INSPECTOR_PANE_STORAGE_KEY, JSON.stringify({
      collapsed: state.collapsed,
      width: clampNodeInspectorPaneWidth(state.width),
    }));
  } catch {
    // localStorage 不可用时静默降级
  }
}

export function NodeEditor({
  project,
  rendererId,
  node,
  nodeData,
  focusRequest,
  onSaved,
  onDirtyChange,
}: NodeEditorProps) {
  const incomingJsonText = useMemo(() => serializeNodeData(nodeData), [nodeData]);
  const incomingScenarioText = useMemo(() => scenarioTextFromNodeData(nodeData), [nodeData]);
  const incomingInstructions = useMemo(() => instructionsFromNodeData(nodeData), [nodeData]);
  const draftStorage = useMemo(getSessionDraftStorage, []);
  const draftStorageKey = useMemo(
    () => projectDraftStorageKey(project.path, `content/${node.file}`),
    [node.file, project.path],
  );
  const restoredDraft = useMemo(
    () => loadNodeEditorDraft(draftStorage, draftStorageKey),
    [draftStorage, draftStorageKey],
  );
  const restoredDraftState = useMemo(() => {
    if (!restoredDraft) return null;
    if (restoredDraft.mode === "scenario") {
      const parsed = parseScenarioText(restoredDraft.text);
      return {
        instructions: parsed.ok ? parsed.instructions : restoredDraft.instructions,
        diagnostics: parsed.ok ? [] : parsed.diagnostics,
      };
    }
    if (restoredDraft.mode === "json") {
      const parsed = parseJsonInstructionText(restoredDraft.text);
      return {
        instructions: parsed.ok ? parsed.instructions : restoredDraft.instructions,
        diagnostics: parsed.ok ? [] : [{ line: 1, message: parsed.error }],
      };
    }
  }, [restoredDraft]);
  const [mode, setMode] = useState<NodeEditorMode>(restoredDraft?.mode ?? "scenario");
  const [text, setText] = useState(restoredDraft?.text ?? incomingScenarioText);
  const [instructions, setInstructions] = useState<Instruction[]>(restoredDraftState?.instructions ?? incomingInstructions);
  const [lastValidInstructions, setLastValidInstructions] = useState<Instruction[]>(restoredDraftState?.instructions ?? incomingInstructions);
  const [diagnostics, setDiagnostics] = useState<ScenarioDiagnostic[]>(restoredDraftState?.diagnostics ?? []);
  const [cursorOffset, setCursorOffset] = useState(0);
  const [dirty, setDirty] = useState(restoredDraft !== null);
  const [draftBaseVersion, setDraftBaseVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(restoredDraft ? "已恢复本次会话中未保存的草稿。" : "");
  const [pendingExternalText, setPendingExternalText] = useState<string | null>(null);
  const [hasExternalUpdate, setHasExternalUpdate] = useState(false);
  const [writeConflict, setWriteConflict] = useState(false);
  const [draftCopyPath, setDraftCopyPath] = useState<string | null>(null);
  const [commandMenuSource, setCommandMenuSource] = useState<CommandMenuSource | null>(null);
  const [textareaScrollTop, setTextareaScrollTop] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const layoutRootRef = useRef<HTMLDivElement | null>(null);
  const pendingSelectionRef = useRef<number | null>(null);
  const draftVersionRef = useRef(0);
  const undoHistoryRef = useRef<UndoHistory>(createUndoHistory());
  const loadedTextRef = useRef(restoredDraft?.baseJsonText ?? incomingJsonText);
  const loadedRevisionRef = useRef(restoredDraft?.baseRevision ?? project.nodeRevisions?.[node.file] ?? undefined);
  const [inspectorPane, setInspectorPane] = useState<NodeInspectorPaneState>(() => loadNodeInspectorPaneState());
  const [layoutWidth, setLayoutWidth] = useState<number | undefined>(undefined);
  const [draggingInspector, setDraggingInspector] = useState(false);
  const inspectorPaneLayout = useMemo(
    () => resolveNodeInspectorPaneLayout(inspectorPane, layoutWidth),
    [inspectorPane, layoutWidth],
  );

  const nodeIssues = useMemo(() => {
    const file = `content/${node.file}`;
    return (project.projectReport?.projectIssues ?? [])
      .filter((issue) => issue.source === "node" && (issue.nodeId === node.id || issue.file === file))
      .map((issue) => ({ ...issue, instructionIndex: instructionIndexFromJsonPath(issue.jsonPath) }));
  }, [node.file, node.id, project.projectReport]);

  useEffect(() => {
    const incomingRevision = project.nodeRevisions?.[node.file] ?? undefined;
    if (dirty) {
      if (incomingJsonText !== loadedTextRef.current) {
        setPendingExternalText(incomingJsonText);
        setHasExternalUpdate(true);
      }
      return;
    }
    loadedTextRef.current = incomingJsonText;
    loadedRevisionRef.current = incomingRevision;
    undoHistoryRef.current = createUndoHistory();
    setText(mode === "json" ? incomingJsonText : incomingScenarioText);
    setInstructions(incomingInstructions);
    setLastValidInstructions(incomingInstructions);
    setDiagnostics([]);
    setPendingExternalText(null);
    setHasExternalUpdate(false);
    setWriteConflict(false);
    setDraftCopyPath(null);
    setStatus("");
  }, [dirty, incomingInstructions, incomingJsonText, incomingScenarioText, mode, node.file, project.nodeRevisions]);

  useEffect(() => {
    saveNodeInspectorPaneState(inspectorPane);
  }, [inspectorPane]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (dirty) {
      saveProjectDraft(draftStorage, draftStorageKey, {
        version: 1,
        mode,
        text,
        instructions,
        baseJsonText: loadedTextRef.current,
        baseRevision: loadedRevisionRef.current,
      } satisfies NodeEditorStoredDraft);
    } else {
      clearProjectDraft(draftStorage, draftStorageKey);
    }
  }, [dirty, draftBaseVersion, draftStorage, draftStorageKey, instructions, mode, text]);

  useEffect(() => () => {
    onDirtyChange?.(false);
  }, [onDirtyChange]);

  useEffect(() => {
    if (!dirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      preventUnloadWhenDirty(event, true);
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    const root = layoutRootRef.current;
    if (!root) return;

    const updateWidth = () => {
      const nextWidth = root.getBoundingClientRect().width;
      setLayoutWidth(nextWidth > 0 ? nextWidth : undefined);
    };

    updateWidth();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => updateWidth());
      observer.observe(root);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  const scenarioSelection = useMemo(() => getScenarioSelection(text, cursorOffset), [cursorOffset, text]);
  const scenarioCommandTrigger = useMemo(
    () => (mode === "scenario" ? scenarioCommandTriggerAtCursor(text, cursorOffset) : null),
    [cursorOffset, mode, text],
  );
  const commandQuery = commandMenuSource === "trigger" ? scenarioCommandTrigger?.query ?? "" : "";
  const visibleCommands = useMemo(() => scenarioCommandOptionsForQuery(commandQuery), [commandQuery]);
  const commandMenuVisible = mode === "scenario"
    && (commandMenuSource === "line-plus" || (commandMenuSource === "trigger" && scenarioCommandTrigger != null));
  const lineActionTop = Math.max(8, 16 + (scenarioSelection.line - 1) * 23.8 - textareaScrollTop);
  const canSave = useMemo(() => {
    if (mode === "scenario") return diagnostics.length === 0;
    return parseJsonInstructionText(text).ok;
  }, [diagnostics.length, mode, text]);

  useEffect(() => {
    if (commandMenuSource === "trigger" && !scenarioCommandTrigger) setCommandMenuSource(null);
  }, [commandMenuSource, scenarioCommandTrigger]);

  useEffect(() => {
    const offset = pendingSelectionRef.current;
    const textarea = textareaRef.current;
    if (offset == null || !textarea) return;
    textarea.focus();
    textarea.setSelectionRange(offset, offset);
    pendingSelectionRef.current = null;
  }, [text]);

  useEffect(() => {
    if (!focusRequest?.jsonPath) return;
    const index = instructionIndexFromJsonPath(focusRequest.jsonPath);
    if (index == null) return;
    setStatus(`节点问题位置：第 ${index + 1} 条指令（${focusRequest.jsonPath}）`);
  }, [focusRequest]);

  const applyScenarioText = (nextText: string, options: { programmatic?: boolean; skipHistory?: boolean } = {}) => {
    if (!options.skipHistory) {
      undoHistoryRef.current = recordUndoCheckpoint(undoHistoryRef.current, text, {
        programmatic: options.programmatic,
      });
    }
    draftVersionRef.current += 1;
    setText(nextText);
    setDirty(true);
    setStatus("");
    const parsed = parseScenarioText(nextText);
    if (parsed.ok) {
      setInstructions(parsed.instructions);
      setLastValidInstructions(parsed.instructions);
      setDiagnostics([]);
    } else {
      setDiagnostics(parsed.diagnostics);
    }
  };

  const applyJsonText = (nextText: string) => {
    draftVersionRef.current += 1;
    setText(nextText);
    setDirty(true);
    setStatus("");
    const parsed = parseJsonInstructionText(nextText);
    if (parsed.ok) {
      setInstructions(parsed.instructions);
      setLastValidInstructions(parsed.instructions);
      setDiagnostics([]);
    } else {
      setDiagnostics([{ line: 1, message: parsed.error }]);
    }
  };

  const buildPayload = (): { ok: true; payload: string; nextInstructions: Instruction[] } | { ok: false; message: string } => {
    if (mode === "scenario") {
      const parsed = parseScenarioText(text);
      if (!parsed.ok) return { ok: false, message: `剧本文本有 ${parsed.diagnostics.length} 个问题，修正后才能保存。` };
      return { ok: true, payload: JSON.stringify(parsed.instructions, null, 2), nextInstructions: parsed.instructions };
    }
    const parsed = parseJsonInstructionText(text);
    if (!parsed.ok) return { ok: false, message: `JSON 无法保存：${parsed.error}` };
    return { ok: true, payload: JSON.stringify(parsed.instructions, null, 2), nextInstructions: parsed.instructions };
  };

  const handleSave = async () => {
    const built = buildPayload();
    if (!built.ok) {
      setStatus(built.message);
      return;
    }
    const savedDraftVersion = draftVersionRef.current;
    setSaving(true);
    setStatus("");
    try {
      if (dirty) {
        const nextRevision = await saveFile(project.path, `content/${node.file}`, built.payload, loadedRevisionRef.current);
        loadedTextRef.current = built.payload;
        loadedRevisionRef.current = nextRevision ?? undefined;
        setDraftBaseVersion((version) => version + 1);
        if (isDraftSnapshotCurrent(savedDraftVersion, draftVersionRef.current)) {
          setInstructions(built.nextInstructions);
          setLastValidInstructions(built.nextInstructions);
          setDiagnostics([]);
          setText(mode === "json" ? built.payload : formatScenarioText(built.nextInstructions));
          setDirty(false);
          setStatus("已保存 ✓");
        } else {
          setStatus("已保存；保存期间的新改动仍未保存。");
        }
        setPendingExternalText(null);
        setHasExternalUpdate(false);
        setWriteConflict(false);
        setDraftCopyPath(null);
      }
      if (!dirty) setStatus("已保存 ✓");
      onSaved();
    } catch (error) {
      const preserved = nodeEditorKeepsDraftOnWriteConflict({ text, instructions }, error);
      if (preserved.conflict && preserved.draft) {
        if (isDraftSnapshotCurrent(savedDraftVersion, draftVersionRef.current)) {
          setText(preserved.draft.text);
          setInstructions(preserved.draft.instructions);
        }
        setWriteConflict(true);
        setStatus("保存失败: 文件已被外部修改，当前草稿已保留。");
      } else {
        setStatus(`保存失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      setSaving(false);
    }
  };

  useSaveShortcut(!saving, () => void handleSave());

  const handleLoadExternal = () => {
    if (saving) return;
    if (writeConflict && pendingExternalText == null && incomingJsonText === loadedTextRef.current) {
      setStatus("正在载入外部版本…");
      void onSaved();
      return;
    }
    const nextJsonText = pendingExternalText ?? incomingJsonText;
    draftVersionRef.current += 1;
    undoHistoryRef.current = createUndoHistory();
    const parsed = parseJsonInstructionText(nextJsonText);
    const nextInstructions = parsed.ok ? parsed.instructions : [];
    loadedTextRef.current = nextJsonText;
    loadedRevisionRef.current = project.nodeRevisions?.[node.file] ?? undefined;
    setText(mode === "json" ? nextJsonText : formatScenarioText(nextInstructions));
    setInstructions(nextInstructions);
    setLastValidInstructions(nextInstructions);
    setDiagnostics(parsed.ok ? [] : [{ line: 1, message: parsed.error }]);
    setDirty(false);
    setPendingExternalText(null);
    setHasExternalUpdate(false);
    setWriteConflict(false);
    setDraftCopyPath(null);
    setStatus("已载入外部更新。");
  };

  const handleSaveDraftCopy = async () => {
    const built = buildPayload();
    if (!built.ok) {
      setStatus(built.message);
      return;
    }
    setSaving(true);
    setStatus("");
    try {
      const copyPath = conflictDraftCopyPath(node.file, Date.now());
      await saveFile(project.path, `content/${copyPath}`, built.payload);
      setDraftCopyPath(copyPath);
      setStatus(`草稿副本已保存: ${copyPath}`);
      onSaved();
    } catch (error) {
      setStatus(`另存为副本失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSaving(false);
    }
  };

  const syncCursorFromTextarea = (textarea: HTMLTextAreaElement) => {
    const nextOffset = textarea.selectionStart;
    setCursorOffset(nextOffset);
    setTextareaScrollTop(textarea.scrollTop);
    if (mode !== "scenario") {
      setCommandMenuSource(null);
      return;
    }
    if (scenarioCommandTriggerAtCursor(textarea.value, nextOffset)) {
      setCommandMenuSource("trigger");
    } else if (commandMenuSource === "trigger") {
      setCommandMenuSource(null);
    }
  };

  const handleScenarioTextChange = (textarea: HTMLTextAreaElement) => {
    const nextText = textarea.value;
    const nextOffset = textarea.selectionStart;
    applyScenarioText(nextText);
    setCursorOffset(nextOffset);
    setTextareaScrollTop(textarea.scrollTop);
    setCommandMenuSource(scenarioCommandTriggerAtCursor(nextText, nextOffset) ? "trigger" : null);
  };

  const handleJsonTextChange = (textarea: HTMLTextAreaElement) => {
    setCommandMenuSource(null);
    setCursorOffset(textarea.selectionStart);
    setTextareaScrollTop(textarea.scrollTop);
    applyJsonText(textarea.value);
  };

  const handleInsertCommand = (kind: InsertableKind) => {
    if (mode !== "scenario") return;
    const commandText = formatScenarioInstruction(defaultScenarioInstruction(kind, project));
    const inserted = insertScenarioCommandAtCursor(text, cursorOffset, commandText);
    pendingSelectionRef.current = inserted.cursorOffset;
    setCursorOffset(inserted.cursorOffset);
    setCommandMenuSource(null);
    applyScenarioText(inserted.text, { programmatic: true });
  };

  const handleInsertTemplate = (templateText: string) => {
    if (mode !== "scenario") return;
    pendingSelectionRef.current = templateText.length;
    setCursorOffset(templateText.length);
    applyScenarioText(templateText, { programmatic: true });
  };

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mode === "scenario") {
      const shortcut = undoShortcutType(event);
      if (shortcut) {
        const result = shortcut === "undo"
          ? undoScenarioText(undoHistoryRef.current, text)
          : redoScenarioText(undoHistoryRef.current, text);
        if (!result) return; // 栈空时交给 textarea 原生撤销
        event.preventDefault();
        undoHistoryRef.current = result.history;
        pendingSelectionRef.current = result.text.length;
        setCursorOffset(result.text.length);
        applyScenarioText(result.text, { skipHistory: true });
        return;
      }
    }
    if (event.key === "Escape" && commandMenuSource) {
      event.preventDefault();
      setCommandMenuSource(null);
      return;
    }
    if ((event.key === "Enter" || event.key === "Tab") && commandMenuVisible && visibleCommands[0]) {
      event.preventDefault();
      handleInsertCommand(visibleCommands[0].kind);
    }
  };

  const handleModeToggle = (nextMode: NodeEditorMode) => {
    if (nextMode === mode) return;
    if (nextMode === "json") {
      const built = buildPayload();
      if (!built.ok) {
        setStatus(built.message);
        return;
      }
      draftVersionRef.current += 1;
      undoHistoryRef.current = createUndoHistory();
      setMode("json");
      setText(built.payload);
      setInstructions(built.nextInstructions);
      setLastValidInstructions(built.nextInstructions);
      setDiagnostics([]);
      setStatus("");
      return;
    }
    const parsed = parseJsonInstructionText(text);
    const nextInstructions = mode === "json" && parsed.ok ? parsed.instructions : lastValidInstructions;
    if (mode === "json" && !parsed.ok) {
      setStatus(`切换失败：${parsed.error}`);
      return;
    }
    draftVersionRef.current += 1;
    undoHistoryRef.current = createUndoHistory();
    setMode("scenario");
    setText(formatScenarioText(nextInstructions));
    setInstructions(nextInstructions);
    setLastValidInstructions(nextInstructions);
    setDiagnostics([]);
    setStatus("");
  };

  const handleToggleInspectorPane = useCallback(() => {
    setInspectorPane((current) => ({ ...current, collapsed: !current.collapsed }));
  }, []);

  const handleInspectorResizeStart = useCallback((event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const root = layoutRootRef.current;
    if (!root) return;

    const startX = event.clientX;
    const startWidth = inspectorPaneLayout.width;
    setDraggingInspector(true);

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      const containerWidth = root.getBoundingClientRect().width;
      const nextWidth = clampNodeInspectorPaneWidth(startWidth + (startX - moveEvent.clientX), containerWidth);
      setInspectorPane((current) => ({ ...current, width: nextWidth, collapsed: false }));
    };

    const handlePointerEnd = () => {
      setDraggingInspector(false);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);
  }, [inspectorPaneLayout.width]);

  const editor = (
    <div style={editorPaneStyle}>
      <NodeEditorToolbar
        title={node.title}
        file={node.file}
        dirty={dirty}
        diagnosticsCount={diagnostics.length}
        hasExternalUpdate={hasExternalUpdate}
        writeConflict={writeConflict}
        saving={saving}
        canSave={canSave}
        status={status}
        draftCopyPath={draftCopyPath}
        onModeToggle={handleModeToggle}
        onLoadExternal={handleLoadExternal}
        onSaveDraftCopy={handleSaveDraftCopy}
        onSave={handleSave}
      />
      <ScenarioTextEditor
        mode={mode}
        text={text}
        textareaRef={textareaRef}
        lineActionTop={lineActionTop}
        commandMenuVisible={commandMenuVisible}
        visibleCommands={visibleCommands}
        onToggleLineCommandMenu={() => {
          setCommandMenuSource(commandMenuSource === "line-plus" ? null : "line-plus");
          textareaRef.current?.focus();
        }}
        onInsertCommand={handleInsertCommand}
        onInsertTemplate={handleInsertTemplate}
        onScenarioTextChange={handleScenarioTextChange}
        onJsonTextChange={handleJsonTextChange}
        onSyncCursor={syncCursorFromTextarea}
        onKeyDown={handleTextareaKeyDown}
        onScroll={setTextareaScrollTop}
      />
    </div>
  );

  const preview = (
    <NodePreviewPanel
      key={`${rendererId}:${node.id}`}
      project={project}
      rendererId={rendererId}
      node={node}
      nodeData={lastValidInstructions}
    />
  );

  const inspector = mode === "scenario" ? (
    <ScenarioInspector
      selection={scenarioSelection}
      manifest={project.content.manifest}
      diagnostics={diagnostics}
      onReplaceInstruction={(instruction) => applyScenarioText(
        replaceScenarioSelectionInstruction(text, scenarioSelection, instruction),
        { programmatic: true },
      )}
    />
  ) : (
    <div style={jsonInspectorStyle}>
      <div style={titleStyle}>JSON 高级模式</div>
      <div style={helperTextStyle}>返回剧本模式后可使用 Inspector 编辑当前行。</div>
      {nodeIssues.length > 0 && (
        <div style={issueListStyle}>
          {nodeIssues.map((issue) => (
            <div key={`${issue.code}-${issue.jsonPath ?? issue.message}`} style={issueItemStyle}>
              {issue.code}: {issue.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <ScenarioNodeLayout
      rootRef={layoutRootRef}
      editor={editor}
      preview={preview}
      inspector={inspector}
      inspectorPaneId={NODE_INSPECTOR_REGION_ID}
      inspectorCollapsed={inspectorPaneLayout.collapsed}
      inspectorPaneWidth={inspectorPaneLayout.width}
      draggingInspector={draggingInspector}
      resizeHandle={!inspectorPaneLayout.collapsed && (
        <div
          role="separator"
          aria-label="调整 Inspector 宽度"
          aria-orientation="vertical"
          className="gs-resize-handle"
          onPointerDown={handleInspectorResizeStart}
          style={{
            ...inspectorResizeHandleStyle,
            right: inspectorPaneLayout.paneWidth - 3,
            cursor: draggingInspector ? "col-resize" : "ew-resize",
          }}
        />
      )}
      controls={(
        <button
          type="button"
          aria-label="切换 Inspector 面板"
          aria-controls={NODE_INSPECTOR_REGION_ID}
          aria-expanded={!inspectorPaneLayout.collapsed}
          className="gs-btn gs-btn--secondary"
          onClick={handleToggleInspectorPane}
          style={{
            ...inspectorTogglePositionStyle,
            right: inspectorPaneLayout.collapsed ? 12 : Math.max(12, inspectorPaneLayout.paneWidth - 120),
          }}
        >
          {inspectorPaneLayout.collapsed ? "显示 Inspector" : "收起 Inspector"}
        </button>
      )}
    />
  );
}

const editorPaneStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  borderRight: "1px solid var(--border)",
};

const jsonInspectorStyle: CSSProperties = {
  display: "grid",
  gap: "var(--space-3)",
  padding: "var(--space-4)",
};

const titleStyle: CSSProperties = {
  fontSize: "var(--text-md)",
  fontWeight: 600,
  color: "var(--text-bright)",
};

const helperTextStyle: CSSProperties = {
  fontSize: "var(--text-sm)",
  color: "var(--text-dim)",
  padding: "var(--space-1) 0",
};

const issueListStyle: CSSProperties = {
  display: "grid",
  gap: "var(--space-1)",
  padding: "var(--space-2) var(--space-2)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--status-error)",
  background: "var(--bg-tag-error)",
};

const issueItemStyle: CSSProperties = {
  color: "var(--status-error-text)",
  fontSize: "var(--text-sm)",
  lineHeight: 1.5,
};

/* 颜色/悬停/焦点统一走 .gs-btn--secondary；这里只留定位与外观差异的覆盖。 */
const inspectorTogglePositionStyle: CSSProperties = {
  position: "absolute",
  top: 10,
  zIndex: 5,
  padding: "var(--space-2) var(--space-2)",
  background: "color-mix(in srgb, var(--bg-panel) 92%, transparent)",
  fontSize: "var(--text-sm)",
  whiteSpace: "nowrap",
};

/* 底色与悬停反馈走 .gs-resize-handle；内联只保留定位（避免盖住 :hover）。 */
const inspectorResizeHandleStyle: CSSProperties = {
  position: "absolute",
  top: 0,
  bottom: 0,
  zIndex: 4,
  width: 6,
};
