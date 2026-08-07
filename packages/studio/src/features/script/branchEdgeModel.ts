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
 * 图视图边上的 choice 选项标注（Spec 35 Phase 4）。
 *
 * 一条图边可能对应多个 choice 选项（多个选项指向同一目标节点）。
 * `options` 为空表示该边不是 choice 边。
 */
export interface EdgeChoiceAnnotation {
  /** 边类型。 */
  kind: EdgeKind;
  /** 匹配到该边的 choice 选项文案列表（choice 边才有）。 */
  options: string[];
}

/**
 * 为图里每条边构建 choice 选项标注。
 *
 * 遍历每个节点的指令树，找到 `choice` 指令的每个有 `to` 的 option，
 * 按 `from === nodeId && to === option.to` 匹配到对应的图边。
 * 同一条边可能被多个 option 命中（多选项指向同一节点）。
 *
 * @returns `Map<edgeId, EdgeChoiceAnnotation>`
 */
export function buildEdgeChoiceAnnotations(
  graph: ProjectGraph,
  nodes: NodeEntry[] | undefined,
  _t: StudioTranslator = translateZhCN,
): Map<string, EdgeChoiceAnnotation> {
  const annotations = new Map<string, EdgeChoiceAnnotation>();
  if (!nodes) return annotations;

  // 先收集每条边的 choice 选项文案。
  const edgeOptions = new Map<string, string[]>();

  for (const node of graph.nodes) {
    const entry = nodes.find((e) => e.relPath === node.file);
    if (!entry?.data || !Array.isArray(entry.data)) continue;
    const nodeTitle = new Map(graph.nodes.map((n) => [n.id, n.title]));
    for (const choiceInstr of collectChoiceInstructions(entry.data as Instruction[])) {
      for (const option of choiceInstr.options) {
        if (!option.to) continue;
        const edge = graph.edges.find((e) => e.from === node.id && e.to === option.to);
        if (!edge) continue;
        const label = option.text || nodeTitle.get(option.to) || option.to;
        const list = edgeOptions.get(edge.id) ?? [];
        list.push(label);
        edgeOptions.set(edge.id, list);
      }
    }
  }

  // 构建标注。
  for (const edge of graph.edges) {
    // Keep edge-kind derivation in one place so labels and edge metadata cannot
    // disagree about nested choice targets.
    const kind = deriveEdgeKind(graph, nodes, edge);
    const options = edgeOptions.get(edge.id) ?? [];
    if (kind === "choice" || options.length > 0) {
      annotations.set(edge.id, { kind, options });
    } else if (kind === "auto") {
      annotations.set(edge.id, { kind, options: [] });
    }
    // linear 边不标注（减少视觉噪音）。
  }
  return annotations;
}

/** 递归收集节点指令树里的所有 choice 指令（进入 if.then/else、choice.body）。 */
function collectChoiceInstructions(instructions: Instruction[]): Extract<Instruction, { t: "choice" }>[] {
  const results: Extract<Instruction, { t: "choice" }>[] = [];
  const scan = (list: Instruction[]) => {
    for (const instr of list) {
      if (instr.t === "choice") {
        results.push(instr);
        for (const opt of instr.options) {
          if (opt.body) scan(opt.body);
        }
      } else if (instr.t === "if") {
        scan(instr.then);
        if (instr.else) scan(instr.else);
      }
    }
  };
  scan(instructions);
  return results;
}

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
  return collectChoiceInstructions(entry.data as Instruction[])
    .some((choice) => choice.options.some((option) => option.to === targetNodeId));
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

/** 更新一个出口的原始条件，并保持兜底出口位于最后。 */
export function replaceEdgeCondition(edges: GraphEdge[], edgeId: string, source: string): GraphEdge[] {
  const condition = source.trim() || null;
  return orderDefaultAutoEdgeLast(edges.map((edge) => (
    edge.id === edgeId ? { ...edge, condition } : edge
  )));
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
