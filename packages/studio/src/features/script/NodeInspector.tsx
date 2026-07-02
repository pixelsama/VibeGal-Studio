import type { NodeEntry, ProjectGraph } from "../../lib/types";
import { findNode, findNodeData } from "./graphMapping";

interface NodeInspectorProps {
  graph: ProjectGraph;
  nodeEntries?: NodeEntry[];
  selectedNodeId: string | null;
  onEnter: (id: string) => void;
}

export function NodeInspector({ graph, nodeEntries, selectedNodeId, onEnter }: NodeInspectorProps) {
  const node = findNode(graph, selectedNodeId);

  if (!node) {
    return (
      <div style={panelStyle}>
        <div style={panelTitleStyle}>Inspector</div>
        <div style={emptyStyle}>选择一个节点查看属性</div>
      </div>
    );
  }

  const hasContent = findNodeData(nodeEntries, node.file) != null;

  return (
    <div style={panelStyle}>
      <div style={panelTitleStyle}>Inspector</div>
      <div style={contentStyle}>
        <section style={sectionStyle}>
          <div style={nodeTitleStyle}>{node.title}</div>
          <div style={statusTextStyle(hasContent)}>{hasContent ? "✓ 已有内容" : "⚠ 文件缺失"}</div>
          {graph.synthetic && <div style={hintStyle}>合成图，当前尚未落盘。</div>}
        </section>

        <section style={sectionStyle}>
          <Field label="ID" value={node.id} mono />
          <Field label="文件" value={node.file} mono />
          <Field label="入口" value={node.id === graph.entryNodeId ? "是" : "否"} />
          <Field label="位置" value={`x ${node.position.x} / y ${node.position.y}`} mono />
        </section>

        <button type="button" onClick={() => onEnter(node.id)} style={actionButtonStyle}>
          进入编辑
        </button>
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

const nodeTitleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
  color: "#e8edf5",
};

const hintStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#7a8290",
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

const emptyStyle: React.CSSProperties = {
  padding: 16,
  color: "#7a8290",
  fontSize: 13,
};

const statusTextStyle = (hasContent: boolean): React.CSSProperties => ({
  fontSize: 13,
  color: hasContent ? "#93d3b0" : "#e0b676",
});
