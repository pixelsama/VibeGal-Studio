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
  duplicate: { dot: "var(--status-error)", text: "var(--status-error-text)", border: "var(--status-error)", label: "ID 重复" },
  "missing-file": { dot: "var(--status-error)", text: "var(--status-error-text)", border: "var(--status-warn)", label: "文件缺失" },
  entry: { dot: "var(--accent)", text: "var(--accent-bright)", border: "var(--accent)", label: "起点" },
  orphan: { dot: "var(--status-warn)", text: "var(--status-warn-text)", border: "var(--border-warn)", label: "未连接" },
  ending: { dot: "var(--status-ok)", text: "var(--status-ok-text)", border: "var(--border-ok)", label: "终点" },
  branch: { dot: "var(--status-warn)", text: "var(--status-warn-text)", border: "var(--border-warn)", label: "分支" },
  normal: { dot: "var(--status-ok)", text: "var(--status-ok-text)", border: "var(--border)", label: "已有内容" },
};

export function GraphNodeView({ data, selected }: NodeProps<GraphNodeViewNode>) {
  const status = STATUS_STYLE[data.status];
  const accent = selected ? "var(--accent-bright)" : status.border;

  return (
    <div
      className="gs-graph-node"
      style={{
        ...nodeStyle,
        borderColor: accent,
        boxShadow: selected
          ? "0 0 0 1px var(--accent-halo), 0 8px 18px var(--overlay)"
          : "none",
      }}
    >
      <Handle type="target" position={Position.Left} style={connectionHandleStyle} />
      <Handle type="source" position={Position.Right} style={connectionHandleStyle} />

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
  padding: "14px var(--space-4)",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border)",
  background: "var(--bg-panel)",
  color: "var(--text-primary)",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
};

const entryBadgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 20,
  height: 20,
  borderRadius: "var(--radius-pill)",
  background: "var(--accent)",
  color: "var(--text-on-accent)",
  fontSize: "var(--text-xs)",
  fontWeight: 700,
  flexShrink: 0,
};

const titleStyle: React.CSSProperties = {
  fontSize: "var(--text-md)",
  fontWeight: 600,
  color: "var(--text-bright)",
};

const metaStyle: React.CSSProperties = {
  marginTop: "var(--space-2)",
  fontSize: "var(--text-xs)",
  color: "var(--text-muted)",
  wordBreak: "break-all",
};

const statusRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  marginTop: "var(--space-3)",
  fontSize: "var(--text-sm)",
};

const statusDotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: "var(--radius-pill)",
  flexShrink: 0,
};

const connStyle: React.CSSProperties = {
  color: "var(--text-muted)",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: "var(--text-xs)",
};

const connectionHandleStyle: React.CSSProperties = {
  width: 9,
  height: 9,
  background: "var(--bg-app)",
  border: "1px solid var(--accent)",
  boxShadow: "0 0 0 2px var(--accent-glow)",
};
