/**
 * 出口边的纯函数模型（Spec 35 Phase 3）。
 *
 * 原 `BranchRules.tsx` 既有 UI 又有纯函数。Phase 3 删除 BranchRules 组件后，
 * 这些纯函数（求值 / 排序 / 移动 / 目标标题）被 ExitRoutingBlock 复用，
 * 所以搬到这个无 UI 依赖的模块。
 *
 * Spec 35 后图边不再有 `mode`/`label` 字段。出口类型（choice / auto / linear）
 * 由 `deriveEdgeKind` 从节点指令树 + 出口数量派生，不再存于边本身。
 */
import { evaluateGraphConditionResult, type Instruction } from "@vibegal/engine";
import type { GraphEdge, NodeEntry, ProjectGraph } from "../../lib/types";
import { translateZhCN, type StudioTranslator } from "../../lib/i18n";

// ── 边类型派生 ─────────────────────────────────────────────────────────

export type EdgeKind = "choice" | "auto" | "linear";

/**
 * 从节点指令树 + 出口数量派生单条边的类型。
 *
 * - 若源节点的指令树含 `choice` 指令且某 option 的 `to === edge.to` -> `"choice"`。
 * - 否则按源节点 outgoing 边数：1 条 -> `"linear"`；多条 -> `"auto"`（条件分支）。
 *
 * 不读 `edge.mode`（Phase 3 已删除该字段）。
 */
export function deriveEdgeKind(
  graph: ProjectGraph,
  nodes: NodeEntry[] | undefined,
  edge: GraphEdge,
): EdgeKind {
  if (hasChoiceOptionTargeting(graph, nodes, edge.from, edge.to)) {
    return "choice";
  }
  const outgoing = graph.edges.filter((e) => e.from === edge.from);
  return outgoing.length > 1 ? "auto" : "linear";
}

/**
 * 递归扫描节点指令树，判断是否存在 `choice` 指令的某 option `to === targetNodeId`。
 */
function hasChoiceOptionTargeting(
  graph: ProjectGraph,
  nodes: NodeEntry[] | undefined,
  sourceNodeId: string,
  targetNodeId: string,
): boolean {
  const node = graph.nodes.find((n) => n.id === sourceNodeId);
  if (!node || !nodes) return false;
  const entry = nodes.find((e) => e.relPath === node.file);
  if (!entry?.data) return false;
  return scanChoiceOptions(entry.data as Instruction[], targetNodeId);
}

function scanChoiceOptions(instructions: Instruction[], targetNodeId: string): boolean {
  for (const instr of instructions) {
    if (instr.t === "choice") {
      if (instr.options.some((opt) => opt.to === targetNodeId)) return true;
    }
    // 递归进入 if.then / if.else
    if (instr.t === "if") {
      if (scanChoiceOptions(instr.then, targetNodeId)) return true;
      if (instr.else && scanChoiceOptions(instr.else, targetNodeId)) return true;
    }
    // 递归进入 choice option body
    if (instr.t === "choice") {
      for (const opt of instr.options) {
        if (opt.body && scanChoiceOptions(opt.body, targetNodeId)) return true;
      }
    }
  }
  return false;
}

// ── 试算 ───────────────────────────────────────────────────────────────

export interface BranchOutcome {
  /** 按试算值，这条是实际胜出的分支。 */
  winner: boolean;
  /** 需要作者处理的问题；null 表示这条没问题。 */
  problem: BranchProblem | null;
}

export interface BranchProblem {
  message: string;
  severity: "error" | "warn";
}

/**
 * 逐条求值，模拟运行时「首个命中者胜出」。
 *
 * 两个独立结论：
 * - winner：按这组试算值实际会走哪条；换一组值就会变。
 * - problem：与试算值无关的结构问题。只有当前面某条【恒真】（空条件或不引用
 *   任何状态且求值为真）时，后面的分支才是真的永远走不到；仅仅是这次没轮到它
 *   不算问题，否则每换一组试算值就会冒出一片假警告。
 *
 * 与运行时同源：都走 evaluateGraphConditionResult，所以试算结论和实际播放一致。
 */
export function evaluateBranchOutcomes(
  edges: GraphEdge[],
  values: Record<string, string | number | boolean | null>,
  t: StudioTranslator = translateZhCN,
): BranchOutcome[] {
  let decided = false;
  let unreachableFrom: number | null = null;

  return edges.map((edge, index) => {
    const result = evaluateGraphConditionResult(edge.condition ?? null, values);

    if (!result.ok) {
      return {
        winner: false,
        problem: {
          message: t("script.branch.evaluationFailed", { detail: result.message }),
          severity: "error",
        },
      };
    }

    const problem = unreachableFrom != null
      ? {
        message: t("script.branch.unreachable", { number: unreachableFrom + 1 }),
        severity: "warn" as const,
      }
      : null;

    if (unreachableFrom == null && alwaysTrue(edge.condition)) unreachableFrom = index;

    const winner = !decided && result.value;
    if (winner) decided = true;
    return { winner, problem };
  });
}

/** 恒真：空条件，或不引用任何状态也能求值为真（如 `true`）。 */
function alwaysTrue(condition: string | null | undefined): boolean {
  const source = condition?.trim();
  if (!source) return true;
  const result = evaluateGraphConditionResult(source, {});
  return result.ok && result.value;
}

// ── 边排序模型（沿用既有语义，行为不变）─────────────────────────────────

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

/** 兜底分支永远排在最后，否则它后面的条件永远没机会求值。 */
export function orderDefaultAutoEdgeLast(edges: GraphEdge[]): GraphEdge[] {
  return [...edges.filter((edge) => edge.condition?.trim()), ...edges.filter((edge) => !edge.condition?.trim())];
}

export function targetTitle(
  graph: ProjectGraph,
  nodeId: string,
  t: StudioTranslator = translateZhCN,
): string {
  return graph.nodes.find((node) => node.id === nodeId)?.title
    || nodeId
    || t("script.branch.unselected");
}
