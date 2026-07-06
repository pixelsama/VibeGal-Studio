import type { CSSProperties } from "react";
import type { GraphEdge, GraphNode } from "../../lib/types";

export type NodeExitMode = "end" | "linear" | "choice" | "auto";
type BranchExitMode = Extract<NodeExitMode, "choice" | "auto">;

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
  if (mode === "linear" && edges.length !== 1) issues.push("普通继续只能有一条出口。");
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
  const firstTargetId = targets[0]?.id ?? "";
  const branchMode = mode === "choice" || mode === "auto" ? mode : null;

  const connectLinear = () => {
    onChange([makeEdge(node.id, edges[0]?.to || firstTargetId, "linear")]);
  };

  const setBranchMode = (nextMode: BranchExitMode) => {
    onChange(branchEdges(nextMode));
  };

  const resetToLinear = () => {
    onChange([makeEdge(node.id, edges[0]?.to || firstTargetId, "linear")]);
  };

  const updateEdge = (index: number, patch: Partial<GraphEdge>) => {
    onChange(edges.map((edge, current) => (current === index ? { ...edge, ...patch } : edge)));
  };

  const addBranchEdge = () => {
    const nextMode = branchMode ?? "choice";
    onChange([
      ...edges,
      makeEdge(node.id, firstTargetId, nextMode, nextMode === "choice" ? `选项 ${edges.length + 1}` : null),
    ]);
  };

  const branchEdges = (nextMode: BranchExitMode) => {
    const sourceEdges = edges.length > 0
      ? edges
      : [
          makeEdge(node.id, firstTargetId, "linear"),
          makeEdge(node.id, targets[1]?.id ?? firstTargetId, "linear"),
        ];
    const paddedEdges = sourceEdges.length > 1 || nextMode === "auto"
      ? sourceEdges
      : [...sourceEdges, makeEdge(node.id, targets[1]?.id ?? firstTargetId, "linear")];
    return paddedEdges.map((edge, index) => makeEdge(
      node.id,
      edge.to || targets[index]?.id || firstTargetId,
      nextMode,
      nextMode === "choice" ? edge.label?.trim() || `选项 ${index + 1}` : null,
      nextMode === "auto" ? edge.condition ?? null : null,
    ));
  };

  return (
    <section style={panelStyle}>
      <div style={branchMode ? headerWithBranchStyle : headerStyle}>
        <div>
          <div style={titleStyle}>节点出口</div>
          <div style={hintStyle}>节点播放完后，由流程图出口决定是否进入下一个节点。</div>
        </div>
        {branchMode && (
          <label style={branchTypeStyle}>
            <span style={fieldLabelStyle}>出口类型</span>
            <select
              value={branchMode}
              onChange={(event) => setBranchMode(event.target.value as BranchExitMode)}
              style={selectStyle}
            >
              <option value="choice">玩家选择</option>
              <option value="auto">自动判定</option>
            </select>
          </label>
        )}
      </div>

      {mode === "end" && (
        <div style={emptyStateStyle}>
          <div>
            <div style={stateTitleStyle}>节点在此结束</div>
            <div style={hintStyle}>没有从这个节点连出的流程线时，播放会自然停在这里。</div>
          </div>
          <div style={actionRowStyle}>
            <button type="button" onClick={connectLinear} style={miniButtonStyle} disabled={!firstTargetId}>
              连接下一个节点
            </button>
            <button type="button" onClick={() => setBranchMode("choice")} style={miniButtonStyle} disabled={!firstTargetId}>
              添加玩家选择
            </button>
            <button type="button" onClick={() => setBranchMode("auto")} style={miniButtonStyle} disabled={!firstTargetId}>
              添加自动判定
            </button>
          </div>
        </div>
      )}

      {mode === "linear" && (
        <div style={edgeListStyle}>
          {edges.map((edge, index) => (
            <div key={`${edge.id || "edge"}-${index}`} style={linearRowStyle}>
              <span style={fieldLabelStyle}>{index === 0 ? "继续到" : "多余出口"}</span>
              <select value={edge.to} onChange={(event) => updateEdge(index, { to: event.target.value })} style={selectStyle}>
                <option value="">选择目标节点</option>
                {edge.to && !graphNodes.some((item) => item.id === edge.to) && (
                  <option value={edge.to}>{`缺失：${edge.to}`}</option>
                )}
                {targets.map((target) => (
                  <option key={target.id} value={target.id}>{target.title || target.id}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => onChange(edges.filter((_, current) => current !== index))}
                style={miniButtonStyle}
              >
                删除连接
              </button>
            </div>
          ))}
          <div style={actionRowStyle}>
            <button type="button" onClick={() => setBranchMode("choice")} style={miniButtonStyle}>
              改为玩家选择
            </button>
            <button type="button" onClick={() => setBranchMode("auto")} style={miniButtonStyle}>
              改为自动判定
            </button>
          </div>
        </div>
      )}

      {branchMode && (
        <div style={edgeListStyle}>
          {edges.map((edge, index) => (
            <div key={`${edge.id || "edge"}-${index}`} style={edgeRowStyle}>
              {branchMode === "choice" && (
                <input
                  value={edge.label ?? ""}
                  onChange={(event) => updateEdge(index, { label: event.target.value })}
                  placeholder="选项文本"
                  style={inputStyle}
                />
              )}
              {branchMode === "auto" && (
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
              <button
                type="button"
                onClick={() => onChange(edges.filter((_, current) => current !== index))}
                style={miniButtonStyle}
              >
                删除
              </button>
            </div>
          ))}
          <div style={actionRowStyle}>
            <button type="button" onClick={addBranchEdge} style={addButtonStyle}>
              添加出口
            </button>
            <button type="button" onClick={resetToLinear} style={miniButtonStyle} disabled={!firstTargetId}>
              改为普通继续
            </button>
          </div>
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
  gap: 12,
  alignItems: "center",
};

const headerWithBranchStyle: CSSProperties = {
  ...headerStyle,
  gridTemplateColumns: "minmax(0, 1fr) minmax(150px, 190px)",
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

const emptyStateStyle: CSSProperties = {
  display: "grid",
  gap: 10,
};

const stateTitleStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "var(--text-primary)",
};

const actionRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  alignItems: "center",
};

const branchTypeStyle: CSSProperties = {
  display: "grid",
  gap: 4,
};

const fieldLabelStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--text-muted)",
};

const edgeRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(140px, 1fr) minmax(150px, 1fr) auto",
  gap: 8,
  alignItems: "center",
};

const linearRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "72px minmax(150px, 1fr) auto",
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
