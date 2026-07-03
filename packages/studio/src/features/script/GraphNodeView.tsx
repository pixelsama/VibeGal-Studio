import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { NODE_TYPE, type GraphNodeStatus } from "./graphMapping";

export interface GraphCanvasNodeData extends Record<string, unknown> {
  title: string;
  fileId: string;
  isEntry: boolean;
  status: GraphNodeStatus;
  incoming: number;
  outgoing: number;
  duplicateNodeId?: boolean;
  hasContent?: boolean;
}

type GraphNodeViewNode = Node<GraphCanvasNodeData, typeof NODE_TYPE>;

/** 状态 → 颜色 / 文案。颜色语义对齐 plan：红=缺文件/重复，绿=正常/终点，黄=分支/孤立/警告，蓝=入口。 */
const STATUS_STYLE: Record<GraphNodeStatus, { dot: string; text: string; border: string; label: string }> = {
  duplicate: { dot: "#d66a6a", text: "#e0a0a0", border: "#d66a6a", label: "ID 重复" },
  "missing-file": { dot: "#d66a6a", text: "#e0a0a0", border: "#d49b4d", label: "文件缺失" },
  entry: { dot: "#3a6ea5", text: "#9fc8e3", border: "#3a6ea5", label: "起点" },
  orphan: { dot: "#d49b4d", text: "#e0b676", border: "#594823", label: "未连接" },
  ending: { dot: "#4caf7a", text: "#93d3b0", border: "#2f5942", label: "终点" },
  branch: { dot: "#d49b4d", text: "#e0b676", border: "#594823", label: "分支" },
  normal: { dot: "#4caf7a", text: "#93d3b0", border: "#232a38", label: "已有内容" },
};

export function GraphNodeView({ data, selected }: NodeProps<GraphNodeViewNode>) {
  const status = STATUS_STYLE[data.status];
  const accent = selected ? "#9fc8e3" : status.border;

  return (
    <div
      style={{
        ...nodeStyle,
        borderColor: accent,
        boxShadow: selected
          ? "0 0 0 1px rgba(159, 200, 227, 0.2), 0 8px 18px rgba(0, 0, 0, 0.24)"
          : "none",
      }}
    >
      <Handle type="target" position={Position.Left} style={hiddenHandleStyle} />
      <Handle type="source" position={Position.Right} style={hiddenHandleStyle} />

      <div style={headerStyle}>
        {data.isEntry && <span style={entryBadgeStyle}>起</span>}
        <span style={titleStyle}>{data.title}</span>
      </div>
      <div style={metaStyle}>{data.fileId}</div>
      <div style={statusRowStyle}>
        <span style={{ ...statusDotStyle, background: status.dot }} />
        <span style={{ color: status.text }}>{status.label}</span>
        <span style={{ flex: 1 }} />
        <span style={connStyle}>↑{data.incoming} ↓{data.outgoing}</span>
      </div>
    </div>
  );
}

const nodeStyle: React.CSSProperties = {
  minWidth: 220,
  maxWidth: 260,
  padding: "14px 16px",
  borderRadius: 8,
  border: "1px solid #232a38",
  background: "#141922",
  color: "#d4dae2",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const entryBadgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 20,
  height: 20,
  borderRadius: 999,
  background: "#3a6ea5",
  color: "#f5f8fc",
  fontSize: 11,
  fontWeight: 700,
  flexShrink: 0,
};

const titleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: "#e8edf5",
};

const metaStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 11,
  color: "#7a8290",
  wordBreak: "break-all",
};

const statusRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginTop: 12,
  fontSize: 12,
};

const statusDotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 999,
  flexShrink: 0,
};

const connStyle: React.CSSProperties = {
  color: "#7a8290",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 11,
};

const hiddenHandleStyle = {
  width: 8,
  height: 8,
  opacity: 0,
  background: "transparent",
  border: "none",
};
