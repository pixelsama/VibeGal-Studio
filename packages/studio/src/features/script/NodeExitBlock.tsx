import type { CSSProperties } from "react";
import type { GraphEdge, GraphNode } from "../../lib/types";

export type NodeExitMode = "end" | "linear" | "choice" | "auto";

export function inferExitMode(edges: GraphEdge[]): NodeExitMode {
  if (edges.length === 0) return "end";
  return edges[0].mode ?? "linear";
}

export function validateNodeExits(edges: GraphEdge[]): string[] {
  const mode = inferExitMode(edges);
  const issues: string[] = [];
  if (mode === "end") return issues;
  if (edges.some((edge) => !edge.to.trim())) issues.push("每条出口都需要目标节点。");
  if (edges.some((edge) => (edge.mode ?? "linear") !== mode)) issues.push("同一节点不能混用不同出口模式。");
  if (mode === "linear" && edges.length !== 1) issues.push("线性继续只能有一条出口。");
  if (mode === "choice") {
    if (edges.length === 0) issues.push("玩家选择至少需要一个选项。");
    if (edges.some((edge) => !edge.label?.trim())) issues.push("玩家选择出口需要选项文本。");
  }
  if (mode === "auto") {
    const defaultEdges = edges.filter((edge) => !edge.condition?.trim());
    if (defaultEdges.length > 1) issues.push("自动判定最多只能有一条无条件默认出口。");
  }
  return issues;
}

export function NodeExitBlock({
  node,
  graphNodes,
  edges,
  issues,
  onChange,
}: {
  node: GraphNode;
  graphNodes: GraphNode[];
  edges: GraphEdge[];
  issues: string[];
  onChange: (edges: GraphEdge[]) => void;
}) {
  const mode = inferExitMode(edges);
  const targets = graphNodes.filter((item) => item.id !== node.id);

  const setMode = (nextMode: NodeExitMode) => {
    if (nextMode === "end") {
      onChange([]);
      return;
    }
    if (nextMode === "linear") {
      onChange([makeEdge(node.id, targets[0]?.id ?? "", "linear")]);
      return;
    }
    if (nextMode === "choice") {
      onChange([
        makeEdge(node.id, targets[0]?.id ?? "", "choice", "选项 1"),
        makeEdge(node.id, targets[1]?.id ?? targets[0]?.id ?? "", "choice", "选项 2"),
      ]);
      return;
    }
    onChange([makeEdge(node.id, targets[0]?.id ?? "", "auto", null, null)]);
  };

  const updateEdge = (index: number, patch: Partial<GraphEdge>) => {
    onChange(edges.map((edge, current) => (current === index ? { ...edge, ...patch } : edge)));
  };

  const addEdge = () => {
    const nextMode = mode === "end" ? "choice" : mode;
    onChange([
      ...edges,
      makeEdge(node.id, targets[0]?.id ?? "", nextMode === "linear" ? "choice" : nextMode, nextMode === "auto" ? null : "选项"),
    ]);
  };

  return (
    <section style={panelStyle}>
      <div style={headerStyle}>
        <div>
          <div style={titleStyle}>节点出口</div>
          <div style={hintStyle}>节点播放完后，根据这里的出口进入下一个节点。</div>
        </div>
        <select value={mode} onChange={(event) => setMode(event.target.value as NodeExitMode)} style={selectStyle}>
          <option value="end">结束</option>
          <option value="linear">线性继续</option>
          <option value="choice">玩家选择</option>
          <option value="auto">自动判定</option>
        </select>
      </div>

      {mode !== "end" && (
        <div style={edgeListStyle}>
          {edges.map((edge, index) => (
            <div key={`${edge.id || "edge"}-${index}`} style={edgeRowStyle}>
              {mode === "choice" && (
                <input
                  value={edge.label ?? ""}
                  onChange={(event) => updateEdge(index, { label: event.target.value })}
                  placeholder="选项文本"
                  style={inputStyle}
                />
              )}
              {mode === "auto" && (
                <input
                  value={edge.condition ?? ""}
                  onChange={(event) => updateEdge(index, { condition: event.target.value || null })}
                  placeholder="条件；留空作为默认出口"
                  style={inputStyle}
                />
              )}
              <select value={edge.to} onChange={(event) => updateEdge(index, { to: event.target.value })} style={selectStyle}>
                <option value="">选择目标节点</option>
                {edge.to && !graphNodes.some((item) => item.id === edge.to) && (
                  <option value={edge.to}>{`缺失：${edge.to}`}</option>
                )}
                {targets.map((target) => (
                  <option key={target.id} value={target.id}>{target.title || target.id}</option>
                ))}
              </select>
              {mode !== "linear" && (
                <button
                  type="button"
                  onClick={() => onChange(edges.filter((_, current) => current !== index))}
                  style={miniButtonStyle}
                >
                  删除
                </button>
              )}
            </div>
          ))}
          {mode !== "linear" && (
            <button type="button" onClick={addEdge} style={addButtonStyle}>
              添加出口
            </button>
          )}
        </div>
      )}

      {issues.length > 0 && (
        <div style={issueListStyle}>
          {issues.map((issue) => (
            <div key={issue} style={issueStyle}>{issue}</div>
          ))}
        </div>
      )}
    </section>
  );
}

function makeEdge(
  from: string,
  to: string,
  mode: Exclude<NodeExitMode, "end">,
  label: string | null = null,
  condition: string | null = null,
): GraphEdge {
  return {
    id: to ? `${from}__${to}` : "",
    from,
    to,
    mode,
    label,
    condition,
  };
}

const panelStyle: CSSProperties = {
  display: "grid",
  gap: 12,
  padding: 16,
  borderTop: "1px solid var(--border)",
  background: "var(--bg-app)",
};

const headerStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 160px",
  gap: 12,
  alignItems: "center",
};

const titleStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: "var(--text-bright)",
};

const hintStyle: CSSProperties = {
  marginTop: 4,
  fontSize: 12,
  color: "var(--text-muted)",
};

const edgeListStyle: CSSProperties = {
  display: "grid",
  gap: 8,
};

const edgeRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(140px, 1fr) minmax(150px, 1fr) auto",
  gap: 8,
  alignItems: "center",
};

const inputStyle: CSSProperties = {
  minWidth: 0,
  padding: "7px 9px",
  borderRadius: 6,
  border: "1px solid var(--border-input)",
  background: "var(--bg-inset)",
  color: "var(--text-primary)",
  fontSize: 13,
};

const selectStyle: CSSProperties = {
  ...inputStyle,
};

const miniButtonStyle: CSSProperties = {
  padding: "7px 10px",
  borderRadius: 6,
  border: "1px solid var(--border-input)",
  background: "var(--bg-panel)",
  color: "var(--text-secondary)",
  cursor: "pointer",
  fontSize: 12,
};

const addButtonStyle: CSSProperties = {
  ...miniButtonStyle,
  justifySelf: "start",
};

const issueListStyle: CSSProperties = {
  display: "grid",
  gap: 4,
};

const issueStyle: CSSProperties = {
  color: "var(--status-error-text)",
  fontSize: 12,
};
