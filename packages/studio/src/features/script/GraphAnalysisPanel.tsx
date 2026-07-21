import { useMemo, useState } from "react";
import type { Manifest, NodeEntry, ProjectGraph } from "../../lib/types";
import type { VariableRegistry } from "@vibegal/engine";
import { analyzeEndingRouteMatrix, collectUnregisteredTerminals } from "./routeAnalysis";
import { VariableWorkbench } from "./VariableWorkbench";
import { analyzeGraphVariables, buildRouteCoverage } from "./variableAnalysis";

interface GraphAnalysisPanelProps {
  graph: ProjectGraph;
  nodeEntries?: NodeEntry[];
  onSelectNode: (nodeId: string) => void;
  onSelectEdge: (edgeId: string) => void;
  manifest?: Manifest;
  registry?: VariableRegistry;
  onRegistryChange?: (registry: VariableRegistry) => void;
}

export function GraphAnalysisPanel({ graph, nodeEntries, onSelectNode, onSelectEdge, manifest, registry, onRegistryChange }: GraphAnalysisPanelProps) {
  const coverage = useMemo(() => buildRouteCoverage(graph), [graph]);
  const analysis = useMemo(() => analyzeGraphVariables(graph, nodeEntries), [graph, nodeEntries]);
  const [query, setQuery] = useState("");
  const endingMatrix = useMemo(() => manifest ? analyzeEndingRouteMatrix({ graph, nodes: nodeEntries, manifest, variables: registry }) : null, [graph, nodeEntries, manifest, registry]);
  const unregisteredTerminals = useMemo(() => manifest ? collectUnregisteredTerminals(graph, manifest) : [], [graph, manifest]);

  const variables = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return analysis.variables;
    return analysis.variables.filter((entry) => entry.name.toLowerCase().includes(normalized));
  }, [analysis.variables, query]);

  return (
    <div style={panelStyle}>
      <div style={panelTitleStyle}>Analysis</div>
      <div style={contentStyle}>
        <section style={sectionStyle}>
          <div style={sectionTitleStyle}>Route Coverage</div>
          <div style={statsGridStyle}>
            <StatCard label="总节点" value={coverage.totalNodes} />
            <StatCard label="可达" value={coverage.reachableNodes} />
            <StatCard label="结局" value={coverage.endingNodes} />
            <StatCard label="孤立" value={coverage.orphanNodes} />
          </div>
          {endingMatrix && endingMatrix.rows.length > 0 && (
            <div style={listStyle}>
              <div style={sectionTitleStyle}>Ending Route Matrix</div>
              <div style={{ display: "grid", gridTemplateColumns: `minmax(120px, 1fr) repeat(${endingMatrix.columns.length}, minmax(80px, 1fr))`, gap: 4 }}>
                <strong>正式结局</strong>
                {endingMatrix.columns.map((column) => <strong key={column.id}>{column.title}</strong>)}
                {endingMatrix.rows.flatMap((row) => [
                  <span key={`${row.endingId}:title`}>{row.endingId} · {row.title}</span>,
                  ...row.cells.map((cell, index) => <button key={`${row.endingId}:${endingMatrix.columns[index].id}`} type="button"
                    title={cell.witness ? `路径：${cell.witness.join(" -> ")}` : cell.reason}>{cell.reachability}</button>),
                ])}
              </div>
            </div>
          )}
          {unregisteredTerminals.length > 0 && <div style={listStyle}>
            <div style={sectionTitleStyle}>可达但未登记的图终点</div>
            {unregisteredTerminals.map((terminal) => <button key={terminal.nodeId} type="button" style={parseIssueStyle} onClick={() => onSelectNode(terminal.nodeId)}>{terminal.title} · {terminal.nodeId}</button>)}
          </div>}
          {coverage.choiceBranches.length > 0 && (
            <div style={listStyle}>
              <div style={sectionTitleStyle}>Choice Branches</div>
              {coverage.choiceBranches.map((branch) => (
                <button key={branch.edgeId} type="button" style={parseIssueStyle} onClick={() => onSelectEdge(branch.edgeId)}>
                  <div style={itemTitleStyle}>{branch.label}</div>
                  <div style={metaStyle}>
                    {`${branch.fromNodeId} -> ${branch.toNodeId} · ${branch.reachesEnding ? `到达结局 ${branch.endingNodeIds.join(", ")}` : "未发现可达结局"}`}
                  </div>
                </button>
              ))}
            </div>
          )}
          {coverage.autoBranches.length > 0 && (
            <div style={listStyle}>
              <div style={sectionTitleStyle}>Auto Branches</div>
              {coverage.autoBranches.map((branch) => (
                <button key={branch.edgeId} type="button" style={parseIssueStyle} onClick={() => onSelectEdge(branch.edgeId)}>
                  <div style={itemTitleStyle}>{branch.edgeId}</div>
                  <div style={metaStyle}>
                    {branch.conditionState} · {branch.condition || "default"} · {branch.reachesEnding ? `到达结局 ${branch.endingNodeIds.join(", ")}` : "未发现可达结局"}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {registry && <section style={sectionStyle}><div style={sectionTitleStyle}>Variable Workbench</div><VariableWorkbench registry={registry} graph={graph} nodes={nodeEntries} onChange={onRegistryChange} /></section>}

        <section style={sectionStyle}>
          <div style={sectionHeaderStyle}>
            <div style={sectionTitleStyle}>Variable Table</div>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索变量"
              style={searchInputStyle}
            />
          </div>
          <div style={listStyle}>
            {variables.length === 0 ? (
              <div style={emptyStyle}>没有匹配的变量</div>
            ) : (
              variables.map((entry) => (
                <article key={entry.name} style={itemStyle}>
                  <div style={itemHeaderStyle}>
                    <div>
                      <div style={itemTitleStyle}>{entry.name}</div>
                      <div style={metaStyle}>{entry.types.join(" / ") || "unknown"}</div>
                    </div>
                    <div style={badgeRowStyle}>
                      {entry.issues.map((issue) => (
                        <span key={issue.code} style={issueBadgeStyle(issue.severity)}>{issue.code}</span>
                      ))}
                    </div>
                  </div>
                  <div style={metaStyle}>写入 {entry.writes.length} / 读取 {entry.reads.length}</div>
                  <div style={actionRowStyle}>
                    {entry.writes[0]?.nodeId && (
                      <button type="button" style={actionButtonStyle} onClick={() => onSelectNode(entry.writes[0]!.nodeId!)}>
                        跳到写入点
                      </button>
                    )}
                    {entry.reads[0]?.edgeId && (
                      <button type="button" style={actionButtonStyle} onClick={() => onSelectEdge(entry.reads[0]!.edgeId!)}>
                        跳到条件
                      </button>
                    )}
                  </div>
                </article>
              ))
            )}
          </div>
        </section>

        {analysis.parseIssues.length > 0 && (
          <section style={sectionStyle}>
            <div style={sectionTitleStyle}>Condition Parse Errors</div>
            <div style={listStyle}>
              {analysis.parseIssues.map((issue) => (
                <button key={issue.edgeId} type="button" style={parseIssueStyle} onClick={() => onSelectEdge(issue.edgeId)}>
                  <div style={itemTitleStyle}>{issue.edgeId}</div>
                  <div style={metaStyle}>{issue.message}</div>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div style={statCardStyle}>
      <div style={statValueStyle}>{value}</div>
      <div style={metaStyle}>{label}</div>
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
};

const sectionHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--space-2)",
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: "var(--text-sm)",
  fontWeight: 600,
  color: "var(--text-primary)",
};

const statsGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: "var(--space-2)",
};

const statCardStyle: React.CSSProperties = {
  padding: "var(--space-3)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  background: "var(--bg-panel)",
};

const statValueStyle: React.CSSProperties = {
  fontSize: "var(--text-xl)",
  fontWeight: 700,
  color: "var(--text-bright)",
};

const searchInputStyle: React.CSSProperties = {
  minWidth: 0,
  flex: 1,
  maxWidth: 180,
  padding: "var(--space-2)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)",
  background: "var(--bg-panel)",
  color: "var(--text-primary)",
};

const listStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
};

const itemStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
  padding: "var(--space-3)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  background: "var(--bg-panel)",
};

const itemHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: "var(--space-2)",
};

const itemTitleStyle: React.CSSProperties = {
  fontSize: "var(--text-base)",
  fontWeight: 600,
  color: "var(--text-bright)",
};

const metaStyle: React.CSSProperties = {
  fontSize: "var(--text-xs)",
  color: "var(--text-muted)",
  wordBreak: "break-word",
};

const badgeRowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  justifyContent: "flex-end",
  gap: "var(--space-1)",
};

const actionRowStyle: React.CSSProperties = {
  display: "flex",
  gap: "var(--space-2)",
  flexWrap: "wrap",
};

const actionButtonStyle: React.CSSProperties = {
  padding: "var(--space-1) var(--space-2)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)",
  background: "var(--bg-app)",
  color: "var(--text-primary)",
  cursor: "pointer",
  fontSize: "var(--text-xs)",
};

const parseIssueStyle: React.CSSProperties = {
  ...itemStyle,
  textAlign: "left",
  cursor: "pointer",
};

const emptyStyle: React.CSSProperties = {
  color: "var(--text-muted)",
  fontSize: "var(--text-sm)",
};

function issueBadgeStyle(severity: "error" | "warn"): React.CSSProperties {
  return {
    padding: "2px var(--space-2)",
    borderRadius: "var(--radius-pill)",
    background: severity === "error" ? "var(--status-error-soft)" : "var(--status-warn-soft)",
    color: severity === "error" ? "var(--status-error-text)" : "var(--status-warn-text)",
    fontSize: "var(--text-xs)",
  };
}
