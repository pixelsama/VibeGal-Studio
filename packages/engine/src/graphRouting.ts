import type { GraphEdgeData } from "./types";
import type { NovelState } from "./state";

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

  if (source.startsWith("!")) {
    return !truthy(vars[source.slice(1).trim()]);
  }
  if (/^[A-Za-z_][\w.-]*$/.test(source)) {
    return truthy(vars[source]);
  }

  const match = source.match(/^([A-Za-z_][\w.-]*)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (!match) return false;

  const left = vars[match[1]];
  const right = parseConditionLiteral(match[3]);
  switch (match[2]) {
    case "==":
      return left === right;
    case "!=":
      return left !== right;
    case ">":
      return typeof left === "number" && typeof right === "number" && left > right;
    case "<":
      return typeof left === "number" && typeof right === "number" && left < right;
    case ">=":
      return typeof left === "number" && typeof right === "number" && left >= right;
    case "<=":
      return typeof left === "number" && typeof right === "number" && left <= right;
    default:
      return false;
  }
}

function parseConditionLiteral(raw: string): GraphRouteValue {
  const value = raw.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  const numberValue = Number(value);
  if (Number.isFinite(numberValue) && value !== "") return numberValue;
  return value;
}

function truthy(value: GraphRouteValue | undefined): boolean {
  return value === true || (typeof value === "number" && value !== 0) || (typeof value === "string" && value.length > 0);
}
