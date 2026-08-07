import type { GraphEdgeData } from "./types";
import type { NovelState } from "./state";
import { evaluateExpressionValue, parseExpression, truthy } from "./expression";

export type GraphRouteValue = string | number | boolean | null;

// Spec 35：图路由只负责「出口数量 + condition」。
// 玩家选择由节点内 choice 指令处理，不再经过图路由，所以 decision 去掉了
// kind:"choice" 分支。
export type GraphRouteDecision =
  | { kind: "end" }
  | { kind: "target"; edge: GraphEdgeData }
  | { kind: "error"; message: string };

/**
 * 节点出口路由（Spec 35 简化版）：
 * - 0 条出口 → 节点结束（end）
 * - 1 条出口 → 直接走（兼容旧 linear 行为）
 * - 多条出口 → 按声明顺序求 condition，首个命中者走；
 *              condition 为空的兜底边排在所有带条件边之后求值；
 *              都没命中且无兜底边 → error
 */
export function decideGraphRoute(
  outgoingEdges: GraphEdgeData[],
  state: NovelState,
): GraphRouteDecision {
  if (outgoingEdges.length === 0) return { kind: "end" };
  if (outgoingEdges.length === 1) return { kind: "target", edge: outgoingEdges[0] };

  // 把兜底边（condition 为空）排到最后再求值。
  const ordered = outgoingEdges.map((edge, index) => ({ edge, index }));
  ordered.sort((left, right) => {
    const leftFallback = isFallbackEdge(left.edge) ? 1 : 0;
    const rightFallback = isFallbackEdge(right.edge) ? 1 : 0;
    if (leftFallback !== rightFallback) return leftFallback - rightFallback;
    return left.index - right.index; // 同类保持原声明顺序
  });

  for (const { edge } of ordered) {
    if (isFallbackEdge(edge)) {
      // 兜底边只有走到它时才命中。
      return { kind: "target", edge };
    }
    const result = evaluateGraphConditionResult(edge.condition ?? null, state.vars);
    if (!result.ok) return { kind: "error", message: `出口条件无效（${edge.id}）：${result.message}` };
    if (result.value) {
      return { kind: "target", edge };
    }
  }

  return { kind: "error", message: "多条出口没有命中的条件，且缺少兜底边。" };
}

function isFallbackEdge(edge: GraphEdgeData): boolean {
  return !edge.condition || edge.condition.trim().length === 0;
}

export function evaluateGraphCondition(
  condition: string | null | undefined,
  vars: Record<string, GraphRouteValue>,
): boolean {
  const result = evaluateGraphConditionResult(condition, vars);
  return result.ok ? result.value : false;
}

export type ConditionEvaluationResult =
  | { ok: true; value: boolean }
  | { ok: false; code: "invalid_condition"; message: string };

export function evaluateGraphConditionResult(
  condition: string | null | undefined,
  vars: Record<string, GraphRouteValue>,
): ConditionEvaluationResult {
  const source = condition?.trim();
  if (!source) return { ok: true, value: true };
  try {
    const result = evaluateExpressionValue(parseExpression(source), vars);
    return result.ok
      ? { ok: true, value: truthy(result.value) }
      : { ok: false, code: "invalid_condition", message: result.message };
  } catch (error) {
    return { ok: false, code: "invalid_condition", message: error instanceof Error ? error.message : String(error) };
  }
}
