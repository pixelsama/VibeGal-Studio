import { useEffect, useState } from "react";
import type { NodeEntry, ProjectGraph } from "../../lib/types";
import { findNode, findNodeData, summarizeNodeConnections } from "./graphMapping";

interface NodeInspectorProps {
  graph: ProjectGraph;
  nodeEntries?: NodeEntry[];
  selectedNodeId: string | null;
  onEnter: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onSetEntry?: (id: string) => void;
  saving?: boolean;
}

export function NodeInspector({
  graph,
  nodeEntries,
  selectedNodeId,
  onEnter,
  onRename,
  onSetEntry,
  saving = false,
}: NodeInspectorProps) {
  const node = findNode(graph, selectedNodeId);
  const [title, setTitle] = useState("");

  useEffect(() => {
    setTitle(node?.title ?? "");
  }, [node?.id, node?.title]);

  if (!node) {
    return (
      <div style={panelStyle}>
        <div style={panelTitleStyle}>Inspector</div>
        <div style={emptyStyle}>选择一个节点查看属性</div>
      </div>
    );
  }

  const hasContent = findNodeData(nodeEntries, node.file) != null;
  const { incoming, outgoing } = summarizeNodeConnections(graph, node.id);
  const isEntry = node.id === graph.entryNodeId;

  return (
    <div style={panelStyle}>
      <div style={panelTitleStyle}>Inspector</div>
      <div style={contentStyle}>
        <section style={sectionStyle}>
          <label style={titleFieldStyle}>
            <span style={fieldLabelStyle}>标题</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={() => {
                const nextTitle = title.trim();
                if (nextTitle && nextTitle !== node.title) onRename(node.id, nextTitle);
                else setTitle(node.title);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
              style={titleInputStyle}
            />
          </label>
          <div style={statusTextStyle(hasContent)}>{hasContent ? "✓ 已有内容" : "⚠ 文件缺失"}</div>
        </section>

        <section style={sectionStyle}>
          <Field label="ID" value={node.id} mono />
          <Field label="文件" value={node.file} mono />
          <Field label="入口" value={isEntry ? "是" : "否"} />
          <Field label="位置" value={`x ${node.position.x} / y ${node.position.y}`} mono />
          <Field label="连接" value={`入 ${incoming} / 出 ${outgoing}`} mono />
        </section>

        <button type="button" onClick={() => onEnter(node.id)} style={actionButtonStyle}>
          进入编辑
        </button>
        {!isEntry && onSetEntry && (
          <button type="button" onClick={() => onSetEntry(node.id)} disabled={saving} style={secondaryButtonStyle}>
            设为入口节点
          </button>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={fieldRowStyle}>
      <div style={fieldLabelStyle}>{label}</div>
      <div style={{ ...fieldValueStyle, fontFamily: mono ? "ui-monospace, SFMono-Regular, Menlo, monospace" : undefined }}>
        {value}
      </div>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  background: "#0e1116",
};

const panelTitleStyle: React.CSSProperties = {
  padding: "14px 16px",
  borderBottom: "1px solid #232a38",
  fontSize: 13,
  fontWeight: 600,
  color: "#d4dae2",
};

const contentStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
  padding: 16,
  overflowY: "auto",
};

const sectionStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: 14,
  borderRadius: 8,
  background: "#141922",
  border: "1px solid #232a38",
};

const titleFieldStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const titleInputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid #2f394a",
  background: "#0b0e14",
  color: "#e8edf5",
  fontSize: 14,
  fontWeight: 600,
  outline: "none",
};

const fieldRowStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#7a8290",
  textTransform: "uppercase",
};

const fieldValueStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#d4dae2",
  wordBreak: "break-all",
};

const actionButtonStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 8,
  background: "#3a6ea5",
  border: "1px solid #3a6ea5",
  color: "#fff",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 8,
  background: "#1a2431",
  border: "1px solid #3a6ea5",
  color: "#9fc8e3",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};

const emptyStyle: React.CSSProperties = {
  padding: 16,
  color: "#7a8290",
  fontSize: 13,
};

const statusTextStyle = (hasContent: boolean): React.CSSProperties => ({
  fontSize: 13,
  color: hasContent ? "#93d3b0" : "#e0b676",
});
