import { useEffect, useState } from "react";
import { Check, TriangleAlert } from "lucide-react";
import type { GraphEdge, Manifest, NodeEntry, ProjectGraph } from "../../lib/types";
import { findNode, findNodeData, summarizeNodeConnections } from "./graphMapping";
import { collectConditionVariables, parseGraphCondition } from "./graphCondition";
import { evaluateGraphConditionResult, type VariableRegistry } from "@vibegal/engine";
import { ConditionBuilder } from "./ConditionBuilder";

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
  variables?: VariableRegistry;
  manifest?: Manifest;
  onRegisterEnding?: (nodeId: string) => void;
  onEditEnding?: (endingId: string) => void;
  onUnregisterEnding?: (endingId: string) => void;
  onInsertEndingCompletion?: (nodeId: string, endingId: string) => void;
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
  variables,
  manifest,
  onRegisterEnding,
  onEditEnding,
  onUnregisterEnding,
  onInsertEndingCompletion,
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
  const linkedEndings = Object.entries(manifest?.unlocks.endings ?? {}).filter(([, ending]) => ending.nodeId === node.id);

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
          variables={variables}
        />

        <section style={sectionStyle}>
          <Field label="结构角色" value={outgoing === 0 ? "图终点" : "流程节点（仍有出口）"} />
          <Field label="正式结局" value={linkedEndings.length ? linkedEndings.map(([id]) => id).join(", ") : "未登记"} />
          {linkedEndings.map(([id, ending]) => <div key={id} style={endingRowStyle}>
            <span>{id} · {ending.title}</span>
            <button type="button" onClick={() => onEditEnding?.(id)}>编辑</button>
            <button type="button" onClick={() => onInsertEndingCompletion?.(node.id, id)}>插入结算</button>
            <button type="button" onClick={() => onUnregisterEnding?.(id)}>取消登记</button>
          </div>)}
          <button type="button" onClick={() => onRegisterEnding?.(node.id)}>登记新结局…</button>
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

function ExitSection({
  graph,
  nodeId,
  edges,
  disabled,
  onChange,
  variables,
}: {
  graph: ProjectGraph;
  nodeId: string;
  edges: GraphEdge[];
  disabled: boolean;
  onChange: (edges: GraphEdge[]) => void;
  variables?: VariableRegistry;
}) {
  const [draggedEdgeId, setDraggedEdgeId] = useState<string | null>(null);
  const [simulationVars, setSimulationVars] = useState<Record<string, string | number | boolean | null>>({});
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
    const normalized = edges.map((edge, index) => normalizeBranchEdge(graph, nodeId, edge, index, nextMode));
    onChange(nextMode === "auto" ? orderDefaultAutoEdgeLast(normalized) : normalized);
  };

  const updateEdge = (edgeId: string, patch: Partial<GraphEdge>) => {
    const next = edges.map((edge, index) => {
      const normalized = normalizeBranchEdge(graph, nodeId, edge, index, mode);
      return normalized.id === edgeId ? normalizeEdge({ ...normalized, ...patch, mode }) : normalized;
    });
    onChange(mode === "auto" ? orderDefaultAutoEdgeLast(next) : next);
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

      {mode === "auto" && variables && <div style={conditionMetaStyle}>
        <div>模拟变量（仅本地预览）</div>
        {Object.entries(variables.variables).map(([name, declaration]) => <label key={name} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
          <span>{name}</span>
          <input
            aria-label={`模拟变量 ${name}`}
            type={declaration.type === "number" ? "number" : "text"}
            value={String(simulationVars[name] ?? declaration.default ?? "null")}
            onChange={(event) => setSimulationVars((current) => ({
              ...current,
              [name]: declaration.type === "number" ? Number(event.target.value)
                : declaration.type === "boolean" ? event.target.value === "true"
                : event.target.value,
            }))}
          />
        </label>)}
      </div>}

      <div style={exitListStyle}>
        {edges.map((edge, index) => {
          const condition = edge.condition?.trim() ?? "";
          const parsed = condition ? parseGraphCondition(condition) : null;
          const reads = parsed?.ok ? collectConditionVariables(parsed.ast) : [];
          const defaults = {
            ...Object.fromEntries(Object.entries(variables?.variables ?? {}).map(([name, declaration]) => [name, declaration.default])),
            ...simulationVars,
          };
          const preview = mode === "auto" ? evaluateGraphConditionResult(edge.condition, defaults) : null;
          const priorWins = mode === "auto" && edges.slice(0, index).some((prior) => {
            const result = evaluateGraphConditionResult(prior.condition, defaults);
            return result.ok && result.value;
          });
          return (
          <div
            key={edge.id}
            style={exitRowStyle}
            draggable={!disabled}
            onDragStart={() => setDraggedEdgeId(edge.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (draggedEdgeId && draggedEdgeId !== edge.id) {
                const reordered = moveEdgeById(edges, draggedEdgeId, edge.id);
                onChange(mode === "auto" ? orderDefaultAutoEdgeLast(reordered) : reordered);
              }
              setDraggedEdgeId(null);
            }}
          >
            <div style={fieldValueStyle}>{index + 1}. {targetTitle(graph, edge.to)}</div>
            {mode === "choice" ? (
              <input
                value={edge.label ?? targetTitle(graph, edge.to)}
                onChange={(event) => updateEdge(edge.id, { mode: "choice", label: event.target.value, condition: null })}
                disabled={disabled}
                placeholder="选项文本"
                style={compactInputStyle}
              />
            ) : <ConditionDraftInput
              condition={edge.condition}
              disabled={disabled}
              onCommit={(condition) => updateEdge(edge.id, { mode: "auto", label: null, condition })}
            />}
            {mode === "auto" && (
              <div style={conditionMetaStyle}>
                {!condition ? "默认边 · 最后兜底" : parsed?.ok ? `引用：${reads.join(", ") || "无"}` : `条件错误：${parsed?.error}`}
                {preview && ` · ${preview.ok ? (preview.value ? (priorWins ? "命中但被前序分支遮蔽" : "实际胜出") : "不命中") : `error: ${preview.message}`}`}
              </div>
            )}
            {mode === "auto" && condition && parsed?.ok && (
              <div style={conditionMetaStyle}><ConditionBuilder source={condition} registry={variables} onChange={(source) => updateEdge(edge.id, { condition: source })} /></div>
            )}
            <div style={reorderStyle}>
              <span aria-label={`拖拽 ${edge.id}`} title="拖拽排序">⋮⋮</span>
              <button type="button" aria-label={`上移 ${edge.id}`} disabled={disabled || index === 0 || (mode === "auto" && !condition)} onClick={() => onChange(orderAfterMove(edges, index, -1, mode))}>↑</button>
              <button type="button" aria-label={`下移 ${edge.id}`} disabled={disabled || index === edges.length - 1 || (mode === "auto" && !condition)} onClick={() => onChange(orderAfterMove(edges, index, 1, mode))}>↓</button>
            </div>
          </div>
          );
        })}
      </div>
    </section>
  );
}

function ConditionDraftInput({
  condition,
  disabled,
  onCommit,
}: {
  condition: string | null;
  disabled: boolean;
  onCommit: (condition: string | null) => void;
}) {
  const [draft, setDraft] = useState(condition ?? "");
  const [dirty, setDirty] = useState(false);
  const result = commitConditionDraft(draft);

  useEffect(() => {
    if (!dirty) setDraft(condition ?? "");
  }, [condition, dirty]);

  const commit = () => {
    if (!result.ok) return;
    setDirty(false);
    onCommit(result.condition);
  };

  return <div>
    <input
      value={draft}
      onChange={(event) => { setDraft(event.target.value); setDirty(true); }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") { commit(); event.currentTarget.blur(); }
        if (event.key === "Escape") { setDraft(condition ?? ""); setDirty(false); }
      }}
      disabled={disabled}
      aria-invalid={!result.ok}
      placeholder="条件；留空为默认"
      style={compactInputStyle}
    />
    {!result.ok && <div role="alert" style={conditionMetaStyle}>条件草稿尚未保存：{result.message}</div>}
  </div>;
}

export function commitConditionDraft(source: string):
  | { ok: true; condition: string | null }
  | { ok: false; message: string } {
  const condition = source.trim();
  if (!condition) return { ok: true, condition: null };
  const parsed = parseGraphCondition(condition);
  return parsed.ok ? { ok: true, condition } : { ok: false, message: parsed.error };
}

export function moveEdge(edges: GraphEdge[], index: number, delta: -1 | 1): GraphEdge[] {
  const target = index + delta;
  if (target < 0 || target >= edges.length) return edges;
  const next = [...edges];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function moveEdgeById(edges: GraphEdge[], draggedId: string, targetId: string): GraphEdge[] {
  const from = edges.findIndex((edge) => edge.id === draggedId);
  const to = edges.findIndex((edge) => edge.id === targetId);
  if (from < 0 || to < 0 || from === to) return edges;
  const next = [...edges];
  const [dragged] = next.splice(from, 1);
  next.splice(to, 0, dragged);
  return next;
}

export function orderDefaultAutoEdgeLast(edges: GraphEdge[]): GraphEdge[] {
  return [...edges.filter((edge) => edge.condition?.trim()), ...edges.filter((edge) => !edge.condition?.trim())];
}

function orderAfterMove(edges: GraphEdge[], index: number, delta: -1 | 1, mode: BranchMode) {
  const next = moveEdge(edges, index, delta);
  return mode === "auto" ? orderDefaultAutoEdgeLast(next) : next;
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
  gridTemplateColumns: "minmax(72px, 0.8fr) minmax(0, 1fr) auto",
  gap: "var(--space-2)",
  alignItems: "center",
};

const conditionMetaStyle: React.CSSProperties = {
  gridColumn: "1 / -1",
  fontSize: "var(--text-xs)",
  color: "var(--text-muted)",
};

const reorderStyle: React.CSSProperties = {
  display: "flex",
  gap: "var(--space-1)",
};
const endingRowStyle: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: "var(--space-1)", alignItems: "center" };

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
