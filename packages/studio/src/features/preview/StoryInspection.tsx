/**
 * 剧情检查 —— 运行中的只读解释面板。
 *
 * 它替代的是常驻的变量监视器：那个面板把 `system.playthroughCount · number ·
 * 运行时提供` 这类实现信息堆在 260px 的窄栏里，还用输入框暗示只读事实可以改。
 *
 * 三条原则：
 * 1. **只列变化过的、以及当前分流用到的**。没被碰过的状态和 `seen.* = false`
 *    一律不列 —— 全量铺开正是原来那个面板的毛病。
 * 2. **每一行都带来源和跳转**，这是它区别于变量监视器的地方。
 * 3. **没有输入框**。要改就去故事里改，或者带着当前值重新试演。
 */
import { ArrowRight, X } from "lucide-react";
import { evaluateGraphConditionResult, variableKind, type Manifest, type StateWriteEvent, type VariableRegistry } from "@vibegal/engine";
import type { NovelState } from "@vibegal/engine";
import type { ProjectGraph } from "../../lib/types";
import { Button, IconButton } from "../common/Button";
import { describeCondition } from "../script/ConditionEditor";
import {
  bandLabelForValue,
  bandThreshold,
  collectStateSources,
  operatorLabel,
  parseConditionSentence,
  variableLabel,
  type ClauseOperator,
  type StateSource,
} from "../script/storyState";
import { translateZhCN, useStudioI18n, type StudioTranslator } from "../../lib/i18n";

export interface StoryInspectionProps {
  state: NovelState;
  graph?: ProjectGraph | null;
  registry?: VariableRegistry;
  manifest?: Manifest;
  stateWrites: StateWriteEvent[];
  currentNodeId: string | null;
  onClose: () => void;
  /** 跳到改变它的那条指令。 */
  onOpenNode?: (nodeId: string, instructionIndex?: number) => void;
  onSelectEdge?: (edgeId: string) => void;
  /** 把当前实际值预填进试演假设 —— 只读面板的逃生口。 */
  onReplayWithCurrentValues?: () => void;
}

export function StoryInspection({
  state,
  graph,
  registry,
  manifest,
  stateWrites,
  currentNodeId,
  onClose,
  onOpenNode,
  onSelectEdge,
  onReplayWithCurrentValues,
}: StoryInspectionProps) {
  const { t } = useStudioI18n();
  const sources = collectStateSources({ registry, graph: graph ?? undefined, manifest, t });
  const byName = new Map(sources.map((source) => [source.name, source]));
  const nodeTitle = (nodeId?: string | null) =>
    graph?.nodes.find((node) => node.id === nodeId)?.title || nodeId || t("preview.inspection.unknownNode");

  // 每个状态只保留最近一次改变：作者问的是「现在这个值是哪来的」。
  const latestByVariable = new Map<string, StateWriteEvent>();
  for (const event of stateWrites) latestByVariable.set(event.variable, event);

  const changed = [...latestByVariable.values()].reverse();
  const branch = describeNextBranch(graph, currentNodeId, state.vars, byName, t);

  return (
    <aside className="gs-inspection">
      <header className="gs-inspection__head">
        <span>{t("preview.inspect")}</span>
        <IconButton aria-label={t("preview.inspection.close")} onClick={onClose}>
          <X size={14} aria-hidden="true" />
        </IconButton>
      </header>

      <div className="gs-inspection__body">
        <section className="gs-inspection__block">
          <h4>{t("preview.inspection.location")}</h4>
          <p className="gs-inspection__where">{nodeTitle(currentNodeId)}</p>
        </section>

        <section className="gs-inspection__block">
          <h4>{t("preview.inspection.history")}</h4>
          {changed.length === 0 ? (
            <p className="gs-inspection__quiet">{t("preview.inspection.noChanges")}</p>
          ) : changed.map((event) => {
            const source = byName.get(event.variable);
            const declaration = source?.declaration;
            const band = declaration && typeof event.to === "number"
              ? bandLabelForValue(declaration, event.to)
              : undefined;
            return (
              <div key={event.variable} className="gs-inspection__row">
                <div className="gs-inspection__row-main">
                  <span className="gs-inspection__name">
                    {source?.label ?? variableLabel(event.variable, declaration, manifest)}
                  </span>
                  <span className="gs-inspection__value">
                    {band
                      ? t("preview.inspection.valueWithBand", { value: formatValue(event.to, t), band })
                      : formatValue(event.to, t)}
                  </span>
                </div>
                <button
                  type="button"
                  className="gs-inspection__origin"
                  onClick={() => onOpenNode?.(event.nodeId, event.instructionIndex)}
                  disabled={!onOpenNode}
                >
                  {t("preview.inspection.changedAt", {
                    node: nodeTitle(event.nodeId),
                    change: describeChange(event, t),
                  })}
                  <ArrowRight size={12} aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </section>

        <section className="gs-inspection__block">
          <h4>{t("preview.inspection.nextBranch")}</h4>
          {branch.kind === "end" && <p className="gs-inspection__quiet">{t("preview.inspection.end")}</p>}
          {branch.kind === "choice" && <p className="gs-inspection__quiet">{t("preview.inspection.choice")}</p>}
          {branch.kind === "linear" && (
            <p className="gs-inspection__quiet">{t("preview.inspection.linear", { node: nodeTitle(branch.toNodeId) })}</p>
          )}
          {branch.kind === "auto" && (
            <>
              {branch.clauses.map((clause, index) => (
                <p key={index} className={clause.satisfied ? "gs-inspection__clause gs-inspection__clause--ok" : "gs-inspection__clause"}>
                  {clause.satisfied ? "✓" : "✗"} {clause.text}
                </p>
              ))}
              <p className="gs-inspection__outcome">
                {branch.winnerNodeId
                  ? t("preview.inspection.winner", { node: nodeTitle(branch.winnerNodeId) })
                  : t("preview.inspection.stuck")}
              </p>
              {branch.edgeId && onSelectEdge && (
                <Button onClick={() => onSelectEdge(branch.edgeId!)}>{t("preview.inspection.viewBranch")}</Button>
              )}
            </>
          )}
        </section>

        <footer className="gs-inspection__foot">
          <p className="gs-inspection__quiet">
            {t("preview.inspection.readonlyHint")}
          </p>
          {onReplayWithCurrentValues && (
            <Button onClick={onReplayWithCurrentValues}>{t("preview.inspection.replay")}</Button>
          )}
        </footer>
      </div>
    </aside>
  );
}

type NextBranch =
  | { kind: "end" }
  | { kind: "choice" }
  | { kind: "linear"; toNodeId: string }
  | { kind: "auto"; clauses: Array<{ text: string; satisfied: boolean }>; winnerNodeId: string | null; edgeId: string | null };

/**
 * 解释当前节点的下一步。
 *
 * 求值走 evaluateGraphConditionResult（与运行时同源），逐子句解释复用
 * storyState 的句子模型，所以预览和剧情不会各有一套解释器。
 */
export function describeNextBranch(
  graph: ProjectGraph | null | undefined,
  currentNodeId: string | null,
  vars: Record<string, string | number | boolean | null>,
  byName: Map<string, StateSource>,
  t: StudioTranslator = translateZhCN,
): NextBranch {
  const outgoing = (graph?.edges ?? []).filter((edge) => edge.from === currentNodeId);
  if (outgoing.length === 0) return { kind: "end" };
  if (outgoing.some((edge) => (edge.mode ?? "linear") === "choice")) return { kind: "choice" };
  if (outgoing.every((edge) => (edge.mode ?? "linear") === "linear")) {
    return { kind: "linear", toNodeId: outgoing[0].to };
  }

  // 首个命中者胜出，与 graphRouting 的语义一致。
  let winner: { toNodeId: string; edgeId: string } | null = null;
  for (const edge of outgoing) {
    const result = evaluateGraphConditionResult(edge.condition ?? null, vars);
    if (result.ok && result.value) {
      winner = { toNodeId: edge.to, edgeId: edge.id };
      break;
    }
  }

  // 逐子句解释胜出的那条；但胜出者是兜底（无条件）时改为解释第一条带条件的分支
  // —— 否则作者只会看到一片空白，而他真正想知道的是「差哪一条没满足」。
  const winnerEdge = outgoing.find((edge) => edge.id === winner?.edgeId);
  const explained = winnerEdge?.condition?.trim()
    ? winnerEdge
    : outgoing.find((edge) => edge.condition?.trim()) ?? outgoing[0];
  const sentence = parseConditionSentence(explained.condition ?? "");
  const clauses = sentence
    ? sentence.clauses.map((clause) => {
      const source = byName.get(clause.source);
      const single = { join: sentence.join, clauses: [clause] };
      const result = evaluateGraphConditionResult(formatSingle(single, clause, source), vars);
      return {
        text: describeClauseText(clause, source, t),
        satisfied: result.ok && result.value,
      };
    })
    : explained.condition
      ? [{ text: describeCondition(explained.condition, [...byName.values()], t), satisfied: winner != null }]
      : [];

  return { kind: "auto", clauses, winnerNodeId: winner?.toNodeId ?? null, edgeId: explained.id };
}

/** 单个子句的表达式，用于独立求值出 ✓/✗。 */
function formatSingle(
  sentence: { join: "all" | "any" },
  clause: { source: string; operator: string; value?: string | number | boolean },
  source?: StateSource,
): string {
  void sentence;
  const declaration = source?.declaration;
  switch (clause.operator) {
    case "happened": return clause.source;
    case "notHappened": return `!${clause.source}`;
    case "atLeast": return `${clause.source} >= ${Number(clause.value ?? 0)}`;
    case "atMost": return `${clause.source} <= ${Number(clause.value ?? 0)}`;
    case "is": return `${clause.source} == ${literal(clause.value, declaration?.type)}`;
    default: return `${clause.source} != ${literal(clause.value, declaration?.type)}`;
  }
}

function literal(value: string | number | boolean | undefined, type?: string): string {
  if (type === "number" || typeof value === "number") return String(Number(value ?? 0));
  if (type === "boolean" || typeof value === "boolean") return String(Boolean(value));
  return JSON.stringify(String(value ?? ""));
}

function describeClauseText(
  clause: { source: string; operator: string; value?: string | number | boolean },
  source: StateSource | undefined,
  t: StudioTranslator,
): string {
  const name = source?.label ?? clause.source;
  const operator = operatorLabel(clause.operator as ClauseOperator, t);
  if (clause.operator === "happened" || clause.operator === "notHappened") return `${name} ${operator}`;
  const declaration = source?.declaration;
  if (clause.operator === "atLeast" || clause.operator === "atMost") {
    const band = declaration?.bands?.find((item) => bandThreshold(declaration, item.id) === Number(clause.value));
    return `${name} ${operator} ${band?.label ?? clause.value}`;
  }
  const option = declaration?.options?.find((item) => item.id === clause.value);
  return `${name} ${operator} ${option?.label ?? clause.value}`;
}

/** 「增加了 10」比「从 55 变成 65」更接近作者的说法。 */
export function describeChange(
  event: StateWriteEvent,
  t: StudioTranslator = translateZhCN,
): string {
  if (typeof event.from === "number" && typeof event.to === "number") {
    const delta = event.to - event.from;
    if (delta > 0) return t("preview.inspection.change.increase", { amount: delta });
    if (delta < 0) return t("preview.inspection.change.decrease", { amount: -delta });
  }
  if (typeof event.to === "boolean") {
    return event.to
      ? t("preview.inspection.change.happened")
      : t("preview.inspection.change.notHappened");
  }
  return t("preview.inspection.change.assign", { value: formatValue(event.to, t) });
}

function formatValue(
  value: string | number | boolean | null,
  t: StudioTranslator,
): string {
  if (value === null) return t("preview.inspection.value.none");
  if (typeof value === "boolean") {
    return value
      ? t("preview.inspection.value.happened")
      : t("preview.inspection.value.notHappened");
  }
  return String(value);
}

export { variableKind };
