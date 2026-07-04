import { useEffect, useMemo, useRef, useState } from "react";
import type { Instruction, Manifest as EngineManifest } from "@galstudio/engine";
import { saveFile } from "../../lib/tauri";
import type { GraphIssueFocusRequest, GraphNode, ProjectData } from "../../lib/types";
import { ResourcePicker } from "../assets/ResourcePicker";
import { StageFrame } from "../preview/StageFrame";
import { useRendererComponent } from "../preview/useRendererComponent";
import { useNodePreview } from "./useNodePreview";
import {
  defaultInstruction,
  insertInstructionAt,
  summarizeInstructions,
  type InsertableKind,
} from "./instructions";
import {
  deleteInstruction,
  duplicateInstruction,
  instructionIndexFromJsonPath,
  moveInstruction,
} from "./instructionEditing";

interface NodeEditorProps {
  project: ProjectData;
  rendererId: string;
  node: GraphNode;
  nodeData: unknown | null;
  focusRequest?: GraphIssueFocusRequest | null;
  onSaved: () => void;
}

type NodeEditorMode = "json" | "blocks";

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

const INSERT_BUTTONS: { kind: InsertableKind; label: string }[] = [
  { kind: "narrate", label: "旁白" },
  { kind: "say", label: "台词" },
  { kind: "bg", label: "背景" },
  { kind: "bgm", label: "BGM" },
  { kind: "sfx", label: "音效" },
  { kind: "voice", label: "语音" },
  { kind: "char", label: "角色" },
  { kind: "wait", label: "等待" },
  { kind: "effect", label: "效果" },
  { kind: "transition", label: "转场" },
  { kind: "choice", label: "选择" },
];

export function NodeEditor({ project, rendererId, node, nodeData, focusRequest, onSaved }: NodeEditorProps) {
  const incomingText = useMemo(() => serializeNodeData(nodeData), [nodeData]);
  const [mode, setMode] = useState<NodeEditorMode>("json");
  const [text, setText] = useState(incomingText);
  const [instructions, setInstructions] = useState<Instruction[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [pendingExternalText, setPendingExternalText] = useState<string | null>(null);
  const [hasExternalUpdate, setHasExternalUpdate] = useState(false);
  const [writeConflict, setWriteConflict] = useState(false);
  const [draftCopyPath, setDraftCopyPath] = useState<string | null>(null);
  const loadedTextRef = useRef(incomingText);
  const loadedRevisionRef = useRef(project.nodeRevisions?.[node.file] ?? undefined);
  const blockRefs = useRef<Array<HTMLDivElement | null>>([]);

  const nodeIssues = useMemo(() => {
    const file = `content/${node.file}`;
    return (project.projectReport?.projectIssues ?? [])
      .filter((issue) => issue.source === "node" && (issue.nodeId === node.id || issue.file === file))
      .map((issue) => ({ ...issue, instructionIndex: instructionIndexFromJsonPath(issue.jsonPath) }));
  }, [node.file, node.id, project.projectReport]);

  useEffect(() => {
    const incomingRevision = project.nodeRevisions?.[node.file] ?? undefined;
    if (dirty) {
      if (incomingText !== loadedTextRef.current) {
        setPendingExternalText(incomingText);
        setHasExternalUpdate(true);
      }
      return;
    }
    loadedTextRef.current = incomingText;
    loadedRevisionRef.current = incomingRevision;
    setText(incomingText);
    try {
      const parsed = JSON.parse(incomingText);
      setInstructions(Array.isArray(parsed) ? (parsed as Instruction[]) : []);
    } catch {
      setInstructions([]);
    }
    setPendingExternalText(null);
    setHasExternalUpdate(false);
    setWriteConflict(false);
    setDraftCopyPath(null);
    setStatus("");
  }, [incomingText, dirty, node.file, project.nodeRevisions]);

  const outline = useMemo(() => {
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) return [];
      return summarizeInstructions(parsed as Instruction[]);
    } catch {
      return [];
    }
  }, [text]);

  useEffect(() => {
    if (!focusRequest?.jsonPath) return;
    const index = instructionIndexFromJsonPath(focusRequest.jsonPath);
    if (index == null) return;
    if (mode !== "blocks") {
      setStatus(`节点问题位置：${focusRequest.jsonPath}`);
      return;
    }
    blockRefs.current[index]?.scrollIntoView({ block: "center" });
    setStatus(`已定位到第 ${index + 1} 条指令。`);
  }, [focusRequest, mode]);

  const applyInstructionList = (next: Instruction[]) => {
    setInstructions(next);
    setText(JSON.stringify(next, null, 2));
    setDirty(true);
    setStatus("");
  };

  const handleSave = async () => {
    setSaving(true);
    setStatus("");
    try {
      const payload = mode === "blocks"
        ? JSON.stringify(instructions, null, 2)
        : JSON.stringify(JSON.parse(text), null, 2);
      await saveFile(project.path, `content/${node.file}`, payload, loadedRevisionRef.current);
      loadedTextRef.current = payload;
      loadedRevisionRef.current = undefined;
      setText(payload);
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
    if (writeConflict && pendingExternalText == null && incomingText === loadedTextRef.current) {
      setStatus("正在载入外部版本…");
      void onSaved();
      return;
    }
    const nextText = pendingExternalText ?? incomingText;
    loadedTextRef.current = nextText;
    loadedRevisionRef.current = project.nodeRevisions?.[node.file] ?? undefined;
    setText(nextText);
    try {
      const parsed = JSON.parse(nextText);
      setInstructions(Array.isArray(parsed) ? (parsed as Instruction[]) : []);
    } catch {
      setInstructions([]);
    }
    setDirty(false);
    setPendingExternalText(null);
    setHasExternalUpdate(false);
    setWriteConflict(false);
    setDraftCopyPath(null);
    setStatus("已载入外部更新。");
  };

  const handleSaveDraftCopy = async () => {
    setSaving(true);
    setStatus("");
    try {
      const payload = mode === "blocks"
        ? JSON.stringify(instructions, null, 2)
        : JSON.stringify(JSON.parse(text), null, 2);
      const copyPath = conflictDraftCopyPath(node.file, Date.now());
      await saveFile(project.path, `content/${copyPath}`, payload);
      setDraftCopyPath(copyPath);
      setStatus(`草稿副本已保存: ${copyPath}`);
      onSaved();
    } catch (error) {
      setStatus(`另存为副本失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleInsert = (kind: InsertableKind) => {
    try {
      const base = mode === "blocks" ? instructions : JSON.parse(text);
      if (!Array.isArray(base)) {
        setStatus("插入失败: 节点内容不是 JSON 数组");
        return;
      }
      applyInstructionList(insertInstructionAt(base as Instruction[], base.length, defaultInstruction(kind)));
    } catch (error) {
      setStatus(`插入失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleModeToggle = (nextMode: NodeEditorMode) => {
    if (nextMode === mode) return;
    const next = transitionNodeEditorMode({ mode, text, instructions });
    if (next.error) {
      setStatus(next.error);
      return;
    }
    setMode(next.mode);
    setText(next.text);
    setInstructions(next.instructions);
    setStatus("");
  };

  return (
    <div style={containerStyle}>
      <div style={editorPaneStyle}>
        <div style={toolbarStyle}>
          <div style={titleGroupStyle}>
            <div style={titleStyle}>{node.title}</div>
            <div style={metaStyle}>{node.file}</div>
          </div>
          <div style={toolbarSpacerStyle} />
          <button type="button" onClick={() => handleModeToggle("json")} style={toggleButtonStyle}>JSON</button>
          <button type="button" onClick={() => handleModeToggle("blocks")} style={toggleButtonStyle}>块编辑</button>
          {dirty && <span style={{ ...statusTextStyle, color: "var(--status-warn-text)" }}>未保存</span>}
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
            <span style={{ ...statusTextStyle, color: status.startsWith("保存失败") || status.startsWith("另存为副本失败") ? "var(--status-error-text)" : "var(--status-ok-text)" }}>
              {status}
            </span>
          )}
          {draftCopyPath && <span style={statusTextStyle}>{draftCopyPath}</span>}
          <button type="button" onClick={handleSave} disabled={saving} style={saveButtonStyle}>
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
        <div style={asideStyle}>
          <div style={insertBarStyle}>
            {INSERT_BUTTONS.map((btn) => (
              <button key={btn.kind} type="button" onClick={() => handleInsert(btn.kind)} style={insertBtnStyle}>
                + {btn.label}
              </button>
            ))}
          </div>
          <div style={outlineStyle}>
            <div style={outlineTitleStyle}>大纲（say / narrate / bg / bgm）</div>
            {outline.length === 0 ? (
              <div style={outlineEmptyStyle}>暂无可摘要指令</div>
            ) : (
              outline.map((item) => (
                <button key={`${item.index}-${item.kind}`} type="button" style={outlineItemStyle}>
                  <span style={{ ...outlineKindStyle, ...kindColor(item.kind) }}>{item.kind}</span>
                  <span style={outlineLabelStyle}>{item.label}</span>
                </button>
              ))
            )}
          </div>
        </div>
        {mode === "blocks" ? (
          <div style={blocksStyle}>
            {instructions.map((instruction, index) => (
              <div
                key={`${instruction.t}-${index}`}
                ref={(element) => {
                  blockRefs.current[index] = element;
                }}
              >
                <InstructionBlock
                  index={index}
                  instruction={instruction}
                  manifest={project.content.manifest as EngineManifest}
                  graphNodes={project.graph?.nodes ?? []}
                  issues={nodeIssues.filter((issue) => issue.instructionIndex === index)}
                  onUpdate={(nextInstruction) => {
                    const next = instructions.slice();
                    next[index] = nextInstruction;
                    applyInstructionList(next);
                  }}
                  onDuplicate={() => applyInstructionList(duplicateInstruction(instructions, index))}
                  onDelete={() => applyInstructionList(deleteInstruction(instructions, index))}
                  onMoveUp={() => applyInstructionList(moveInstruction(instructions, index, index - 1))}
                  onMoveDown={() => applyInstructionList(moveInstruction(instructions, index, index + 1))}
                />
              </div>
            ))}
          </div>
        ) : (
          <textarea
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setDirty(true);
            }}
            spellCheck={false}
            style={textareaStyle}
          />
        )}
      </div>
      <div style={previewPaneStyle}>
        <NodePreviewPanel
          key={`${rendererId}:${node.id}`}
          project={project}
          rendererId={rendererId}
          node={node}
          nodeData={nodeData}
        />
      </div>
    </div>
  );
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

const containerStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(360px, 44%)",
  width: "100%",
  height: "100%",
  background: "var(--bg-inset)",
};

const editorPaneStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  borderRight: "1px solid var(--border)",
};

const previewPaneStyle: React.CSSProperties = {
  minWidth: 0,
  background: "var(--bg-app)",
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

const asideStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  borderBottom: "1px solid var(--border)",
  background: "var(--bg-app)",
  maxHeight: 220,
  flexShrink: 0,
};

const insertBarStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
  padding: "8px 12px",
  borderBottom: "1px solid var(--border-subtle)",
};

const insertBtnStyle: React.CSSProperties = {
  padding: "5px 10px",
  borderRadius: 6,
  border: "1px solid var(--border-strong)",
  background: "var(--bg-panel)",
  color: "var(--text-secondary)",
  cursor: "pointer",
  fontSize: 12,
};

const outlineStyle: React.CSSProperties = {
  overflowY: "auto",
  padding: "8px 12px",
};

const outlineTitleStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-muted)",
  textTransform: "uppercase",
  marginBottom: 6,
};

const outlineEmptyStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-dim)",
  padding: "4px 0",
};

const outlineItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  padding: "6px 8px",
  border: "none",
  background: "transparent",
  borderRadius: 6,
  cursor: "pointer",
  textAlign: "left",
};

const outlineKindStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  padding: "2px 6px",
  borderRadius: 4,
  flexShrink: 0,
  textTransform: "uppercase",
};

const outlineLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-primary)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const blocksStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: 16,
  overflowY: "auto",
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

function kindColor(kind: "say" | "narrate" | "bg" | "bgm" | "choice"): React.CSSProperties {
  const map: Record<string, React.CSSProperties> = {
    say: { background: "var(--tag-say-bg)", color: "var(--tag-say-text)" },
    narrate: { background: "var(--tag-narrate-bg)", color: "var(--tag-narrate-text)" },
    bg: { background: "var(--tag-bg-bg)", color: "var(--tag-bg-text)" },
    bgm: { background: "var(--tag-bgm-bg)", color: "var(--tag-bgm-text)" },
    choice: { background: "var(--tag-choice-bg)", color: "var(--tag-choice-text)" },
  };
  return map[kind] ?? {};
}
