import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatScenarioInstruction,
  formatScenarioText,
  parseScenarioText,
  type Instruction,
  type Manifest as EngineManifest,
  type ScenarioDiagnostic,
} from "@galstudio/engine";
import { saveFile } from "../../lib/tauri";
import type { GraphIssueFocusRequest, GraphNode, ProjectData } from "../../lib/types";
import { ResourcePicker } from "../assets/ResourcePicker";
import { StageFrame } from "../preview/StageFrame";
import { useRendererComponent } from "../preview/useRendererComponent";
import { useNodePreview } from "./useNodePreview";
import {
  defaultInstruction,
  type InsertableKind,
} from "./instructions";
import {
  instructionIndexFromJsonPath,
} from "./instructionEditing";
import {
  getScenarioSelection,
  replaceScenarioSelectionInstruction,
  ScenarioInspector,
  ScenarioNodeLayout,
} from "./scenarioEditor";

interface NodeEditorProps {
  project: ProjectData;
  rendererId: string;
  node: GraphNode;
  nodeData: unknown | null;
  focusRequest?: GraphIssueFocusRequest | null;
  onSaved: () => void;
}

type NodeEditorMode = "scenario" | "json" | "blocks";
type CommandMenuSource = "trigger" | "line-plus";

export function isWriteConflictError(error: unknown): boolean {
  if (error instanceof Error) return isWriteConflictError(error.message);
  if (typeof error === "string") {
    if (error.includes("write_conflict")) return true;
    try {
      const parsed = JSON.parse(error) as { code?: string };
      return parsed.code === "write_conflict";
    } catch {
      return false;
    }
  }
  return typeof error === "object" && error != null && (error as { code?: string }).code === "write_conflict";
}

export function nodeEditorKeepsDraftOnWriteConflict<T extends { text: string; instructions: Instruction[] }>(
  draft: T,
  error: unknown,
): { conflict: boolean; draft: T | null } {
  return isWriteConflictError(error)
    ? { conflict: true, draft }
    : { conflict: false, draft: null };
}

export function conflictDraftCopyPath(nodeFile: string, stamp: number): string {
  return nodeFile.replace(/\.json$/, `.conflict-${stamp}.json`);
}

export function transitionNodeEditorMode({
  mode,
  text,
  instructions,
}: {
  mode: NodeEditorMode;
  text: string;
  instructions: Instruction[];
}): {
  mode: NodeEditorMode;
  text: string;
  instructions: Instruction[];
  error: string | null;
} {
  if (mode === "json") {
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        return { mode, text, instructions, error: "切换失败：节点内容必须是 JSON 数组。" };
      }
      return {
        mode: "blocks",
        text: JSON.stringify(parsed, null, 2),
        instructions: parsed as Instruction[],
        error: null,
      };
    } catch (error) {
      return {
        mode,
        text,
        instructions,
        error: `切换失败：${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  return {
    mode: "json",
    text: JSON.stringify(instructions, null, 2),
    instructions,
    error: null,
  };
}

function serializeNodeData(nodeData: unknown | null): string {
  return nodeData == null ? "[]" : JSON.stringify(nodeData, null, 2);
}

function instructionsFromNodeData(nodeData: unknown | null): Instruction[] {
  return Array.isArray(nodeData) ? (nodeData as Instruction[]) : [];
}

function scenarioTextFromNodeData(nodeData: unknown | null): string {
  return formatScenarioText(instructionsFromNodeData(nodeData));
}

function parseJsonInstructionText(text: string): { ok: true; instructions: Instruction[] } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return { ok: false, error: "节点内容必须是 JSON 数组。" };
    return { ok: true, instructions: parsed as Instruction[] };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const SCENARIO_COMMANDS: Array<{ kind: InsertableKind; label: string; detail: string; aliases: string[] }> = [
  { kind: "narrate", label: "旁白", detail: "插入一行叙述文本", aliases: ["narrate", "text", "旁白"] },
  { kind: "say", label: "台词", detail: "插入角色台词", aliases: ["say", "dialog", "台词"] },
  { kind: "bg", label: "背景", detail: "切换背景", aliases: ["bg", "background", "背景"] },
  { kind: "bgm", label: "BGM", detail: "播放背景音乐", aliases: ["bgm", "music", "音乐"] },
  { kind: "sfx", label: "音效", detail: "播放音效", aliases: ["sfx", "sound", "音效"] },
  { kind: "voice", label: "语音", detail: "播放语音", aliases: ["voice", "语音"] },
  { kind: "char", label: "角色", detail: "登场或切换立绘", aliases: ["char", "character", "角色"] },
  { kind: "wait", label: "等待", detail: "等待指定毫秒", aliases: ["wait", "等待"] },
  { kind: "effect", label: "效果", detail: "触发画面效果", aliases: ["effect", "fx", "效果"] },
  { kind: "transition", label: "转场", detail: "触发转场覆盖层", aliases: ["transition", "trans", "转场"] },
  { kind: "choice", label: "选择", detail: "插入分支选项", aliases: ["choice", "branch", "选择"] },
];

interface ScenarioCommandTrigger {
  trigger: "@" | "/";
  query: string;
  replaceStart: number;
  replaceEnd: number;
  line: number;
}

export function scenarioCommandTriggerAtCursor(text: string, cursorOffset: number): ScenarioCommandTrigger | null {
  const bounds = lineBoundsAtCursor(text, cursorOffset);
  const prefix = text.slice(bounds.start, bounds.offset);
  const suffix = text.slice(bounds.offset, bounds.end);
  if (suffix.trim().length > 0) return null;

  const trimmedPrefix = prefix.trimStart();
  const leadingWhitespace = prefix.length - trimmedPrefix.length;
  const trigger = trimmedPrefix[0];
  if (trigger !== "@" && trigger !== "/") return null;

  const query = trimmedPrefix.slice(1);
  if (query.length > 0 && /\s/.test(query)) return null;

  return {
    trigger,
    query,
    replaceStart: bounds.start + leadingWhitespace,
    replaceEnd: bounds.end,
    line: bounds.line,
  };
}

export function insertScenarioCommandAtCursor(
  text: string,
  cursorOffset: number,
  commandText: string,
): { text: string; cursorOffset: number } {
  const trigger = scenarioCommandTriggerAtCursor(text, cursorOffset);
  if (trigger) {
    const nextText = `${text.slice(0, trigger.replaceStart)}${commandText}${text.slice(trigger.replaceEnd)}`;
    return { text: nextText, cursorOffset: trigger.replaceStart + commandText.length };
  }

  const bounds = lineBoundsAtCursor(text, cursorOffset);
  const lineText = text.slice(bounds.start, bounds.end);
  if (lineText.trim().length === 0) {
    const nextText = `${text.slice(0, bounds.start)}${commandText}${text.slice(bounds.end)}`;
    return { text: nextText, cursorOffset: bounds.start + commandText.length };
  }

  const nextText = `${text.slice(0, bounds.end)}\n${commandText}${text.slice(bounds.end)}`;
  return { text: nextText, cursorOffset: bounds.end + 1 + commandText.length };
}

function lineBoundsAtCursor(text: string, cursorOffset: number): { start: number; end: number; offset: number; line: number } {
  const offset = Math.max(0, Math.min(cursorOffset, text.length));
  const previousBreak = offset === 0 ? -1 : text.lastIndexOf("\n", offset - 1);
  const start = previousBreak + 1;
  const nextBreak = text.indexOf("\n", offset);
  const end = nextBreak === -1 ? text.length : nextBreak;
  const line = text.slice(0, offset).split("\n").length;
  return { start, end, offset, line };
}

function scenarioCommandOptionsForQuery(query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return SCENARIO_COMMANDS;
  return SCENARIO_COMMANDS.filter((command) => (
    command.label.toLowerCase().includes(normalized)
    || command.kind.toLowerCase().includes(normalized)
    || command.aliases.some((alias) => alias.toLowerCase().includes(normalized))
  ));
}

function defaultScenarioInstruction(kind: InsertableKind, project: ProjectData): Instruction {
  const draft = defaultInstruction(kind);
  const manifest = project.content.manifest;
  const firstCharacter = Object.keys(manifest.characters)[0] ?? "角色";
  const firstBackground = Object.keys(manifest.backgrounds)[0] ?? "背景";
  const firstBgm = Object.keys(manifest.audio.bgm)[0] ?? "bgm";
  const firstSfx = Object.keys(manifest.audio.sfx)[0] ?? "sfx";
  const firstVoice = Object.keys(manifest.audio.voice)[0] ?? "voice";

  switch (draft.t) {
    case "narrate":
      return { ...draft, text: "旁白" };
    case "say":
      return { ...draft, who: firstCharacter, text: "台词" };
    case "bg":
      return { ...draft, id: firstBackground };
    case "bgm":
      return { ...draft, id: firstBgm };
    case "sfx":
      return { ...draft, id: firstSfx };
    case "voice":
      return { ...draft, id: firstVoice };
    case "char":
      return { ...draft, id: firstCharacter };
    default:
      return draft;
  }
}

export function NodeEditor({ project, rendererId, node, nodeData, focusRequest, onSaved }: NodeEditorProps) {
  const incomingJsonText = useMemo(() => serializeNodeData(nodeData), [nodeData]);
  const incomingScenarioText = useMemo(() => scenarioTextFromNodeData(nodeData), [nodeData]);
  const incomingInstructions = useMemo(() => instructionsFromNodeData(nodeData), [nodeData]);
  const [mode, setMode] = useState<NodeEditorMode>("scenario");
  const [text, setText] = useState(incomingScenarioText);
  const [instructions, setInstructions] = useState<Instruction[]>(incomingInstructions);
  const [lastValidInstructions, setLastValidInstructions] = useState<Instruction[]>(incomingInstructions);
  const [diagnostics, setDiagnostics] = useState<ScenarioDiagnostic[]>([]);
  const [cursorOffset, setCursorOffset] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [pendingExternalText, setPendingExternalText] = useState<string | null>(null);
  const [hasExternalUpdate, setHasExternalUpdate] = useState(false);
  const [writeConflict, setWriteConflict] = useState(false);
  const [draftCopyPath, setDraftCopyPath] = useState<string | null>(null);
  const [commandMenuSource, setCommandMenuSource] = useState<CommandMenuSource | null>(null);
  const [textareaScrollTop, setTextareaScrollTop] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingSelectionRef = useRef<number | null>(null);
  const loadedTextRef = useRef(incomingJsonText);
  const loadedRevisionRef = useRef(project.nodeRevisions?.[node.file] ?? undefined);

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
    if (mode === "json") return parseJsonInstructionText(text).ok;
    return true;
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

  const applyScenarioText = (nextText: string) => {
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
    if (mode === "json") {
      const parsed = parseJsonInstructionText(text);
      if (!parsed.ok) return { ok: false, message: `JSON 无法保存：${parsed.error}` };
      return { ok: true, payload: JSON.stringify(parsed.instructions, null, 2), nextInstructions: parsed.instructions };
    }
    return { ok: true, payload: JSON.stringify(instructions, null, 2), nextInstructions: instructions };
  };

  const handleSave = async () => {
    const built = buildPayload();
    if (!built.ok) {
      setStatus(built.message);
      return;
    }
    setSaving(true);
    setStatus("");
    try {
      await saveFile(project.path, `content/${node.file}`, built.payload, loadedRevisionRef.current);
      loadedTextRef.current = built.payload;
      loadedRevisionRef.current = undefined;
      setInstructions(built.nextInstructions);
      setLastValidInstructions(built.nextInstructions);
      setDiagnostics([]);
      setText(mode === "json" ? built.payload : formatScenarioText(built.nextInstructions));
      setDirty(false);
      setPendingExternalText(null);
      setHasExternalUpdate(false);
      setWriteConflict(false);
      setDraftCopyPath(null);
      setStatus("已保存 ✓");
      onSaved();
    } catch (error) {
      const preserved = nodeEditorKeepsDraftOnWriteConflict({ text, instructions }, error);
      if (preserved.conflict && preserved.draft) {
        setText(preserved.draft.text);
        setInstructions(preserved.draft.instructions);
        setWriteConflict(true);
        setStatus("保存失败: 文件已被外部修改，当前草稿已保留。");
      } else {
        setStatus(`保存失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleLoadExternal = () => {
    if (writeConflict && pendingExternalText == null && incomingJsonText === loadedTextRef.current) {
      setStatus("正在载入外部版本…");
      void onSaved();
      return;
    }
    const nextJsonText = pendingExternalText ?? incomingJsonText;
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

  const handleInsertCommand = (kind: InsertableKind) => {
    if (mode !== "scenario") return;
    const commandText = formatScenarioInstruction(defaultScenarioInstruction(kind, project));
    const inserted = insertScenarioCommandAtCursor(text, cursorOffset, commandText);
    pendingSelectionRef.current = inserted.cursorOffset;
    setCursorOffset(inserted.cursorOffset);
    setCommandMenuSource(null);
    applyScenarioText(inserted.text);
  };

  const handleTextareaKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
    setMode("scenario");
    setText(formatScenarioText(nextInstructions));
    setInstructions(nextInstructions);
    setLastValidInstructions(nextInstructions);
    setDiagnostics([]);
    setStatus("");
  };

  const editor = (
    <div style={editorPaneStyle}>
      <div style={toolbarStyle}>
        <div style={titleGroupStyle}>
          <div style={titleStyle}>{node.title}</div>
          <div style={metaStyle}>{node.file}</div>
        </div>
        <div style={toolbarSpacerStyle} />
        <button type="button" onClick={() => handleModeToggle("scenario")} style={toggleButtonStyle}>剧本</button>
        <button type="button" onClick={() => handleModeToggle("json")} style={toggleButtonStyle}>JSON</button>
        {dirty && <span style={{ ...statusTextStyle, color: "var(--status-warn-text)" }}>未保存</span>}
        {diagnostics.length > 0 && <span style={{ ...statusTextStyle, color: "var(--status-error-text)" }}>剧本有 {diagnostics.length} 个问题</span>}
        {hasExternalUpdate && !writeConflict && (
          <button type="button" onClick={handleLoadExternal} style={loadButtonStyle}>
            外部已更新，点击载入
          </button>
        )}
        {writeConflict && (
          <>
            <button type="button" onClick={handleLoadExternal} style={loadButtonStyle}>
              载入外部版本
            </button>
            <button type="button" onClick={handleSaveDraftCopy} disabled={saving} style={loadButtonStyle}>
              另存为副本
            </button>
          </>
        )}
        {status && (
          <span style={{ ...statusTextStyle, color: status.includes("失败") || status.includes("问题") ? "var(--status-error-text)" : "var(--status-ok-text)" }}>
            {status}
          </span>
        )}
        {draftCopyPath && <span style={statusTextStyle}>{draftCopyPath}</span>}
        <button type="button" onClick={handleSave} disabled={saving || !canSave} style={saveButtonStyle}>
          {saving ? "保存中…" : "保存"}
        </button>
      </div>
      <div style={scenarioTextWrapStyle}>
        {mode === "scenario" && (
          <button
            type="button"
            aria-label="插入当前行命令"
            title="插入当前行命令"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setCommandMenuSource(commandMenuSource === "line-plus" ? null : "line-plus");
              textareaRef.current?.focus();
            }}
            style={{ ...linePlusButtonStyle, top: lineActionTop }}
          >
            +
          </button>
        )}
        {commandMenuVisible && (
          <div
            role="menu"
            aria-label="剧本命令"
            style={{ ...commandMenuStyle, top: lineActionTop + 30 }}
          >
            {visibleCommands.map((command) => (
              <button
                key={command.kind}
                type="button"
                role="menuitem"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => handleInsertCommand(command.kind)}
                style={commandMenuButtonStyle}
              >
                <span style={commandMenuLabelStyle}>{command.label}</span>
                <span style={commandMenuDetailStyle}>{command.detail}</span>
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => {
            if (mode === "scenario") handleScenarioTextChange(event.currentTarget);
            else {
              setCommandMenuSource(null);
              setCursorOffset(event.currentTarget.selectionStart);
              setTextareaScrollTop(event.currentTarget.scrollTop);
              applyJsonText(event.target.value);
            }
          }}
          onSelect={(event) => syncCursorFromTextarea(event.currentTarget)}
          onClick={(event) => syncCursorFromTextarea(event.currentTarget)}
          onKeyDown={handleTextareaKeyDown}
          onKeyUp={(event) => syncCursorFromTextarea(event.currentTarget)}
          onScroll={(event) => setTextareaScrollTop(event.currentTarget.scrollTop)}
          spellCheck={false}
          style={mode === "scenario" ? scenarioTextareaStyle : textareaStyle}
        />
      </div>
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
      graphNodes={project.graph?.nodes ?? []}
      diagnostics={diagnostics}
      onReplaceInstruction={(instruction) => applyScenarioText(replaceScenarioSelectionInstruction(text, scenarioSelection, instruction))}
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

  return <ScenarioNodeLayout editor={editor} preview={preview} inspector={inspector} />;
}

export function InstructionBlock({
  index,
  instruction,
  manifest,
  graphNodes,
  issues,
  onUpdate,
  onDuplicate,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  index: number;
  instruction: Instruction;
  manifest: EngineManifest;
  graphNodes?: GraphNode[];
  issues: Array<{ code: string; message: string; jsonPath?: string }>;
  onUpdate: (instruction: Instruction) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  return (
    <div style={blockStyle}>
      <div style={blockHeaderStyle}>
        <strong>{String(index + 1).padStart(2, "0")} · {instruction.t}</strong>
        <div style={blockActionsStyle}>
          <button type="button" style={miniButtonStyle} onClick={onMoveUp}>上移</button>
          <button type="button" style={miniButtonStyle} onClick={onMoveDown}>下移</button>
          <button type="button" style={miniButtonStyle} onClick={onDuplicate}>复制</button>
          <button type="button" style={miniButtonStyle} onClick={onDelete}>删除</button>
        </div>
      </div>
      {issues.length > 0 && (
        <div style={issueListStyle}>
          {issues.map((issue) => (
            <div key={`${issue.code}-${issue.jsonPath ?? issue.message}`} style={issueItemStyle}>
              {issue.code}: {issue.message}
            </div>
          ))}
        </div>
      )}
      {instruction.t === "say" ? (
        <div style={blockFieldsStyle}>
          <ResourcePicker
            label="角色"
            manifest={manifest as ProjectData["content"]["manifest"]}
            kind="character"
            value={instruction.who}
            onChange={(who) => onUpdate({ ...instruction, who })}
          />
          <ResourcePicker
            label="表情"
            manifest={manifest as ProjectData["content"]["manifest"]}
            kind="expression"
            characterId={instruction.who}
            value={instruction.expr}
            onChange={(expr) => onUpdate({ ...instruction, expr })}
          />
          <label style={fieldStyle}>
            <span style={fieldLabelStyle}>文本</span>
            <textarea
              value={instruction.text}
              onChange={(event) => onUpdate({ ...instruction, text: event.target.value })}
              style={blockTextareaStyle}
            />
          </label>
          <NumberField
            label="停顿 ms"
            value={instruction.ms}
            onChange={(value) => onUpdate({ ...instruction, ms: value })}
          />
        </div>
      ) : null}
      {instruction.t === "narrate" ? (
        <div style={blockFieldsStyle}>
          <label style={fieldStyle}>
            <span style={fieldLabelStyle}>旁白</span>
            <textarea
              value={instruction.text}
              onChange={(event) => onUpdate({ ...instruction, text: event.target.value })}
              style={blockTextareaStyle}
            />
          </label>
          <NumberField
            label="停顿 ms"
            value={instruction.ms}
            onChange={(value) => onUpdate({ ...instruction, ms: value })}
          />
        </div>
      ) : null}
      {instruction.t === "bg" ? (
        <div style={blockFieldsStyle}>
          <ResourcePicker
            label="背景"
            manifest={manifest as ProjectData["content"]["manifest"]}
            kind="background"
            value={instruction.id}
            onChange={(id) => onUpdate({ ...instruction, id })}
          />
          <EnumField
            label="转场"
            value={instruction.trans}
            options={["fade", "cut", "dissolve"]}
            onChange={(trans) => onUpdate({ ...instruction, trans: trans as "fade" | "cut" | "dissolve" })}
          />
          <NumberField label="时长 ms" value={instruction.ms} onChange={(ms) => onUpdate({ ...instruction, ms: ms ?? 0 })} />
        </div>
      ) : null}
      {instruction.t === "bgm" ? (
        <div style={blockFieldsStyle}>
          <ResourcePicker
            label="BGM"
            manifest={manifest as ProjectData["content"]["manifest"]}
            kind="bgm"
            value={instruction.id}
            onChange={(id) => onUpdate({ ...instruction, id })}
          />
          <NumberField label="淡入 ms" value={instruction.fade} onChange={(fade) => onUpdate({ ...instruction, fade: fade ?? 0 })} />
          <label style={checkboxFieldStyle}>
            <input
              type="checkbox"
              checked={instruction.loop}
              onChange={(event) => onUpdate({ ...instruction, loop: event.target.checked })}
            />
            循环
          </label>
        </div>
      ) : null}
      {instruction.t === "sfx" ? (
        <div style={blockFieldsStyle}>
          <ResourcePicker
            label="音效"
            manifest={manifest as ProjectData["content"]["manifest"]}
            kind="sfx"
            value={instruction.id}
            onChange={(id) => onUpdate({ ...instruction, id })}
          />
        </div>
      ) : null}
      {instruction.t === "voice" ? (
        <div style={blockFieldsStyle}>
          <ResourcePicker
            label="语音"
            manifest={manifest as ProjectData["content"]["manifest"]}
            kind="voice"
            value={instruction.id}
            onChange={(id) => onUpdate({ ...instruction, id })}
          />
        </div>
      ) : null}
      {instruction.t === "char" ? (
        <div style={blockFieldsStyle}>
          <ResourcePicker
            label="角色"
            manifest={manifest as ProjectData["content"]["manifest"]}
            kind="character"
            value={instruction.id}
            onChange={(id) => onUpdate({ ...instruction, id })}
          />
          <ResourcePicker
            label="表情"
            manifest={manifest as ProjectData["content"]["manifest"]}
            kind="expression"
            characterId={instruction.id}
            value={instruction.expr}
            onChange={(expr) => onUpdate({ ...instruction, expr })}
          />
          <TextField label="位置" value={instruction.pos} onChange={(pos) => onUpdate({ ...instruction, pos })} />
          <EnumField
            label="转场"
            value={instruction.trans}
            options={["fade", "cut", "slide"]}
            onChange={(trans) => onUpdate({ ...instruction, trans: trans as "fade" | "cut" | "slide" })}
          />
          <NumberField label="时长 ms" value={instruction.ms} onChange={(ms) => onUpdate({ ...instruction, ms: ms ?? 0 })} />
          <label style={checkboxFieldStyle}>
            <input
              type="checkbox"
              checked={instruction.clear}
              onChange={(event) => onUpdate({ ...instruction, clear: event.target.checked })}
            />
            入场前清空
          </label>
          <label style={checkboxFieldStyle}>
            <input
              type="checkbox"
              checked={instruction.remove}
              onChange={(event) => onUpdate({ ...instruction, remove: event.target.checked })}
            />
            退场
          </label>
        </div>
      ) : null}
      {instruction.t === "wait" ? (
        <div style={blockFieldsStyle}>
          <NumberField label="等待 ms" value={instruction.ms} onChange={(ms) => onUpdate({ ...instruction, ms: ms ?? 0 })} />
        </div>
      ) : null}
      {instruction.t === "effect" ? (
        <div style={blockFieldsStyle}>
          <EnumField
            label="效果"
            value={instruction.type}
            options={["shake", "flash", "blur"]}
            onChange={(type) => onUpdate({ ...instruction, type: type as "shake" | "flash" | "blur" })}
          />
          <NumberField label="强度" value={instruction.intensity} onChange={(intensity) => onUpdate({ ...instruction, intensity: intensity ?? 0 })} />
          <NumberField label="时长 ms" value={instruction.ms} onChange={(ms) => onUpdate({ ...instruction, ms: ms ?? 0 })} />
        </div>
      ) : null}
      {instruction.t === "transition" ? (
        <div style={blockFieldsStyle}>
          <EnumField
            label="转场"
            value={instruction.type}
            options={["fade_in", "fade_out", "white_in", "white_out", "black"]}
            onChange={(type) => onUpdate({ ...instruction, type: type as "fade_in" | "fade_out" | "white_in" | "white_out" | "black" })}
          />
          <NumberField label="时长 ms" value={instruction.ms} onChange={(ms) => onUpdate({ ...instruction, ms: ms ?? 0 })} />
        </div>
      ) : null}
      {instruction.t === "choice" ? (
        <div style={blockFieldsStyle}>
          {instruction.choices.map((choice, choiceIndex) => (
            <div key={choiceIndex} style={choiceRowStyle}>
              <TextField
                label="选项文本"
                value={choice.text}
                onChange={(text) => {
                  const choices = instruction.choices.map((item, currentIndex) => (
                    currentIndex === choiceIndex ? { ...item, text } : item
                  ));
                  onUpdate({ ...instruction, choices });
                }}
              />
              <label style={fieldStyle}>
                <span style={fieldLabelStyle}>目标节点</span>
                <div style={pickerRowStyle}>
                  <select
                    value={choice.to}
                    onChange={(event) => {
                      const to = event.target.value;
                      const choices = instruction.choices.map((item, currentIndex) => (
                        currentIndex === choiceIndex ? { ...item, to } : item
                      ));
                      onUpdate({ ...instruction, choices });
                    }}
                    style={selectStyle}
                  >
                    <option value="">选择节点</option>
                    {choice.to && !graphNodes?.some((node) => node.id === choice.to) && (
                      <option value={choice.to}>{`缺失：${choice.to}`}</option>
                    )}
                    {(graphNodes ?? []).map((node) => (
                      <option key={node.id} value={node.id}>{node.title || node.id}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={choice.to}
                    onChange={(event) => {
                      const to = event.target.value;
                      const choices = instruction.choices.map((item, currentIndex) => (
                        currentIndex === choiceIndex ? { ...item, to } : item
                      ));
                      onUpdate({ ...instruction, choices });
                    }}
                    style={inputStyle}
                  />
                </div>
              </label>
              <button
                type="button"
                style={miniButtonStyle}
                onClick={() => {
                  const choices = instruction.choices.filter((_, currentIndex) => currentIndex !== choiceIndex);
                  onUpdate({ ...instruction, choices: choices.length > 0 ? choices : [{ text: "选项", to: "" }] });
                }}
              >
                删除选项
              </button>
            </div>
          ))}
          <button
            type="button"
            style={miniButtonStyle}
            onClick={() => onUpdate({ ...instruction, choices: [...instruction.choices, { text: "选项", to: "" }] })}
          >
            添加选项
          </button>
        </div>
      ) : null}
    </div>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label style={fieldStyle}>
      <span style={fieldLabelStyle}>{label}</span>
      <input type="text" value={value} onChange={(event) => onChange(event.target.value)} style={inputStyle} />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: number;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <label style={fieldStyle}>
      <span style={fieldLabelStyle}>{label}</span>
      <input
        type="number"
        min={0}
        value={value ?? ""}
        onChange={(event) => {
          const raw = event.target.value;
          onChange(raw === "" ? undefined : Math.max(0, Number.parseInt(raw, 10) || 0));
        }}
        style={inputStyle}
      />
    </label>
  );
}

function EnumField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label style={fieldStyle}>
      <span style={fieldLabelStyle}>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} style={selectStyle}>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function NodePreviewPanel({ project, rendererId, node, nodeData }: {
  project: ProjectData;
  rendererId: string;
  node: GraphNode;
  nodeData: unknown | null;
}) {
  const player = useNodePreview(project, node, nodeData);
  const { renderer, loadError } = useRendererComponent(project.path, rendererId);

  if (player.error) return <PreviewMessage mono>{`引擎错误：\n\n${player.error}`}</PreviewMessage>;
  if (loadError) return <PreviewMessage mono>{`渲染层加载失败（${rendererId}）：\n\n${loadError}`}</PreviewMessage>;
  if (!renderer) return <PreviewMessage>加载渲染层中…</PreviewMessage>;
  if (nodeData == null) return <PreviewMessage>节点无内容。保存后会在这里预览。</PreviewMessage>;

  const Renderer = renderer.Component;
  return (
    <StageFrame stage={player.rendererProps.stage}>
      <Renderer {...player.rendererProps} />
    </StageFrame>
  );
}

function PreviewMessage({ children, mono = false }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <div style={{
      width: "100%",
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
      color: "var(--text-primary)",
      textAlign: "center",
      whiteSpace: "pre-wrap",
      lineHeight: 1.8,
      fontSize: 14,
      fontFamily: mono ? "ui-monospace, monospace" : "inherit",
    }}>
      {children}
    </div>
  );
}

const editorPaneStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  borderRight: "1px solid var(--border)",
};

const toolbarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "10px 16px",
  borderBottom: "1px solid var(--border)",
  background: "var(--bg-app)",
};

const titleGroupStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  minWidth: 0,
};

const titleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: "var(--text-bright)",
};

const metaStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-muted)",
  wordBreak: "break-all",
};

const toolbarSpacerStyle: React.CSSProperties = {
  flex: 1,
};

const statusTextStyle: React.CSSProperties = {
  fontSize: 12,
};

const toggleButtonStyle: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 6,
  border: "1px solid var(--border-input)",
  background: "var(--bg-panel)",
  color: "var(--text-secondary)",
  cursor: "pointer",
  fontSize: 12,
};

const loadButtonStyle: React.CSSProperties = {
  ...toggleButtonStyle,
  color: "var(--status-warn-text)",
  borderColor: "var(--status-warn)",
};

const saveButtonStyle: React.CSSProperties = {
  padding: "6px 16px",
  borderRadius: 6,
  border: "1px solid var(--accent)",
  background: "var(--accent)",
  color: "var(--text-on-accent)",
  cursor: "pointer",
  fontSize: 13,
  flexShrink: 0,
};

const textareaStyle: React.CSSProperties = {
  flex: 1,
  width: "100%",
  height: "100%",
  resize: "none",
  border: "none",
  outline: "none",
  padding: 16,
  background: "var(--bg-inset)",
  color: "var(--text-primary)",
  fontFamily: "ui-monospace, 'SF Mono', monospace",
  fontSize: 13,
  lineHeight: 1.6,
};

const scenarioTextareaStyle: React.CSSProperties = {
  ...textareaStyle,
  fontFamily: "ui-monospace, 'SF Mono', monospace",
  fontSize: 14,
  lineHeight: 1.7,
  paddingLeft: 46,
};

const jsonInspectorStyle: React.CSSProperties = {
  display: "grid",
  gap: 12,
  padding: 16,
};

const helperTextStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-dim)",
  padding: "4px 0",
};

const scenarioTextWrapStyle: React.CSSProperties = {
  position: "relative",
  flex: 1,
  minHeight: 0,
};

const linePlusButtonStyle: React.CSSProperties = {
  position: "absolute",
  left: 10,
  zIndex: 3,
  width: 24,
  height: 24,
  borderRadius: 6,
  border: "1px solid var(--border-input)",
  background: "var(--bg-panel)",
  color: "var(--text-secondary)",
  cursor: "pointer",
  fontSize: 16,
  lineHeight: "20px",
};

const commandMenuStyle: React.CSSProperties = {
  position: "absolute",
  left: 36,
  zIndex: 4,
  display: "grid",
  gap: 4,
  width: 240,
  maxHeight: 280,
  overflow: "auto",
  padding: 6,
  borderRadius: 8,
  border: "1px solid var(--border-strong)",
  background: "var(--bg-panel)",
  boxShadow: "0 14px 34px rgba(15, 23, 42, 0.18)",
};

const commandMenuButtonStyle: React.CSSProperties = {
  display: "grid",
  gap: 2,
  padding: "7px 9px",
  border: "none",
  borderRadius: 6,
  background: "transparent",
  color: "var(--text-primary)",
  textAlign: "left",
  cursor: "pointer",
};

const commandMenuLabelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
};

const commandMenuDetailStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-muted)",
};

const blockStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: 12,
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--bg-app)",
};

const blockHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const blockActionsStyle: React.CSSProperties = {
  display: "flex",
  gap: 6,
};

const miniButtonStyle: React.CSSProperties = {
  padding: "4px 8px",
  borderRadius: 6,
  border: "1px solid var(--border-input)",
  background: "var(--bg-panel)",
  color: "var(--text-secondary)",
  cursor: "pointer",
  fontSize: 11,
};

const blockFieldsStyle: React.CSSProperties = {
  display: "grid",
  gap: 10,
};

const fieldStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-secondary)",
};

const blockTextareaStyle: React.CSSProperties = {
  minHeight: 90,
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid var(--border-strong)",
  background: "var(--bg-panel)",
  color: "var(--text-primary)",
  fontSize: 13,
  resize: "vertical",
};

const inputStyle: React.CSSProperties = {
  minWidth: 0,
  padding: "7px 9px",
  borderRadius: 6,
  border: "1px solid var(--border-strong)",
  background: "var(--bg-panel)",
  color: "var(--text-primary)",
  fontSize: 13,
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
};

const pickerRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(120px, 0.8fr)",
  gap: 8,
};

const checkboxFieldStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  color: "var(--text-secondary)",
  fontSize: 13,
};

const choiceRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(160px, 1fr) minmax(220px, 1.4fr) auto",
  gap: 10,
  alignItems: "end",
};

const issueListStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid var(--status-error)",
  background: "var(--bg-tag-error)",
};

const issueItemStyle: React.CSSProperties = {
  color: "var(--status-error-text)",
  fontSize: 12,
  lineHeight: 1.5,
};
