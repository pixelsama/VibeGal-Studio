import { useEffect, useMemo, useRef, useState } from "react";
import { saveFile } from "../../lib/tauri";
import type { GraphNode, ProjectData } from "../../lib/types";
import { useRendererComponent } from "../preview/useRendererComponent";
import { useNodePreview } from "./useNodePreview";

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
        <textarea
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
