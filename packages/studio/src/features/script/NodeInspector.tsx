import { useEffect, useState } from "react";
import { Check, TriangleAlert } from "lucide-react";
import type { GraphEdge, NodeEntry, ProjectGraph } from "../../lib/types";
import { findNode, findNodeData, summarizeNodeConnections } from "./graphMapping";

type BranchMode = "choice" | "auto";

interface NodeInspectorProps {
  graph: ProjectGraph;
  nodeEntries?: NodeEntry[];
  selectedNodeId: string | null;
  onEnter: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onUpdateOutgoingEdges?: (nodeId: string, edges: GraphEdge[]) => void;
  onSetEntry?: (id: string) => void;
  saving?: boolean;
}

export function NodeInspector({
  graph,
  nodeEntries,
  selectedNodeId,
  onEnter,
  onRename,
  onUpdateOutgoingEdges,
  onSetEntry,
  saving = false,
}: NodeInspectorProps) {
  const node = findNode(graph, selectedNodeId);
  const [title, setTitle] = useState(node?.title ?? "");

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
  const outgoingEdges = graph.edges.filter((edge) => edge.from === node.id).map(normalizeEdge);

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
          <div style={{ ...statusTextStyle(hasContent), display: "inline-flex", alignItems: "center", gap: "var(--space-1)" }}>
            {hasContent ? <Check size={14} /> : <TriangleAlert size={14} />}
            {hasContent ? "已有内容" : "文件缺失"}
          </div>
        </section>

        <section style={sectionStyle}>
          <Field label="ID" value={node.id} mono />
          <Field label="文件" value={node.file} mono />
          <Field label="入口" value={isEntry ? "是" : "否"} />
          <Field label="位置" value={`x ${node.position.x} / y ${node.position.y}`} mono />
          <Field label="连接" value={`入 ${incoming} / 出 ${outgoing}`} mono />
        </section>

        <ExitSection
          graph={graph}
          nodeId={node.id}
          edges={outgoingEdges}
          disabled={saving || !onUpdateOutgoingEdges}
          onChange={(edges) => onUpdateOutgoingEdges?.(node.id, edges)}
        />

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

function ExitSection({
  graph,
  nodeId,
  edges,
  disabled,
  onChange,
}: {
  graph: ProjectGraph;
  nodeId: string;
  edges: GraphEdge[];
  disabled: boolean;
  onChange: (edges: GraphEdge[]) => void;
}) {
  if (edges.length === 0) {
    return (
      <section style={sectionStyle}>
        <Field label="出口" value="终点" />
      </section>
    );
  }

  if (edges.length === 1) {
    return (
      <section style={sectionStyle}>
        <Field label="出口" value={`继续到 ${targetTitle(graph, edges[0].to)}`} />
      </section>
    );
  }

  const mode: BranchMode = edges.every((edge) => edge.mode === "auto") ? "auto" : "choice";

  const applyMode = (nextMode: BranchMode) => {
    onChange(edges.map((edge, index) => normalizeBranchEdge(graph, nodeId, edge, index, nextMode)));
  };

  const updateEdge = (edgeId: string, patch: Partial<GraphEdge>) => {
    onChange(edges.map((edge, index) => {
      const normalized = normalizeBranchEdge(graph, nodeId, edge, index, mode);
      return normalized.id === edgeId ? normalizeEdge({ ...normalized, ...patch, mode }) : normalized;
    }));
  };

  return (
    <section style={sectionStyle}>
      <label style={titleFieldStyle}>
        <span style={fieldLabelStyle}>结束方式</span>
        <select
          value={mode}
          onChange={(event) => applyMode(event.target.value as BranchMode)}
          disabled={disabled}
          style={titleInputStyle}
        >
          <option value="choice">玩家选择</option>
          <option value="auto">自动判断</option>
        </select>
      </label>

      <div style={exitListStyle}>
        {edges.map((edge) => (
          <div key={edge.id} style={exitRowStyle}>
            <div style={fieldValueStyle}>{targetTitle(graph, edge.to)}</div>
            {mode === "choice" ? (
              <input
                value={edge.label ?? targetTitle(graph, edge.to)}
                onChange={(event) => updateEdge(edge.id, { mode: "choice", label: event.target.value, condition: null })}
                disabled={disabled}
                placeholder="选项文本"
                style={compactInputStyle}
              />
            ) : (
              <input
                value={edge.condition ?? ""}
                onChange={(event) => updateEdge(edge.id, { mode: "auto", label: null, condition: event.target.value || null })}
                disabled={disabled}
                placeholder="条件；留空为默认"
                style={compactInputStyle}
              />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function normalizeBranchEdge(
  graph: ProjectGraph,
  from: string,
  edge: GraphEdge,
  index: number,
  mode: BranchMode,
): GraphEdge {
  return {
    ...normalizeEdge(edge),
    from,
    mode,
    label: mode === "choice" ? edge.label?.trim() || targetTitle(graph, edge.to) || `选项 ${index + 1}` : null,
    condition: mode === "auto" ? edge.condition ?? null : null,
  };
}

function normalizeEdge(edge: GraphEdge): GraphEdge {
  return {
    ...edge,
    mode: edge.mode ?? "linear",
    label: edge.label ?? null,
    condition: edge.condition ?? null,
  };
}

function targetTitle(graph: ProjectGraph, nodeId: string): string {
  return graph.nodes.find((node) => node.id === nodeId)?.title || nodeId || "未选择";
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
  background: "var(--bg-app)",
};

const panelTitleStyle: React.CSSProperties = {
  padding: "var(--space-3) var(--space-4)",
  borderBottom: "1px solid var(--border)",
  fontSize: "var(--text-base)",
  fontWeight: 600,
  color: "var(--text-primary)",
};

const contentStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-4)",
  padding: "var(--space-4)",
  overflowY: "auto",
};

const sectionStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
  padding: "var(--space-3)",
  borderRadius: "var(--radius-md)",
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
};

const titleFieldStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
};

const titleInputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "var(--space-2) var(--space-2)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-input)",
  background: "var(--bg-inset)",
  color: "var(--text-bright)",
  fontSize: "var(--text-md)",
  fontWeight: 600,
  outline: "none",
};

const fieldRowStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-1)",
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: "var(--text-xs)",
  color: "var(--text-muted)",
  textTransform: "uppercase",
};

const fieldValueStyle: React.CSSProperties = {
  fontSize: "var(--text-base)",
  color: "var(--text-primary)",
  wordBreak: "break-all",
};

const actionButtonStyle: React.CSSProperties = {
  padding: "var(--space-2) var(--space-3)",
  borderRadius: "var(--radius-md)",
  background: "var(--accent)",
  border: "1px solid var(--accent)",
  color: "var(--text-on-accent)",
  cursor: "pointer",
  fontSize: "var(--text-base)",
  fontWeight: 600,
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: "var(--space-2) var(--space-3)",
  borderRadius: "var(--radius-md)",
  background: "var(--bg-active)",
  border: "1px solid var(--accent)",
  color: "var(--accent-bright)",
  cursor: "pointer",
  fontSize: "var(--text-base)",
  fontWeight: 600,
};

const exitListStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
};

const exitRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(72px, 0.8fr) minmax(0, 1fr)",
  gap: "var(--space-2)",
  alignItems: "center",
};

const compactInputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "var(--space-2) var(--space-2)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-input)",
  background: "var(--bg-inset)",
  color: "var(--text-primary)",
  fontSize: "var(--text-base)",
  outline: "none",
};

const emptyStyle: React.CSSProperties = {
  padding: "var(--space-4)",
  color: "var(--text-muted)",
  fontSize: "var(--text-base)",
};

const statusTextStyle = (hasContent: boolean): React.CSSProperties => ({
  fontSize: "var(--text-base)",
  color: hasContent ? "var(--status-ok-text)" : "var(--status-warn-text)",
});
