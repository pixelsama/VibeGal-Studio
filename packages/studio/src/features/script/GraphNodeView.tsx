import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { NODE_TYPE } from "./graphMapping";

export interface GraphCanvasNodeData extends Record<string, unknown> {
  title: string;
  fileId: string;
  isEntry: boolean;
  hasContent: boolean;
  duplicateNodeId?: boolean;
}

type GraphNodeViewNode = Node<GraphCanvasNodeData, typeof NODE_TYPE>;

export function GraphNodeView({ data, selected }: NodeProps<GraphNodeViewNode>) {
  return (
    <div
      style={{
        ...nodeStyle,
        borderColor: data.duplicateNodeId ? "#d66a6a" : selected ? "#9fc8e3" : "#232a38",
        boxShadow: data.duplicateNodeId
          ? "0 0 0 1px rgba(214, 106, 106, 0.25), 0 8px 18px rgba(0, 0, 0, 0.24)"
          : selected ? "0 0 0 1px rgba(159, 200, 227, 0.2), 0 8px 18px rgba(0, 0, 0, 0.24)" : "none",
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
        <span style={{ ...statusDotStyle, background: data.duplicateNodeId ? "#d66a6a" : data.hasContent ? "#4caf7a" : "#d49b4d" }} />
        <span style={{ color: data.duplicateNodeId ? "#e0a0a0" : data.hasContent ? "#93d3b0" : "#e0b676" }}>
          {data.duplicateNodeId ? "ID 重复" : data.hasContent ? "已有内容" : "文件缺失"}
        </span>
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

const hiddenHandleStyle = {
  width: 8,
  height: 8,
  opacity: 0,
  background: "transparent",
  border: "none",
};
