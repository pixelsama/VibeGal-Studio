import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import {
  formatScenarioInstruction,
  formatScenarioText,
  parseScenarioText,
  type Instruction,
  type ScenarioDiagnostic,
} from "@vibegal/engine";
import { readNodeFileSnapshot, saveNode } from "../../lib/tauri";
import type {
  FileRevision,
  GraphIssueFocusRequest,
  GraphNode,
  NodeFileSnapshot,
  ProjectChangedPayload,
  ProjectData,
} from "../../lib/types";
import type { InsertableKind } from "./instructions";
import {
  instructionIndexFromJsonPath,
  updateInstruction,
} from "./instructionEditing";
import {
  type AssignedInstructionIdentity,
  mergeAssignedInstructionIdentities,
  reconcileScenarioInstructionIdentities,
} from "./instructionIdentity";
import {
  instructionsFromNodeData,
  nodeEditorKeepsDraftOnWriteConflict,
  parseJsonInstructionText,
  sameFileRevision,
  scenarioTextFromNodeData,
  serializeNodeData,
  type NodeEditorMode,
} from "./nodeEditorModel";
import { NodeEditorToolbar } from "./NodeEditorToolbar";
import { ConfirmDialog } from "../common/Dialogs";
import { Toast, type ToastInput, type ToastMessage } from "../common/Toast";
import { ExternalDiffPanel } from "./ExternalDiffPanel";
import { diffLines, externalDiffTexts, summarizeDiff } from "./externalDiff";
import { NodePreviewPanel } from "./NodePreviewPanel";
import {
  CommandMenuSource,
  defaultScenarioInstruction,
  insertScenarioCommandAtCursor,
  insertScenarioParameterAtCursor,
  scenarioCommandOptionsForQuery,
  scenarioCommandTriggerAtCursor,
  scenarioParameterOptions,
  scenarioParameterTriggerAtCursor,
  type ScenarioParameterTrigger,
} from "./scenarioCommands";
import {
  getScenarioSelection,
  INSPECTOR_RAIL_WIDTH,
  ScenarioInlineControls,
  ScenarioInspector,
  ScenarioNodeLayout,
} from "./scenarioEditor";
import { ScenarioTextEditor, SCENARIO_LINE_HEIGHT, SCENARIO_TEXT_PADDING_TOP } from "./ScenarioTextEditor";
import { mapScenarioFrames } from "./scenarioFrames";
import { planScenarioInstructionMove } from "./scenarioReordering";
import { followedPreviewStart } from "./nodePreviewStart";
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
import { useStudioI18n } from "../../lib/i18n";
import { clampCompletionIndex, moveCompletionIndex } from "./completionNavigation";

export {
  isWriteConflictError,
  nodeEditorKeepsDraftOnWriteConflict,
} from "./nodeEditorModel";
export {
  insertScenarioCommandAtCursor,
  scenarioCommandTriggerAtCursor,
} from "./scenarioCommands";

interface NodeExternalChange {
  kind: "modified" | "deleted" | "renamed";
  eventCount: number;
  relatedPaths?: string[];
}

interface NodeEditorProps {
  project: ProjectData;
  rendererId: string;
  node: GraphNode;
  nodeData: unknown | null;
  /** 后端同一读取快照返回的精确 UTF-8 文本。 */
  nodeText?: string;
  /** 按需读取节点正文时一并返回的精确版本；优先于项目聚合数据。 */
  nodeRevision?: FileRevision;
  externalChange?: NodeExternalChange | null;
  focusRequest?: GraphIssueFocusRequest | null;
  onSaved: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onExternalChangeResolved?: () => void;
}

export interface PendingAssignedIdentitySource {
  savedInstructions: Instruction[];
  assigned: AssignedInstructionIdentity[];
}

interface ScenarioUndoSnapshot {
  text: string;
  instructions: Instruction[];
}

const NODE_INSPECTOR_PANE_STORAGE_KEY = "vibegal.nodeEditor.inspectorPane";
const NODE_INSPECTOR_PANE_DEFAULT_WIDTH = 440;
const NODE_INSPECTOR_PANE_MIN_WIDTH = 320;
const NODE_INSPECTOR_PANE_MAX_WIDTH = 720;
const NODE_INSPECTOR_PANE_MAX_RATIO = 0.6;
const NODE_INSPECTOR_REGION_ID = "node-editor-inspector-pane";
export const JSON_IDENTITY_GUIDANCE = "story point 的 id 用于存档、已读和回滚定位。删除后保存会生成新 ID；修改已有 ID 可能使旧记录失效，重复 ID 会由项目校验报错。";

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
  pendingAssignedIdentitySources?: PendingAssignedIdentitySource[];
}

export function revisionSummary(revision: FileRevision | null | undefined): string {
  if (!revision) return "missing";
  return revision.sha256?.slice(0, 12)
    ?? `${Math.round(revision.mtimeMs)}:${revision.size}`;
}

export function nodeExternalChange(
  payload: ProjectChangedPayload | null | undefined,
  nodeFile: string,
): NodeExternalChange | null {
  if (!payload) return null;
  const projectPath = `content/${nodeFile}`.replace(/\\/g, "/");
  const matchingChanges = payload.changes.filter((change) => change.paths.includes(projectPath));
  if (matchingChanges.length === 0) return null;

  const rename = matchingChanges.find((change) => change.kind === "rename");
  if (rename) {
    return {
      kind: "renamed",
      eventCount: payload.eventCount,
      relatedPaths: rename.paths.filter((path) => path !== projectPath),
    };
  }
  if (matchingChanges.some((change) => change.kind === "remove")) {
    return { kind: "deleted", eventCount: payload.eventCount };
  }
  return { kind: "modified", eventCount: payload.eventCount };
}

export function externalSnapshotRequestIsCurrent({
  requestId,
  currentRequestId,
  requestedRelPath,
  currentRelPath,
}: {
  requestId: number;
  currentRequestId: number;
  requestedRelPath: string;
  currentRelPath: string;
}): boolean {
  return requestId === currentRequestId
    && requestedRelPath === currentRelPath;
}

export function keptLocalDraftBase(snapshot: NodeFileSnapshot): {
  text: string;
  revision: FileRevision | null;
  dirty: true;
} {
  return {
    text: snapshot.text ?? "",
    revision: snapshot.revision ?? null,
    dirty: true,
  };
}

export function createConflictClipboardText({
  relPath,
  baseText,
  localText,
  externalSnapshot,
  externalState,
  relatedPaths,
}: {
  relPath: string;
  baseText: string;
  localText: string;
  externalSnapshot?: NodeFileSnapshot | null;
  externalState?: NodeExternalChange["kind"];
  relatedPaths?: string[];
}): string {
  const externalRevision = externalSnapshot?.revision?.sha256
    ?? (externalSnapshot?.revision
      ? `${externalSnapshot.revision.mtimeMs}:${externalSnapshot.revision.size}`
      : "unavailable");
  const state = externalState
    ?? externalSnapshot?.state
    ?? "modified";
  return [
    `Path: ${relPath}`,
    `External state: ${state}`,
    ...(relatedPaths?.length ? [`Related path(s): ${relatedPaths.join(", ")}`] : []),
    `External revision: ${externalRevision}`,
    "",
    "===== BASE =====",
    baseText,
    "",
    "===== LOCAL DRAFT =====",
    localText,
    "",
    "===== EXTERNAL =====",
    externalSnapshot?.text
      ?? (state === "deleted" ? "(deleted)" : "(unavailable)"),
  ].join("\n");
}

export function loadNodeEditorDraft(storage: DraftStorage | null, key: string): NodeEditorStoredDraft | null {
  const value = loadProjectDraft(storage, key);
  if (!value || typeof value !== "object") return null;
  const draft = value as Partial<NodeEditorStoredDraft>;
  if (draft.version !== 1) return null;
  if (draft.mode !== "scenario" && draft.mode !== "json") return null;
  if (typeof draft.text !== "string" || !Array.isArray(draft.instructions) || typeof draft.baseJsonText !== "string") return null;
  const pendingAssignedIdentitySources = Array.isArray(draft.pendingAssignedIdentitySources)
    ? draft.pendingAssignedIdentitySources
    : [];
  return { ...draft, pendingAssignedIdentitySources } as NodeEditorStoredDraft;
}

export function nodeEditorInitialText(
  draft: NodeEditorStoredDraft | null,
  restoredInstructions: Instruction[] | null,
  incomingScenarioText: string,
): string {
  if (!draft) return incomingScenarioText;
  if (draft.mode === "json" && restoredInstructions && parseJsonInstructionText(draft.text).ok) {
    return JSON.stringify(restoredInstructions, null, 2);
  }
  return draft.text;
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

export function loadNodeInspectorPaneState(storage: StorageLike | null = getBrowserStorage()): NodeInspectorPaneState {
  const fallback = { collapsed: false, width: NODE_INSPECTOR_PANE_DEFAULT_WIDTH };
  if (!storage) return fallback;

  try {
    const raw = storage.getItem(NODE_INSPECTOR_PANE_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<NodeInspectorPaneState>;
    return {
      // 每次启动都默认展开，避免新用户不知道右侧有可收起的 Inspector；仅记忆宽度
      collapsed: false,
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
  nodeText,
  nodeRevision,
  externalChange,
  focusRequest,
  onSaved,
  onDirtyChange,
  onExternalChangeResolved,
}: NodeEditorProps) {
  const { t } = useStudioI18n();
  const incomingJsonText = useMemo(
    () => nodeText ?? serializeNodeData(nodeData),
    [nodeData, nodeText],
  );
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
        instructions: parsed.ok
          ? reconcileScenarioInstructionIdentities(restoredDraft.instructions, parsed.instructions)
          : restoredDraft.instructions,
        diagnostics: parsed.ok ? [] : parsed.diagnostics,
      };
    }
    if (restoredDraft.mode === "json") {
      const parsed = parseJsonInstructionText(restoredDraft.text);
      return {
        instructions: parsed.ok
          ? reconcileScenarioInstructionIdentities(restoredDraft.instructions, parsed.instructions)
          : restoredDraft.instructions,
        diagnostics: parsed.ok ? [] : [{ line: 1, message: parsed.error }],
      };
    }
  }, [restoredDraft]);
  const [mode, setMode] = useState<NodeEditorMode>(restoredDraft?.mode ?? "scenario");
  const [text, setText] = useState(() => nodeEditorInitialText(
    restoredDraft,
    restoredDraftState?.instructions ?? null,
    incomingScenarioText,
  ));
  const [instructions, setInstructions] = useState<Instruction[]>(restoredDraftState?.instructions ?? incomingInstructions);
  const [lastValidInstructions, setLastValidInstructions] = useState<Instruction[]>(restoredDraftState?.instructions ?? incomingInstructions);
  const [diagnostics, setDiagnostics] = useState<ScenarioDiagnostic[]>(restoredDraftState?.diagnostics ?? []);
  const [cursorOffset, setCursorOffset] = useState(0);
  const [dirty, setDirty] = useState(restoredDraft !== null);
  const [draftBaseVersion, setDraftBaseVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(restoredDraft ? t("script.editor.restoredDraft") : "");
  const [externalSnapshot, setExternalSnapshot] = useState<NodeFileSnapshot | null>(null);
  const [externalSnapshotError, setExternalSnapshotError] = useState<string | null>(null);
  const [externalSnapshotLoading, setExternalSnapshotLoading] = useState(false);
  const [externalChangeSummary, setExternalChangeSummary] = useState<NodeExternalChange | null>(null);
  const [hasExternalUpdate, setHasExternalUpdate] = useState(false);
  const [writeConflict, setWriteConflict] = useState(false);
  const [externalDiffOpen, setExternalDiffOpen] = useState(false);
  const externalFetchRequestRef = useRef(0);
  const currentNodeFileRef = useRef(node.file);
  currentNodeFileRef.current = node.file;
  const [commandMenuSource, setCommandMenuSource] = useState<CommandMenuSource | null>(null);
  const [parameterTrigger, setParameterTrigger] = useState<ScenarioParameterTrigger | null>(null);
  const [completionIndex, setCompletionIndex] = useState(0);
  const [commandIndex, setCommandIndex] = useState(0);
  const [textareaScrollTop, setTextareaScrollTop] = useState(0);
  // 撤销历史清空属于不可逆操作：模式切换走确认对话，外部刷新/载入走 toast（Spec 33 A4）。
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [undoClearConfirm, setUndoClearConfirm] = useState<{ nextMode: NodeEditorMode } | null>(null);
  function notify(input: ToastInput) {
    setToast({ id: Date.now(), ...input });
  }
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const layoutRootRef = useRef<HTMLDivElement | null>(null);
  const pendingSelectionRef = useRef<number | null>(null);
  const draftVersionRef = useRef(0);
  const instructionsRef = useRef(restoredDraftState?.instructions ?? incomingInstructions);
  const lastValidInstructionsRef = useRef(restoredDraftState?.instructions ?? incomingInstructions);
  const textRef = useRef(text);
  const pendingAssignedIdentitySourcesRef = useRef<PendingAssignedIdentitySource[]>(
    restoredDraft?.pendingAssignedIdentitySources ?? [],
  );
  const undoHistoryRef = useRef<UndoHistory<ScenarioUndoSnapshot>>(createUndoHistory());
  const loadedTextRef = useRef(restoredDraft?.baseJsonText ?? incomingJsonText);
  const loadedRevisionRef = useRef<FileRevision | null | undefined>(
    restoredDraft ? restoredDraft.baseRevision : nodeRevision ?? project.nodeRevisions?.[node.file],
  );
  const [inspectorPane, setInspectorPane] = useState<NodeInspectorPaneState>(() => loadNodeInspectorPaneState());
  const [layoutWidth, setLayoutWidth] = useState<number | undefined>(undefined);
  const [draggingInspector, setDraggingInspector] = useState(false);
  const inspectorPaneLayout = useMemo(
    () => resolveNodeInspectorPaneLayout(inspectorPane, layoutWidth),
    [inspectorPane, layoutWidth],
  );

  const replaceInstructions = (nextInstructions: Instruction[]) => {
    instructionsRef.current = nextInstructions;
    setInstructions(nextInstructions);
  };

  const replaceValidInstructions = (nextInstructions: Instruction[]) => {
    instructionsRef.current = nextInstructions;
    lastValidInstructionsRef.current = nextInstructions;
    setInstructions(nextInstructions);
    setLastValidInstructions(nextInstructions);
  };

  const mergePendingAssignedIdentities = (draftInstructions: Instruction[]) => (
    pendingAssignedIdentitySourcesRef.current.reduce(
      (current, source) => mergeAssignedInstructionIdentities(
        source.savedInstructions,
        source.assigned,
        current,
      ),
      draftInstructions,
    )
  );

  const clearPendingAssignedIdentities = () => {
    pendingAssignedIdentitySourcesRef.current = [];
  };

  const replaceText = (nextText: string) => {
    textRef.current = nextText;
    setText(nextText);
  };

  const nodeIssues = useMemo(() => {
    const file = `content/${node.file}`;
    return (project.projectReport?.projectIssues ?? [])
      .filter((issue) => issue.source === "node" && (issue.nodeId === node.id || issue.file === file))
      .map((issue) => ({ ...issue, instructionIndex: instructionIndexFromJsonPath(issue.jsonPath) }));
  }, [node.file, node.id, project.projectReport]);

  useEffect(() => {
    const incomingRevision = nodeRevision ?? project.nodeRevisions?.[node.file];
    if (dirty) {
      if (
        incomingJsonText !== loadedTextRef.current
        || !sameFileRevision(incomingRevision, loadedRevisionRef.current)
      ) {
        setExternalSnapshot(null);
        setExternalSnapshotError(null);
        setHasExternalUpdate(true);
      }
      return;
    }
    loadedTextRef.current = incomingJsonText;
    loadedRevisionRef.current = incomingRevision;
    clearPendingAssignedIdentities();
    undoHistoryRef.current = createUndoHistory();
    notify({ kind: "info", message: t("script.editor.undoClearedExternal") });
    replaceText(mode === "json" ? incomingJsonText : incomingScenarioText);
    replaceValidInstructions(incomingInstructions);
    setDiagnostics([]);
    setExternalSnapshot(null);
    setExternalSnapshotError(null);
    setExternalChangeSummary(null);
    setHasExternalUpdate(false);
    setWriteConflict(false);
    setExternalDiffOpen(false);
    setStatus("");
  }, [dirty, incomingInstructions, incomingJsonText, incomingScenarioText, mode, node.file, nodeRevision, project.nodeRevisions]);

  useEffect(() => {
    if (!externalChange) return;
    externalFetchRequestRef.current += 1;
    setExternalSnapshotLoading(false);
    setExternalChangeSummary(externalChange);
    setExternalSnapshot(null);
    setExternalSnapshotError(null);
    setHasExternalUpdate(true);
  }, [externalChange]);

  const externalJsonText = externalSnapshot?.text ?? incomingJsonText;
  const externalTextUnavailable = externalSnapshot == null;

  const fetchExternalSnapshot = useCallback(async () => {
    const requestedRelPath = node.file;
    const requestId = externalFetchRequestRef.current + 1;
    externalFetchRequestRef.current = requestId;
    setExternalSnapshotLoading(true);
    setExternalSnapshotError(null);
    try {
      const snapshot = await readNodeFileSnapshot(project.path, requestedRelPath);
      if (!externalSnapshotRequestIsCurrent({
        requestId,
        currentRequestId: externalFetchRequestRef.current,
        requestedRelPath,
        currentRelPath: currentNodeFileRef.current,
      })) return;
      if (
        snapshot.state === "present"
        && snapshot.text === loadedTextRef.current
        && sameFileRevision(snapshot.revision, loadedRevisionRef.current)
      ) {
        setExternalSnapshot(null);
        setHasExternalUpdate(false);
        setWriteConflict(false);
        setExternalDiffOpen(false);
        return;
      }
      setExternalSnapshot(snapshot);
      setHasExternalUpdate(true);
    } catch (error) {
      if (!externalSnapshotRequestIsCurrent({
        requestId,
        currentRequestId: externalFetchRequestRef.current,
        requestedRelPath,
        currentRelPath: currentNodeFileRef.current,
      })) return;
      setExternalSnapshotError(error instanceof Error ? error.message : String(error));
    } finally {
      if (externalFetchRequestRef.current === requestId) {
        setExternalSnapshotLoading(false);
      }
    }
  }, [node.file, project.path]);

  useEffect(() => {
    externalFetchRequestRef.current += 1;
    setExternalSnapshotLoading(false);
  }, [node.file]);

  useEffect(() => {
    if (
      !externalDiffOpen
      || externalSnapshot
      || externalSnapshotLoading
      || externalSnapshotError
    ) return;
    void fetchExternalSnapshot();
  }, [
    externalDiffOpen,
    externalSnapshot,
    externalSnapshotError,
    externalSnapshotLoading,
    fetchExternalSnapshot,
  ]);

  const externalDiff = useMemo(() => {
    if (!externalDiffOpen || externalTextUnavailable) return null;
    const { beforeText, afterText } = externalDiffTexts({ mode, draftText: text, externalJsonText });
    const rows = diffLines(beforeText, afterText);
    return { rows, ...summarizeDiff(rows) };
  }, [externalDiffOpen, externalTextUnavailable, externalJsonText, mode, text]);

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
        pendingAssignedIdentitySources: pendingAssignedIdentitySourcesRef.current,
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
  const scenarioFrameMap = useMemo(() => mapScenarioFrames(text), [text]);
  const [previewStartIndex, setPreviewStartIndex] = useState<number | null>(null);
  const [followPreviewCursor, setFollowPreviewCursor] = useState(false);
  const currentLineStartIndex = useMemo(() => {
    if (mode !== "scenario" || diagnostics.length > 0) return null;
    const index = scenarioFrameMap.startIndexByLine[scenarioSelection.line - 1];
    return index != null && index < instructions.length ? index : null;
  }, [diagnostics.length, instructions.length, mode, scenarioFrameMap, scenarioSelection.line]);

  useEffect(() => {
    setPreviewStartIndex((current) => followedPreviewStart(
      current,
      currentLineStartIndex,
      followPreviewCursor,
      mode === "scenario",
    ));
  }, [currentLineStartIndex, followPreviewCursor, mode]);

  const handleManualPreviewStartChange = useCallback((index: number | null) => {
    setFollowPreviewCursor(false);
    setPreviewStartIndex(index);
  }, []);
  const scenarioCommandTrigger = useMemo(
    () => (mode === "scenario" ? scenarioCommandTriggerAtCursor(text, cursorOffset) : null),
    [cursorOffset, mode, text],
  );
  const commandQuery = commandMenuSource === "trigger" ? scenarioCommandTrigger?.query ?? "" : "";
  const visibleCommands = useMemo(() => scenarioCommandOptionsForQuery(commandQuery, t), [commandQuery, t]);
  const visibleParameters = useMemo(
    () => parameterTrigger ? scenarioParameterOptions(parameterTrigger, project) : [],
    [parameterTrigger, project],
  );
  const parameterMenuVisible = mode === "scenario" && parameterTrigger != null && visibleParameters.length > 0;
  const commandMenuVisible = mode === "scenario"
    && visibleCommands.length > 0
    && (commandMenuSource === "line-plus" || (commandMenuSource === "trigger" && scenarioCommandTrigger != null));
  const lineActionTop = Math.max(
    8,
    SCENARIO_TEXT_PADDING_TOP + (scenarioSelection.line - 1) * SCENARIO_LINE_HEIGHT - textareaScrollTop,
  );
  const canSave = useMemo(() => {
    if (mode === "scenario") return diagnostics.length === 0;
    return parseJsonInstructionText(text).ok;
  }, [diagnostics.length, mode, text]);

  useEffect(() => {
    if (commandMenuSource === "trigger" && !scenarioCommandTrigger) setCommandMenuSource(null);
  }, [commandMenuSource, scenarioCommandTrigger]);

  useEffect(() => {
    setCompletionIndex((current) => Math.min(current, Math.max(visibleParameters.length - 1, 0)));
  }, [visibleParameters.length]);

  useEffect(() => {
    setCommandIndex(0);
  }, [commandMenuSource, commandQuery]);

  useEffect(() => {
    setCommandIndex((current) => clampCompletionIndex(current, visibleCommands.length));
  }, [visibleCommands.length]);

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
    setStatus(t("script.editor.issueLocation", {
      number: index + 1,
      path: focusRequest.jsonPath,
    }));
  }, [focusRequest, t]);

  const applyScenarioText = (nextText: string, options: { programmatic?: boolean; skipHistory?: boolean } = {}) => {
    if (!options.skipHistory) {
      undoHistoryRef.current = recordUndoCheckpoint(undoHistoryRef.current, {
        text,
        instructions: lastValidInstructionsRef.current,
      }, {
        programmatic: options.programmatic,
      });
    }
    draftVersionRef.current += 1;
    replaceText(nextText);
    setDirty(true);
    setStatus("");
    const parsed = parseScenarioText(nextText);
    if (parsed.ok) {
      const reconciled = mergePendingAssignedIdentities(
        reconcileScenarioInstructionIdentities(lastValidInstructionsRef.current, parsed.instructions),
      );
      replaceValidInstructions(reconciled);
      setDiagnostics([]);
    } else {
      setDiagnostics(parsed.diagnostics);
    }
  };

  const applyStructuredInstructions = (
    nextInstructions: Instruction[],
    options: { nextCursorOffset?: number } = {},
  ) => {
    if (nextInstructions === lastValidInstructionsRef.current) return;
    undoHistoryRef.current = recordUndoCheckpoint(undoHistoryRef.current, {
      text,
      instructions: lastValidInstructionsRef.current,
    }, { programmatic: true });
    draftVersionRef.current += 1;
    const nextText = formatScenarioText(nextInstructions);
    if (options.nextCursorOffset != null) {
      pendingSelectionRef.current = options.nextCursorOffset;
      setCursorOffset(options.nextCursorOffset);
    }
    replaceValidInstructions(nextInstructions);
    replaceText(nextText);
    setDiagnostics([]);
    setDirty(true);
    setStatus("");
    setParameterTrigger(null);
  };

  const applyStructuredInstructionAt = (index: number, instruction: Instruction) => {
    const current = lastValidInstructionsRef.current[index];
    if (!current || current.t !== instruction.t) return;
    applyStructuredInstructions(updateInstruction(
      lastValidInstructionsRef.current,
      index,
      instruction as Partial<Instruction>,
    ));
  };

  const applyJsonText = (nextText: string) => {
    draftVersionRef.current += 1;
    replaceText(nextText);
    setDirty(true);
    setStatus("");
    const parsed = parseJsonInstructionText(nextText);
    if (parsed.ok) {
      replaceValidInstructions(mergePendingAssignedIdentities(parsed.instructions));
      setDiagnostics([]);
    } else {
      setDiagnostics([{ line: 1, message: parsed.error }]);
    }
  };

  const buildPayload = (): { ok: true; payload: string; nextInstructions: Instruction[] } | { ok: false; message: string } => {
    if (mode === "scenario") {
      const parsed = parseScenarioText(text);
      if (!parsed.ok) {
        return {
          ok: false,
          message: t("script.editor.scenarioProblems", { count: parsed.diagnostics.length }),
        };
      }
      const reconciled = mergePendingAssignedIdentities(
        reconcileScenarioInstructionIdentities(lastValidInstructionsRef.current, parsed.instructions),
      );
      return { ok: true, payload: JSON.stringify(reconciled, null, 2), nextInstructions: reconciled };
    }
    const parsed = parseJsonInstructionText(text);
    if (!parsed.ok) return { ok: false, message: t("script.editor.jsonSaveFailed", { detail: parsed.error }) };
    const reconciled = mergePendingAssignedIdentities(parsed.instructions);
    return { ok: true, payload: JSON.stringify(reconciled, null, 2), nextInstructions: reconciled };
  };

  const handleSave = async () => {
    if (hasExternalUpdate || writeConflict) {
      setExternalDiffOpen(true);
      setStatus(t("script.editor.resolveConflictBeforeSave"));
      return;
    }
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
        const saved = await saveNode(project.path, node.file, built.nextInstructions, loadedRevisionRef.current);
        loadedTextRef.current = saved.serializedText;
        loadedRevisionRef.current = saved.revision;
        setDraftBaseVersion((version) => version + 1);
        if (isDraftSnapshotCurrent(savedDraftVersion, draftVersionRef.current)) {
          clearPendingAssignedIdentities();
          replaceValidInstructions(saved.instructions);
          setDiagnostics([]);
          replaceText(mode === "json" ? saved.serializedText : formatScenarioText(saved.instructions));
          setDirty(false);
          setStatus(t("script.editor.saved"));
        } else {
          const merged = mergeAssignedInstructionIdentities(
            saved.instructions,
            saved.assigned,
            instructionsRef.current,
          );
          replaceValidInstructions(merged);
          if (mode === "json") {
            const latestParsed = parseJsonInstructionText(textRef.current);
            if (latestParsed.ok) {
              clearPendingAssignedIdentities();
              replaceText(JSON.stringify(merged, null, 2));
            } else if (saved.assigned.length > 0) {
              pendingAssignedIdentitySourcesRef.current.push({
                savedInstructions: saved.instructions,
                assigned: saved.assigned,
              });
            }
          } else if (saved.assigned.length > 0) {
            pendingAssignedIdentitySourcesRef.current.push({
              savedInstructions: saved.instructions,
              assigned: saved.assigned,
            });
          }
          setStatus(t("script.editor.savedWithDraft"));
        }
        setExternalSnapshot(null);
        setExternalSnapshotError(null);
        setExternalChangeSummary(null);
        setHasExternalUpdate(false);
        setWriteConflict(false);
        setExternalDiffOpen(false);
        onExternalChangeResolved?.();
      }
      if (!dirty) setStatus(t("script.editor.saved"));
      onSaved();
    } catch (error) {
      const preserved = nodeEditorKeepsDraftOnWriteConflict({ text, instructions }, error);
      if (preserved.conflict && preserved.draft) {
        if (isDraftSnapshotCurrent(savedDraftVersion, draftVersionRef.current)) {
          replaceText(preserved.draft.text);
          replaceInstructions(preserved.draft.instructions);
        }
        setWriteConflict(true);
        setStatus(t("script.editor.externalConflict"));
      } else {
        setStatus(t("script.editor.saveFailed", { detail: error instanceof Error ? error.message : String(error) }));
      }
    } finally {
      setSaving(false);
    }
  };

  useSaveShortcut(
    !saving && !hasExternalUpdate && !writeConflict,
    () => void handleSave(),
  );

  const handleLoadExternal = () => {
    if (saving) return;
    if (!externalSnapshot) {
      setStatus(t("script.editor.loadingExternal"));
      void fetchExternalSnapshot();
      return;
    }
    if (externalSnapshot.state === "deleted") {
      setStatus(t("script.editor.externalDeletedBlocked"));
      return;
    }
    const nextJsonText = externalSnapshot.text ?? "";
    draftVersionRef.current += 1;
    undoHistoryRef.current = createUndoHistory();
    notify({ kind: "info", message: t("script.editor.undoClearedExternal") });
    const parsed = parseJsonInstructionText(nextJsonText);
    if (!parsed.ok) {
      setMode("json");
    }
    const nextInstructions = parsed.ok ? parsed.instructions : [];
    loadedTextRef.current = nextJsonText;
    loadedRevisionRef.current = externalSnapshot.revision;
    clearPendingAssignedIdentities();
    replaceText(mode === "json" || !parsed.ok ? nextJsonText : formatScenarioText(nextInstructions));
    replaceValidInstructions(nextInstructions);
    setDiagnostics(parsed.ok ? [] : [{ line: 1, message: parsed.error }]);
    setDirty(false);
    setExternalSnapshot(null);
    setExternalSnapshotError(null);
    setExternalChangeSummary(null);
    setHasExternalUpdate(false);
    setWriteConflict(false);
    setExternalDiffOpen(false);
    setStatus(t("script.editor.loadedExternal"));
    onExternalChangeResolved?.();
  };

  const handleKeepLocal = () => {
    if (!externalSnapshot) {
      void fetchExternalSnapshot();
      return;
    }
    const nextBase = keptLocalDraftBase(externalSnapshot);
    loadedTextRef.current = nextBase.text;
    loadedRevisionRef.current = nextBase.revision;
    setDraftBaseVersion((version) => version + 1);
    setDirty(nextBase.dirty);
    setExternalSnapshot(null);
    setExternalSnapshotError(null);
    setExternalChangeSummary(null);
    setHasExternalUpdate(false);
    setWriteConflict(false);
    setExternalDiffOpen(false);
    setStatus(t("script.editor.keptLocal"));
    onExternalChangeResolved?.();
  };

  const handleCopyConflict = async () => {
    if (!externalSnapshot && !externalSnapshotError) {
      void fetchExternalSnapshot();
      return;
    }
    try {
      await navigator.clipboard.writeText(createConflictClipboardText({
        relPath: node.file,
        baseText: loadedTextRef.current,
        localText: text,
        externalSnapshot,
        externalState: externalChangeSummary?.kind,
        relatedPaths: externalChangeSummary?.relatedPaths,
      }));
      setStatus(t("script.editor.conflictCopied"));
    } catch (error) {
      setStatus(t("script.editor.conflictCopyFailed", {
        detail: error instanceof Error ? error.message : String(error),
      }));
    }
  };

  const syncCursorFromTextarea = (textarea: HTMLTextAreaElement) => {
    const nextOffset = textarea.selectionStart;
    setCursorOffset(nextOffset);
    setTextareaScrollTop(textarea.scrollTop);
    if (mode !== "scenario") {
      setCommandMenuSource(null);
      setParameterTrigger(null);
      return;
    }
    const nextCommand = scenarioCommandTriggerAtCursor(textarea.value, nextOffset);
    if (nextCommand) {
      setParameterTrigger(null);
      setCommandMenuSource("trigger");
      setCommandIndex(0);
    } else {
      if (commandMenuSource === "trigger") setCommandMenuSource(null);
      setParameterTrigger(scenarioParameterTriggerAtCursor(textarea.value, nextOffset));
      setCompletionIndex(0);
    }
  };

  const handleScenarioTextChange = (textarea: HTMLTextAreaElement) => {
    const nextText = textarea.value;
    const nextOffset = textarea.selectionStart;
    applyScenarioText(nextText);
    setCursorOffset(nextOffset);
    setTextareaScrollTop(textarea.scrollTop);
    const nextCommand = scenarioCommandTriggerAtCursor(nextText, nextOffset);
    setCommandMenuSource(nextCommand ? "trigger" : null);
    setParameterTrigger(nextCommand ? null : scenarioParameterTriggerAtCursor(nextText, nextOffset));
    setCommandIndex(0);
    setCompletionIndex(0);
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
    setCommandIndex(0);
    applyScenarioText(inserted.text, { programmatic: true });
  };

  const handleInsertTemplate = (templateText: string) => {
    if (mode !== "scenario") return;
    pendingSelectionRef.current = templateText.length;
    setCursorOffset(templateText.length);
    applyScenarioText(templateText, { programmatic: true });
  };

  const handleInsertParameter = (id: string) => {
    if (!parameterTrigger || mode !== "scenario") return;
    const inserted = insertScenarioParameterAtCursor(text, parameterTrigger, id);
    pendingSelectionRef.current = inserted.cursorOffset;
    setCursorOffset(inserted.cursorOffset);
    setParameterTrigger(null);
    setCompletionIndex(0);
    applyScenarioText(inserted.text, { programmatic: true });
  };

  const handleMoveInstruction = (from: number, to: number) => {
    if (mode !== "scenario" || diagnostics.length > 0) return;
    const move = planScenarioInstructionMove(lastValidInstructionsRef.current, from, to);
    if (!move) return;
    setCommandMenuSource(null);
    setParameterTrigger(null);
    applyStructuredInstructions(move.instructions, { nextCursorOffset: move.cursorOffset });
  };

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mode === "scenario") {
      const shortcut = undoShortcutType(event);
      if (shortcut) {
        const result = shortcut === "undo"
          ? undoScenarioText(undoHistoryRef.current, {
            text,
            instructions: lastValidInstructionsRef.current,
          })
          : redoScenarioText(undoHistoryRef.current, {
            text,
            instructions: lastValidInstructionsRef.current,
          });
        if (!result) return; // 栈空时交给 textarea 原生撤销
        event.preventDefault();
        undoHistoryRef.current = result.history;
        pendingSelectionRef.current = result.text.text.length;
        setCursorOffset(result.text.text.length);
        replaceValidInstructions(result.text.instructions);
        applyScenarioText(result.text.text, { skipHistory: true });
        return;
      }
    }
    if (parameterMenuVisible && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      setCompletionIndex((current) => {
        const delta = event.key === "ArrowDown" ? 1 : -1;
        return (current + delta + visibleParameters.length) % visibleParameters.length;
      });
      return;
    }
    if (commandMenuVisible && visibleCommands.length > 0 && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      setCommandIndex((current) => {
        const delta = event.key === "ArrowDown" ? 1 : -1;
        return moveCompletionIndex(current, delta, visibleCommands.length);
      });
      return;
    }
    if (event.key === "Escape" && (commandMenuSource || parameterTrigger)) {
      event.preventDefault();
      setCommandMenuSource(null);
      setParameterTrigger(null);
      return;
    }
    if ((event.key === "Enter" || event.key === "Tab") && parameterMenuVisible) {
      event.preventDefault();
      handleInsertParameter(visibleParameters[completionIndex]?.id ?? visibleParameters[0].id);
      return;
    }
    if ((event.key === "Enter" || event.key === "Tab") && commandMenuVisible && visibleCommands[0]) {
      event.preventDefault();
      handleInsertCommand((visibleCommands[commandIndex] ?? visibleCommands[0]).kind);
    }
  };

  // 模式切换会清空撤销历史（Spec 33 A4）：先确认，再执行原切换逻辑。
  // 失败路径（构建/解析出错）仍在 executeModeToggle 内走 setStatus，不真正清空。
  const requestModeToggle = (nextMode: NodeEditorMode) => {
    if (nextMode === mode) return;
    setUndoClearConfirm({ nextMode });
  };

  const executeModeToggle = (nextMode: NodeEditorMode) => {
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
      setFollowPreviewCursor(false);
      setParameterTrigger(null);
      replaceText(built.payload);
      replaceValidInstructions(built.nextInstructions);
      setDiagnostics([]);
      setStatus("");
      return;
    }
    const parsed = parseJsonInstructionText(text);
    const nextInstructions = mode === "json" && parsed.ok
      ? mergePendingAssignedIdentities(parsed.instructions)
      : lastValidInstructionsRef.current;
    if (mode === "json" && !parsed.ok) {
      setStatus(t("script.editor.modeSwitchFailed", { detail: parsed.error }));
      return;
    }
    draftVersionRef.current += 1;
    undoHistoryRef.current = createUndoHistory();
    setMode("scenario");
    replaceText(formatScenarioText(nextInstructions));
    replaceValidInstructions(nextInstructions);
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

  const selectedInstructionIndex = mode === "scenario" && diagnostics.length === 0
    && scenarioSelection.instruction
    && currentLineStartIndex != null
    && lastValidInstructions[currentLineStartIndex]?.t === scenarioSelection.instruction.t
    ? currentLineStartIndex
    : null;
  const selectedInstruction = selectedInstructionIndex == null
    ? null
    : lastValidInstructions[selectedInstructionIndex] ?? null;
  const inlineControls = mode === "scenario" && selectedInstruction && selectedInstruction.t !== "pause" ? (
    <ScenarioInlineControls
      instruction={selectedInstruction}
      manifest={project.content.manifest}
      variables={project.content.variables}
      onChange={(instruction) => applyStructuredInstructionAt(selectedInstructionIndex!, instruction)}
    />
  ) : null;

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
        onModeToggle={requestModeToggle}
        onOpenExternalDiff={() => setExternalDiffOpen(true)}
        onCopyConflict={handleCopyConflict}
        onSave={handleSave}
        t={t}
      />
      {externalDiffOpen && (hasExternalUpdate || writeConflict) && (
        <ExternalDiffPanel
          writeConflict={writeConflict}
          loading={externalSnapshotLoading || (
            externalDiff == null
            && !externalSnapshotError
          )}
          error={externalSnapshotError}
          rows={externalDiff?.rows ?? null}
          summary={{
            base: revisionSummary(loadedRevisionRef.current),
            local: t("script.externalDiff.localSummary", {
              lines: text === "" ? 0 : text.split("\n").length,
            }),
            external: externalChangeSummary?.kind === "renamed"
              && externalChangeSummary.relatedPaths?.length
              ? externalChangeSummary.relatedPaths.join(" · ")
              : revisionSummary(externalSnapshot?.revision),
            externalState: externalChangeSummary?.kind === "renamed"
              ? "renamed"
              : externalSnapshot?.state ?? (
                externalChangeSummary?.kind === "deleted"
                  ? "deleted"
                  : "present"
              ),
            burstCount: externalChangeSummary?.eventCount,
          }}
          saving={saving}
          onLoadExternal={handleLoadExternal}
          onKeepLocal={handleKeepLocal}
          onCopyConflict={handleCopyConflict}
          onRetry={fetchExternalSnapshot}
        />
      )}
      <ScenarioTextEditor
        mode={mode}
        text={text}
        textareaRef={textareaRef}
        currentLine={scenarioSelection.line}
        implicitPauseLines={scenarioFrameMap.implicitPauseLines}
        instructionIndexByLine={scenarioFrameMap.instructionIndexByLine}
        instructionCount={lastValidInstructions.length}
        reorderingEnabled={mode === "scenario" && diagnostics.length === 0}
        lineActionTop={lineActionTop}
        commandMenuVisible={commandMenuVisible}
        visibleCommands={visibleCommands}
        selectedCommandIndex={commandIndex}
        parameterMenuVisible={parameterMenuVisible}
        visibleParameters={visibleParameters}
        selectedParameterIndex={completionIndex}
        inlineControls={inlineControls}
        onToggleLineCommandMenu={() => {
          setParameterTrigger(null);
          setCommandMenuSource(commandMenuSource === "line-plus" ? null : "line-plus");
          setCommandIndex(0);
          textareaRef.current?.focus();
        }}
        onInsertCommand={handleInsertCommand}
        onInsertParameter={handleInsertParameter}
        onInsertTemplate={handleInsertTemplate}
        onMoveInstruction={handleMoveInstruction}
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
      previewStartIndex={previewStartIndex}
      currentLineStartIndex={currentLineStartIndex}
      followCursor={followPreviewCursor}
      followCursorAvailable={mode === "scenario"}
      onFollowCursorChange={setFollowPreviewCursor}
      onPreviewStartChange={handleManualPreviewStartChange}
    />
  );

  const inspector = mode === "scenario" ? (
    <ScenarioInspector
      selection={scenarioSelection}
      manifest={project.content.manifest}
      variables={project.content.variables}
      diagnostics={diagnostics}
      onReplaceInstruction={(instruction) => {
        if (selectedInstructionIndex != null) {
          applyStructuredInstructionAt(selectedInstructionIndex, instruction);
        }
      }}
    />
  ) : (
    <div style={jsonInspectorStyle}>
      <div style={titleStyle}>{t("script.editor.jsonAdvanced")}</div>
      <div style={helperTextStyle}>{t("script.editor.jsonHint")}</div>
      <div style={helperTextStyle}>
        {t("script.editor.identityGuidance")}
      </div>
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
    <>
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
          aria-label={t("script.editor.resizeInspector")}
          aria-orientation="vertical"
          className="gs-resize-handle"
          onPointerDown={handleInspectorResizeStart}
          style={{
            ...inspectorResizeHandleStyle,
            right: inspectorPaneLayout.paneWidth + INSPECTOR_RAIL_WIDTH - 3,
            cursor: draggingInspector ? "col-resize" : "ew-resize",
          }}
        />
      )}
      onToggleInspectorPane={handleToggleInspectorPane}
    />
    <Toast toast={toast} onClose={() => setToast(null)} />
    {undoClearConfirm && (
      <ConfirmDialog
        message={t("script.editor.modeSwitchConfirm")}
        confirmLabel={t("script.editor.modeSwitchConfirmAction")}
        danger
        onConfirm={() => {
          const pending = undoClearConfirm;
          setUndoClearConfirm(null);
          if (pending) executeModeToggle(pending.nextMode);
        }}
        onClose={() => setUndoClearConfirm(null)}
      />
    )}
    </>
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

/* 底色与悬停反馈走 .gs-resize-handle；内联只保留定位（避免盖住 :hover）。 */
const inspectorResizeHandleStyle: CSSProperties = {
  position: "absolute",
  top: 0,
  bottom: 0,
  zIndex: 4,
  width: 6,
};
