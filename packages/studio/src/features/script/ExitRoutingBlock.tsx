/**
 * 出口路由区块（Spec 35 Phase 2）。
 *
 * 显示在 NodeEditor 底部，列出当前节点的 outgoing edges：
 * - 0 条出口：显示「节点结束」。
 * - 1 条出口：显示「直接前往 [目标]」（只读）。
 * - 多条出口：列出每条出口的 condition（可编辑）+ effects（可编辑），
 *   兜底（空 condition）标记为「否则」并强制排最后。
 *
 * 只编辑 condition / effects，不碰 mode / label（出口的增删在图视图）。
 * condition 编辑复用 ConditionEditor，试算复用 StateTrial，赢家高亮复用
 * branchEdgeModel 导出的 evaluateBranchOutcomes / orderDefaultAutoEdgeLast。
 */
import { ChevronDown, ChevronUp, TriangleAlert } from "lucide-react";
import type { VariableRegistry } from "@vibegal/engine";
import type { GraphEdge, ProjectGraph } from "../../lib/types";
import { IconButton } from "../common/Button";
import { useStudioI18n } from "../../lib/i18n";
import { ConditionEditor } from "./ConditionEditor";
import { EdgeEffectsEditor } from "./EdgeEffectsEditor";
import { StateTrial } from "./StateTrial";
import {
  evaluateBranchOutcomes,
  moveEdge,
  orderDefaultAutoEdgeLast,
  targetTitle,
} from "./branchEdgeModel";
import type { StateSource } from "./storyState";

export interface ExitRoutingBlockProps {
  graph: ProjectGraph;
  nodeId: string;
  edges: GraphEdge[];
  sources: StateSource[];
  registry?: VariableRegistry;
  disabled?: boolean;
  onChange: (edges: GraphEdge[]) => void;
  /** 表达式无法句子化时，交给宿主打开高级表达式编辑器。 */
  onEditExpression?: (edge: GraphEdge) => void;
  trialValues: Record<string, string | number | boolean | null>;
  onTrialChange: (values: Record<string, string | number | boolean | null>) => void;
}

export function ExitRoutingBlock({
  graph,
  edges,
  sources,
  registry,
  disabled = false,
  onChange,
  onEditExpression,
  trialValues,
  onTrialChange,
}: ExitRoutingBlockProps) {
  const { t } = useStudioI18n();

  if (edges.length === 0) {
    return (
      <section className="gs-exit-routing" data-exit-count="0">
        <header className="gs-exit-routing__header">{t("script.exitRouting.title")}</header>
        <p className="gs-exit-routing__empty">{t("script.exitRouting.terminal")}</p>
      </section>
    );
  }

  if (edges.length === 1) {
    return (
      <section className="gs-exit-routing" data-exit-count="1">
        <header className="gs-exit-routing__header">{t("script.exitRouting.title")}</header>
        <p className="gs-exit-routing__single">
          {t("script.exitRouting.singleExit", { title: targetTitle(graph, edges[0].to, t) })}
        </p>
      </section>
    );
  }

  const ordered = orderDefaultAutoEdgeLast(edges);
  const outcomes = evaluateBranchOutcomes(ordered, trialValues, t);
  // fallback（空 condition）行不可拖到非末尾位置。
  const fallbackIndex = ordered.findIndex((edge) => !edge.condition?.trim());

  const updateEdge = (id: string, patch: Partial<GraphEdge>) => {
    const next = ordered.map((edge) => (edge.id === id ? { ...edge, ...patch } : edge));
    onChange(orderDefaultAutoEdgeLast(next));
  };

  const handleMove = (index: number, delta: -1 | 1) => {
    onChange(orderDefaultAutoEdgeLast(moveEdge(ordered, index, delta)));
  };

  return (
    <section className="gs-exit-routing" data-exit-count={String(ordered.length)}>
      <header className="gs-exit-routing__header">{t("script.exitRouting.title")}</header>
      <ol className="gs-exit-routing__list">
        {ordered.map((edge, index) => {
          const outcome = outcomes[index];
          const isFallback = !edge.condition?.trim();
          const canMoveUp = index > 0 && !(isFallback);
          const canMoveDown = index < ordered.length - 1 && !(isFallback) && !(index + 1 === fallbackIndex);
          return (
            <li
              key={edge.id}
              className="gs-exit-routing__row"
              data-exit-winner={outcome?.winner ? "true" : "false"}
              data-exit-fallback={isFallback ? "true" : "false"}
            >
              <span className="gs-exit-routing__target">{targetTitle(graph, edge.to, t)}</span>
              <ConditionEditor
                source={edge.condition ?? ""}
                sources={sources}
                disabled={disabled}
                onChange={(condition) => updateEdge(edge.id, { condition: condition || null })}
                onEditExpression={onEditExpression ? () => onEditExpression(edge) : undefined}
              />
              <EdgeEffectsEditor
                effects={edge.effects}
                registry={registry}
                disabled={disabled}
                onChange={(effects) => updateEdge(edge.id, { effects })}
              />
              {outcome?.problem && (
                <span className="gs-exit-routing__problem">
                  <TriangleAlert size={14} aria-hidden /> {outcome.problem.message}
                </span>
              )}
              <span className="gs-exit-routing__move">
                <IconButton
                  aria-label={t("script.exitRouting.moveUp")}
                  disabled={disabled || !canMoveUp}
                  onClick={() => handleMove(index, -1)}
                >
                  <ChevronUp size={14} />
                </IconButton>
                <IconButton
                  aria-label={t("script.exitRouting.moveDown")}
                  disabled={disabled || !canMoveDown}
                  onClick={() => handleMove(index, 1)}
                >
                  <ChevronDown size={14} />
                </IconButton>
              </span>
            </li>
          );
        })}
      </ol>
      <StateTrial sources={sources} values={trialValues} onChange={onTrialChange} />
    </section>
  );
}
