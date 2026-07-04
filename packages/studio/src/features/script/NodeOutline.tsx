import { useMemo } from "react";
import type { NodeEntry, ProjectGraph } from "../../lib/types";
import { findNodeData } from "./graphMapping";

interface NodeOutlineProps {
  graph: ProjectGraph;
  nodeEntries?: NodeEntry[];
  selectedNodeId: string | null;
  onSelect: (id: string) => void;
}

export function NodeOutline({ graph, nodeEntries, selectedNodeId, onSelect }: NodeOutlineProps) {
  const orderedNodes = useMemo(() => {
    const entry = graph.nodes.find((node) => node.id === graph.entryNodeId);
    const rest = graph.nodes.filter((node) => node.id !== graph.entryNodeId);
    return entry ? [entry, ...rest] : rest;
  }, [graph.entryNodeId, graph.nodes]);

  return (
    <div style={panelStyle}>
      <div style={listStyle}>
        {orderedNodes.length === 0 ? (
          <div style={emptyStyle}>暂无节点</div>
        ) : (
          orderedNodes.map((node) => {
            const hasContent = findNodeData(nodeEntries, node.file) != null;
            const active = node.id === selectedNodeId;

            return (
              <button
                key={node.id}
                type="button"
                onClick={() => onSelect(node.id)}
                style={{
                  ...itemStyle,
                  borderColor: active ? "var(--accent)" : "var(--border)",
                  background: active ? "var(--bg-active)" : "var(--bg-panel)",
                }}
              >
                <div style={itemHeaderStyle}>
                  <span style={itemTitleStyle}>{node.title}</span>
                  {node.id === graph.entryNodeId && <span style={entryBadgeStyle}>起点</span>}
                </div>
                <div style={itemMetaStyle}>{node.file}</div>
                <div style={statusRowStyle}>
                  <span style={{ ...statusDotStyle, background: hasContent ? "var(--status-ok)" : "var(--status-warn)" }} />
                  <span style={{ color: hasContent ? "var(--status-ok-text)" : "var(--status-warn-text)" }}>
                    {hasContent ? "已有内容" : "文件缺失"}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  background: "transparent",
};

const listStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: 12,
  overflowY: "auto",
};

const itemStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  gap: 8,
  padding: 12,
  borderRadius: 8,
  border: "1px solid var(--border)",
  cursor: "pointer",
  color: "var(--text-primary)",
  textAlign: "left",
};

const itemHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
};

const itemTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "var(--text-bright)",
};

const entryBadgeStyle: React.CSSProperties = {
  padding: "2px 8px",
  borderRadius: 999,
  background: "var(--bg-accent-soft)",
  color: "var(--accent-bright)",
  fontSize: 11,
  flexShrink: 0,
};

const itemMetaStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-muted)",
  wordBreak: "break-all",
};

const statusRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 12,
};

const statusDotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 999,
  flexShrink: 0,
};

const emptyStyle: React.CSSProperties = {
  padding: "8px 4px",
  color: "var(--text-muted)",
  fontSize: 13,
};
