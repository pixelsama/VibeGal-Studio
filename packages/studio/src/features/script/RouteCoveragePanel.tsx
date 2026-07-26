/**
 * 剧情覆盖 —— 回答「我的故事结构完整吗」。
 *
 * 这是从原「分析」tab 拆出来的一半：全貌类信息（能走到几个节点、每个结局是否
 * 可达）留在剧情流程视图里按需展开；诊断类信息（有东西坏了）改由右下角的全局
 * 问题面板统一收口，不再在这里开第二个入口。
 */
import { useMemo } from "react";
import type { Manifest, NodeEntry, ProjectGraph } from "../../lib/types";
import type { VariableRegistry } from "@vibegal/engine";
import { analyzeEndingRouteMatrix, collectUnregisteredTerminals } from "./routeAnalysis";
import { buildRouteCoverage } from "./variableAnalysis";

const REACHABILITY_LABEL: Record<string, string> = {
  reachable: "能走到",
  unreachable: "走不到",
  unknown: "不确定",
};

export interface RouteCoveragePanelProps {
  graph: ProjectGraph;
  nodeEntries?: NodeEntry[];
  manifest?: Manifest;
  registry?: VariableRegistry;
  onSelectNode: (nodeId: string) => void;
}

export function RouteCoveragePanel({ graph, nodeEntries, manifest, registry, onSelectNode }: RouteCoveragePanelProps) {
  const coverage = useMemo(() => buildRouteCoverage(graph), [graph]);
  const endingMatrix = useMemo(
    () => manifest ? analyzeEndingRouteMatrix({ graph, nodes: nodeEntries, manifest, variables: registry }) : null,
    [graph, nodeEntries, manifest, registry],
  );
  const unregisteredTerminals = useMemo(
    () => manifest ? collectUnregisteredTerminals(graph, manifest) : [],
    [graph, manifest],
  );

  return (
    <div className="gs-coverage">
      <div className="gs-coverage__stats">
        <Stat label="节点总数" value={coverage.totalNodes} />
        <Stat label="能走到" value={coverage.reachableNodes} />
        <Stat label="终点" value={coverage.endingNodes} />
        <Stat label="孤立节点" value={coverage.orphanNodes} />
      </div>

      {endingMatrix && endingMatrix.rows.length > 0 && (
        <section className="gs-coverage__block">
          <h4>每个结局能不能走到</h4>
          <div className="gs-coverage__matrix" style={{ gridTemplateColumns: `minmax(110px, 1fr) repeat(${endingMatrix.columns.length}, minmax(72px, auto))` }}>
            <strong>结局</strong>
            {endingMatrix.columns.map((column) => <strong key={column.id}>{column.title}</strong>)}
            {endingMatrix.rows.flatMap((row) => [
              <span key={`${row.endingId}:title`}>{row.title}</span>,
              ...row.cells.map((cell, index) => (
                <span
                  key={`${row.endingId}:${endingMatrix.columns[index].id}`}
                  className={`gs-coverage__cell gs-coverage__cell--${cell.reachability}`}
                  title={cell.witness ? `路径：${cell.witness.join(" → ")}` : cell.reason}
                >
                  {REACHABILITY_LABEL[cell.reachability] ?? cell.reachability}
                </span>
              )),
            ])}
          </div>
        </section>
      )}

      {unregisteredTerminals.length > 0 && (
        <section className="gs-coverage__block">
          <h4>走得到、但还没登记成结局的终点</h4>
          {unregisteredTerminals.map((terminal) => (
            <button key={terminal.nodeId} type="button" className="gs-state-usage__row" onClick={() => onSelectNode(terminal.nodeId)}>
              <span>{terminal.title}</span>
              <span className="gs-state-usage__hint">去看看</span>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="gs-coverage__stat">
      <div className="gs-coverage__stat-value">{value}</div>
      <div className="gs-coverage__stat-label">{label}</div>
    </div>
  );
}
