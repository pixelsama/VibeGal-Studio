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
import { useStudioI18n, type StudioMessageKey } from "../../lib/i18n";

const REACHABILITY_MESSAGE_KEY: Record<string, StudioMessageKey> = {
  reachable: "script.coverage.reachable",
  unreachable: "script.coverage.unreachable",
  unknown: "script.coverage.unknown",
};

export interface RouteCoveragePanelProps {
  graph: ProjectGraph;
  nodeEntries?: NodeEntry[];
  manifest?: Manifest;
  registry?: VariableRegistry;
  onSelectNode: (nodeId: string) => void;
}

export function RouteCoveragePanel({ graph, nodeEntries, manifest, registry, onSelectNode }: RouteCoveragePanelProps) {
  const { t } = useStudioI18n();
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
        <Stat label={t("script.coverage.totalNodes")} value={coverage.totalNodes} />
        <Stat label={t("script.coverage.reachable")} value={coverage.reachableNodes} />
        <Stat label={t("script.coverage.endingNodes")} value={coverage.endingNodes} />
        <Stat label={t("script.coverage.orphanNodes")} value={coverage.orphanNodes} />
      </div>

      {endingMatrix && endingMatrix.rows.length > 0 && (
        <section className="gs-coverage__block">
          <h4>{t("script.coverage.endingReachability")}</h4>
          <div className="gs-coverage__matrix" style={{ gridTemplateColumns: `minmax(110px, 1fr) repeat(${endingMatrix.columns.length}, minmax(72px, auto))` }}>
            <strong>{t("script.coverage.ending")}</strong>
            {endingMatrix.columns.map((column) => <strong key={column.id}>{column.title}</strong>)}
            {endingMatrix.rows.flatMap((row) => [
              <span key={`${row.endingId}:title`}>{row.title}</span>,
              ...row.cells.map((cell, index) => (
                <span
                  key={`${row.endingId}:${endingMatrix.columns[index].id}`}
                  className={`gs-coverage__cell gs-coverage__cell--${cell.reachability}`}
                  title={cell.witness ? t("script.coverage.path", { path: cell.witness.join(" → ") }) : cell.reason}
                >
                  {REACHABILITY_MESSAGE_KEY[cell.reachability]
                    ? t(REACHABILITY_MESSAGE_KEY[cell.reachability])
                    : cell.reachability}
                </span>
              )),
            ])}
          </div>
        </section>
      )}

      {unregisteredTerminals.length > 0 && (
        <section className="gs-coverage__block">
          <h4>{t("script.coverage.unregisteredTerminals")}</h4>
          {unregisteredTerminals.map((terminal) => (
            <button key={terminal.nodeId} type="button" className="gs-state-usage__row" onClick={() => onSelectNode(terminal.nodeId)}>
              <span>{terminal.title}</span>
              <span className="gs-state-usage__hint">{t("script.coverage.inspect")}</span>
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
