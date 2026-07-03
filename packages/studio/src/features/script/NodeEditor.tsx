import { useEffect, useMemo, useRef, useState } from "react";
import type { Instruction } from "@galstudio/engine";
import { saveFile } from "../../lib/tauri";
import type { GraphNode, ProjectData } from "../../lib/types";
import { useRendererComponent } from "../preview/useRendererComponent";
import { useNodePreview } from "./useNodePreview";
import {
  defaultInstruction,
  insertInstructionAt,
  summarizeInstructions,
  type InsertableKind,
} from "./instructions";

interface NodeEditorProps {
  project: ProjectData;
  rendererId: string;
  node: GraphNode;
  nodeData: unknown | null;
  onSaved: () => void;
}

function serializeNodeData(nodeData: unknown | null): string {
  return nodeData == null ? "[]" : JSON.stringify(nodeData, null, 2);
}

/** 在 pretty-printed JSON 数组里定位第 index 个对象起始字符偏移（找不到返回 null）。 */
function matchInstructionStart(jsonText: string, index: number): number | null {
  let count = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < jsonText.length; i += 1) {
    const ch = jsonText[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") {
      if (count === index) return i;
      count += 1;
    }
  }
  return null;
}

const INSERT_BUTTONS: { kind: InsertableKind; label: string }[] = [
  { kind: "narrate", label: "旁白" },
  { kind: "say", label: "台词" },
  { kind: "bg", label: "背景" },
  { kind: "bgm", label: "BGM" },
  { kind: "wait", label: "等待" },
];

export function NodeEditor({ project, rendererId, node, nodeData, onSaved }: NodeEditorProps) {
  const incomingText = useMemo(() => serializeNodeData(nodeData), [nodeData]);
  const [text, setText] = useState(incomingText);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [pendingExternalText, setPendingExternalText] = useState<string | null>(null);
  const [hasExternalUpdate, setHasExternalUpdate] = useState(false);
  const loadedTextRef = useRef(incomingText);

  useEffect(() => {
    if (dirty) {
      if (incomingText !== loadedTextRef.current) {
        setPendingExternalText(incomingText);
        setHasExternalUpdate(true);
      }
      return;
    }

    loadedTextRef.current = incomingText;
    setText(incomingText);
    setPendingExternalText(null);
    setHasExternalUpdate(false);
    setStatus("");
  }, [incomingText, dirty]);

  const handleSave = async () => {
    setSaving(true);
    setStatus("");

    try {
      const parsed = JSON.parse(text);
      const normalizedText = JSON.stringify(parsed, null, 2);
      await saveFile(project.path, `content/${node.file}`, normalizedText);
      loadedTextRef.current = normalizedText;
      setText(normalizedText);
      setDirty(false);
      setPendingExternalText(null);
      setHasExternalUpdate(false);
      setStatus("已保存 ✓");
      onSaved();
    } catch (error) {
      setStatus(`保存失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleLoadExternal = () => {
    const nextText = pendingExternalText ?? incomingText;
    loadedTextRef.current = nextText;
    setText(nextText);
    setDirty(false);
    setPendingExternalText(null);
    setHasExternalUpdate(false);
    setStatus("已载入外部更新。");
  };

  // Phase 10：块级只读大纲（say/narrate/bg/bgm）。text 非法 JSON 时静默返回空。
  const outline = useMemo(() => {
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) return [];
      return summarizeInstructions(parsed as Instruction[]);
    } catch {
      return [];
    }
  }, [text]);

  // Phase 10：插入按钮 —— 解析 text → 插入末尾 → 重新序列化
  const handleInsert = (kind: InsertableKind) => {
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        setStatus("插入失败: 节点内容不是 JSON 数组");
        return;
      }
      const next = insertInstructionAt(parsed as Instruction[], (parsed as Instruction[]).length, defaultInstruction(kind));
      const nextText = JSON.stringify(next, null, 2);
      setText(nextText);
      setDirty(true);
      setStatus("");
    } catch (error) {
      setStatus(`插入失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Phase 10：点击大纲项 → 定位 textarea 到对应指令的 JSON 行
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const handleLocate = (index: number) => {
    const ta = textareaRef.current;
    if (!ta) return;
    // pretty JSON 每条指令占若干行；用正则找第 index 个对象起始位置
    const match = matchInstructionStart(text, index);
    if (match == null) return;
    ta.focus();
    ta.setSelectionRange(match, match);
    // 滚动到选中处
    const lineHeight = 21; // 与 textareaStyle lineHeight 1.6 * 13px ≈ 20.8
    const line = text.slice(0, match).split("\n").length - 1;
    ta.scrollTop = Math.max(0, line * lineHeight - ta.clientHeight / 2);
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
          {dirty && <span style={{ ...statusTextStyle, color: "#e0b676" }}>未保存</span>}
          {hasExternalUpdate && (
            <button type="button" onClick={handleLoadExternal} style={loadButtonStyle}>
              外部已更新，点击载入
            </button>
          )}
          {status && (
            <span style={{ ...statusTextStyle, color: status.startsWith("保存失败") ? "#e0a0a0" : "#7ab38a" }}>
              {status}
            </span>
          )}
          <button type="button" onClick={handleSave} disabled={saving} style={saveButtonStyle}>
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
        {/* Phase 10：插入按钮条 + 只读块级大纲 */}
        <div style={asideStyle}>
          <div style={insertBarStyle}>
            {INSERT_BUTTONS.map((btn) => (
              <button
                key={btn.kind}
                type="button"
                onClick={() => handleInsert(btn.kind)}
                title={`在末尾插入一条${btn.label}指令`}
                style={insertBtnStyle}
              >
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
                <button
                  key={`${item.index}-${item.kind}`}
                  type="button"
                  onClick={() => handleLocate(item.index)}
                  style={outlineItemStyle}
                  title="点击定位到 JSON"
                >
                  <span style={{ ...outlineKindStyle, ...kindColor(item.kind) }}>{item.kind}</span>
                  <span style={outlineLabelStyle}>{item.label}</span>
                </button>
              ))
            )}
          </div>
        </div>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setDirty(true);
            if (!hasExternalUpdate) setStatus("");
          }}
          spellCheck={false}
          style={textareaStyle}
        />
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

interface NodePreviewPanelProps {
  project: ProjectData;
  rendererId: string;
  node: GraphNode;
  nodeData: unknown | null;
}

function NodePreviewPanel({ project, rendererId, node, nodeData }: NodePreviewPanelProps) {
  const player = useNodePreview(project, node, nodeData);
  const { renderer, loadError } = useRendererComponent(project.path, rendererId);

  if (player.error) {
    return <PreviewMessage mono>{`引擎错误：\n\n${player.error}`}</PreviewMessage>;
  }
  if (loadError) {
    return <PreviewMessage mono>{`渲染层加载失败（${rendererId}）：\n\n${loadError}`}</PreviewMessage>;
  }
  if (!renderer) {
    return <PreviewMessage>加载渲染层中…</PreviewMessage>;
  }
  if (nodeData == null) {
    return <PreviewMessage>节点无内容。保存后会在这里预览。</PreviewMessage>;
  }

  const Renderer = renderer.Component;
  return (
    <div style={{ width: "100%", height: "100%" }}>
      <Renderer {...player.rendererProps} />
    </div>
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
      color: "#cdd6e0",
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
  background: "#0b0e14",
};

const editorPaneStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  borderRight: "1px solid #232a38",
};

const previewPaneStyle: React.CSSProperties = {
  minWidth: 0,
  background: "#0e1116",
};

const toolbarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "10px 16px",
  borderBottom: "1px solid #232a38",
  background: "#0e1116",
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
  color: "#e8edf5",
};

const metaStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#7a8290",
  wordBreak: "break-all",
};

const toolbarSpacerStyle: React.CSSProperties = {
  flex: 1,
};

const statusTextStyle: React.CSSProperties = {
  fontSize: 12,
};

const loadButtonStyle: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 6,
  border: "1px solid #3a6ea5",
  background: "#1a2431",
  color: "#9fc8e3",
  cursor: "pointer",
  fontSize: 12,
  flexShrink: 0,
};

const saveButtonStyle: React.CSSProperties = {
  padding: "6px 16px",
  borderRadius: 6,
  border: "1px solid #3a6ea5",
  background: "#3a6ea5",
  color: "#fff",
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
  background: "#0b0e14",
  color: "#d4dae2",
  fontFamily: "ui-monospace, 'SF Mono', monospace",
  fontSize: 13,
  lineHeight: 1.6,
};

// Phase 10 样式
const asideStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  borderBottom: "1px solid #232a38",
  background: "#0e1116",
  maxHeight: 220,
  flexShrink: 0,
};

const insertBarStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
  padding: "8px 12px",
  borderBottom: "1px solid #161b24",
};

const insertBtnStyle: React.CSSProperties = {
  padding: "5px 10px",
  borderRadius: 6,
  border: "1px solid #2a3242",
  background: "#141922",
  color: "#a0a8b4",
  cursor: "pointer",
  fontSize: 12,
};

const outlineStyle: React.CSSProperties = {
  overflowY: "auto",
  padding: "8px 12px",
};

const outlineTitleStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#7a8290",
  textTransform: "uppercase",
  marginBottom: 6,
};

const outlineEmptyStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#596274",
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
  color: "#d4dae2",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

function kindColor(kind: "say" | "narrate" | "bg" | "bgm"): React.CSSProperties {
  const map: Record<string, React.CSSProperties> = {
    say: { background: "#2a3a5a", color: "#9fc8e3" },
    narrate: { background: "#2f4538", color: "#93d3b0" },
    bg: { background: "#3a2f45", color: "#c8a0e0" },
    bgm: { background: "#45382f", color: "#e0b676" },
  };
  return map[kind] ?? {};
}
