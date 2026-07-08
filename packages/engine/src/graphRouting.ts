import type { GraphEdgeData } from "./types";
import type { NovelState } from "./state";
import { evaluateExpression, parseExpression } from "./expression";

export type GraphRouteMode = "linear" | "choice" | "auto";
export type GraphRouteValue = string | number | boolean | null;

export type GraphRouteDecision =
  | { kind: "end" }
  | { kind: "target"; edge: GraphEdgeData }
  | { kind: "choice"; choices: { text: string; to: string }[] }
  | { kind: "error"; message: string };

export function decideGraphRoute(
  outgoingEdges: GraphEdgeData[],
  state: NovelState,
): GraphRouteDecision {
  if (outgoingEdges.length === 0) return { kind: "end" };

  const modes = new Set(outgoingEdges.map((edge) => edge.mode ?? "linear"));
  if (modes.size > 1) {
    return { kind: "error", message: "同一节点的出口不能混用 linear、choice 和 auto。" };
  }

  const mode = (outgoingEdges[0]?.mode ?? "linear") as GraphRouteMode;
  if (mode === "linear") {
    if (outgoingEdges.length > 1) {
      return { kind: "error", message: "linear 出口最多只能有一条边。" };
    }
    return { kind: "target", edge: outgoingEdges[0] };
  }

  if (mode === "choice") {
    return {
      kind: "choice",
      choices: outgoingEdges.map((edge) => ({
        text: edge.label?.trim() || edge.to,
        to: edge.to,
      })),
    };
  }

  for (const edge of outgoingEdges) {
    if (evaluateGraphCondition(edge.condition ?? null, state.vars)) {
      return { kind: "target", edge };
    }
  }

  return { kind: "error", message: "auto 出口没有命中的条件。" };
}

export function evaluateGraphCondition(
  condition: string | null | undefined,
  vars: Record<string, GraphRouteValue>,
): boolean {
  const source = condition?.trim();
  if (!source) return true;
  try {
    return evaluateExpression(parseExpression(source), vars);
  } catch {
    return false;
  }
}
