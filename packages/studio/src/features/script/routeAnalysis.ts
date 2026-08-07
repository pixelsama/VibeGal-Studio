import type { Instruction, Manifest, VariableRegistry } from "@vibegal/engine";
import { evaluateAssignmentExpression, evaluateGraphConditionResult } from "@vibegal/engine";
import type { NodeEntry, ProjectGraph } from "../../lib/types";

export type Reachability = "reachable" | "unreachable" | "unknown";
export interface EndingRouteCell { endingId: string; title: string; reachability: Reachability; witness?: string[]; reason?: string }
export interface EndingRouteMatrix {
  columns: Array<{ id: string; title: string; startNodeId: string }>;
  rows: Array<{ endingId: string; title: string; cells: EndingRouteCell[] }>;
}

export function analyzeEndingRoutes(input: {
  graph: ProjectGraph;
  nodes?: NodeEntry[];
  manifest: Manifest;
  variables?: VariableRegistry;
  transitionBudget?: number;
}): EndingRouteCell[] {
  return analyzeEndingRoutesFrom(input, input.graph.entryNodeId);
}

export function analyzeEndingRouteMatrix(input: Parameters<typeof analyzeEndingRoutes>[0]): EndingRouteMatrix {
  const columns = [
    { id: "entry", title: "入口", startNodeId: input.graph.entryNodeId },
    // Spec 35 Phase 3：路由矩阵列从节点 choice 指令的 options 派生，不再读 edge.mode/label。
    ...collectChoiceOptionColumns(input.graph, input.nodes),
  ];
  const results = columns.map((column) => analyzeEndingRoutesFrom(input, column.startNodeId));
  return {
    columns,
    rows: Object.entries(input.manifest.unlocks?.endings ?? {}).map(([endingId, ending]) => ({
      endingId,
      title: ending.title,
      cells: results.map((result) => result.find((cell) => cell.endingId === endingId) ?? {
        endingId, title: ending.title, reachability: "unknown", reason: "分析未产生结果",
      }),
    })),
  };
}

export function collectUnregisteredTerminals(graph: ProjectGraph, manifest: Manifest, nodes?: NodeEntry[]): Array<{ nodeId: string; title: string }> {
  const registered = new Set(Object.values(manifest.unlocks?.endings ?? {}).map((ending) => ending.nodeId).filter(Boolean));
  const reachable = structurallyReachable(graph, graph.entryNodeId, nodes);
  return graph.nodes.filter((node) => reachable.has(node.id)
    && !graph.edges.some((edge) => edge.from === node.id)
    && !hasChoiceTargetsFromNode(graph, nodes, node.id)
    && !registered.has(node.id))
    .map((node) => ({ nodeId: node.id, title: node.title }));
}

function analyzeEndingRoutesFrom(input: Parameters<typeof analyzeEndingRoutes>[0], startNodeId: string): EndingRouteCell[] {
  const budget = input.transitionBudget ?? 2_000;
  const instructions = new Map<string, Instruction[]>();
  const nodeByFile = new Map(input.graph.nodes.map((node) => [node.file, node.id]));
  for (const entry of input.nodes ?? []) {
    const nodeId = nodeByFile.get(entry.relPath);
    if (nodeId && Array.isArray(entry.data)) instructions.set(nodeId, entry.data as Instruction[]);
  }
  const defaults = Object.fromEntries(Object.entries(input.variables?.variables ?? {}).map(([name, declaration]) => [name, declaration.default]));
  const found = new Map<string, string[]>();
  let uncertain = false;
  let transitions = 0;
  const queue = startNodeId ? [{ nodeId: startNodeId, vars: defaults, path: [startNodeId] }] : [];
  const seen = new Set<string>();

  while (queue.length > 0 && transitions++ < budget) {
    const current = queue.shift()!;
    const key = `${current.nodeId}:${JSON.stringify(current.vars)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const localStates = executeInstructionSequence(instructions.get(current.nodeId) ?? [], { vars: { ...current.vars } }, {
      onEnding: (endingId) => {
        if (!found.has(endingId)) found.set(endingId, current.path);
      },
      markUncertain: () => { uncertain = true; },
    });
    const outgoing = input.graph.edges.filter((edge) => edge.from === current.nodeId);
    // 出口效果在进入目标节点前生效，静态推演必须同样建模，否则结局可达矩阵会
    // 漏掉「靠选项加分才够格」的路线。
    const varsAfter = (edge: ProjectGraph["edges"][number], sourceVars: Record<string, string | number | boolean | null>) => {
      const next = { ...sourceVars };
      for (const effect of edge.effects ?? []) {
        if ("value" in effect) next[effect.key] = effect.value ?? null;
        else if (effect.expr != null) {
          try {
            next[effect.key] = evaluateAssignmentExpression(effect.expr, next);
          } catch {
            uncertain = true;
          }
        }
      }
      return next;
    };
    for (const local of localStates) {
      if (local.jumpTo) {
        queue.push({ nodeId: local.jumpTo, vars: local.vars, path: [...current.path, local.jumpTo] });
        continue;
      }
      if (outgoing.length > 1) {
        let matched = false;
        for (const edge of orderRouteEdges(outgoing)) {
          const result = evaluateGraphConditionResult(edge.condition, local.vars);
          if (!result.ok) {
            uncertain = true;
            queue.push({ nodeId: edge.to, vars: varsAfter(edge, local.vars), path: [...current.path, edge.to] });
            continue;
          }
          if (result.value) {
            queue.push({ nodeId: edge.to, vars: varsAfter(edge, local.vars), path: [...current.path, edge.to] });
            matched = true;
            break;
          }
        }
        if (!matched && outgoing.length > 0) uncertain = true;
      } else {
        for (const edge of outgoing) queue.push({ nodeId: edge.to, vars: varsAfter(edge, local.vars), path: [...current.path, edge.to] });
      }
    }
  }
  if (queue.length > 0) uncertain = true;

  return Object.entries(input.manifest.unlocks?.endings ?? {}).map(([endingId, ending]) => {
    const witness = found.get(endingId);
    if (witness) return { endingId, title: ending.title, reachability: "reachable", witness };
    if (ending.nodeId && seenHasNode(seen, ending.nodeId)) return { endingId, title: ending.title, reachability: "unknown", reason: "关联节点可达，但没有结算指令" };
    return { endingId, title: ending.title, reachability: uncertain ? "unknown" : "unreachable", reason: uncertain ? "条件或预算无法证明" : "完整有界分析未找到路径" };
  });
}

function seenHasNode(seen: Set<string>, nodeId: string) { return [...seen].some((key) => key.startsWith(`${nodeId}:`)); }

type LocalExecutionState = {
  vars: Record<string, string | number | boolean | null>;
  jumpTo?: string;
};

function executeInstructionSequence(
  instructions: readonly Instruction[],
  initial: LocalExecutionState,
  context: { onEnding: (endingId: string) => void; markUncertain: () => void },
): LocalExecutionState[] {
  let states: LocalExecutionState[] = [initial];
  for (const instruction of instructions) {
    const next: LocalExecutionState[] = [];
    for (const state of states) {
      if (state.jumpTo) {
        next.push(state);
        continue;
      }
      if (instruction.t === "set") {
        const vars = { ...state.vars };
        if ("value" in instruction) vars[instruction.key] = instruction.value ?? null;
        else if (instruction.expr != null) {
          try {
            vars[instruction.key] = evaluateAssignmentExpression(instruction.expr, vars);
          } catch {
            context.markUncertain();
          }
        }
        next.push({ ...state, vars });
        continue;
      }
      if (instruction.t === "completeEnding") {
        context.onEnding(instruction.endingId);
        next.push(state);
        continue;
      }
      if (instruction.t === "if") {
        const condition = evaluateGraphConditionResult(instruction.condition, state.vars);
        if (!condition.ok) {
          context.markUncertain();
          next.push(...executeInstructionSequence(instruction.then, state, context));
          if (instruction.else) next.push(...executeInstructionSequence(instruction.else, state, context));
        } else {
          const branch = condition.value ? instruction.then : (instruction.else ?? []);
          next.push(...executeInstructionSequence(branch, state, context));
        }
        continue;
      }
      if (instruction.t === "choice") {
        for (const option of instruction.options) {
          let optionStates = executeInstructionSequence(option.effects ?? [], { vars: { ...state.vars } }, context);
          optionStates = optionStates.flatMap((optionState) => option.body
            ? executeInstructionSequence(option.body, optionState, context)
            : [optionState]);
          optionStates.forEach((optionState) => {
            next.push(optionState.jumpTo || !option.to
              ? optionState
              : { ...optionState, jumpTo: option.to });
          });
        }
        continue;
      }
      next.push(state);
    }
    states = next;
  }
  return states;
}

function orderRouteEdges(edges: ProjectGraph["edges"]): ProjectGraph["edges"] {
  return edges
    .map((edge, index) => ({ edge, index }))
    .sort((left, right) => {
      const leftFallback = left.edge.condition?.trim() ? 0 : 1;
      const rightFallback = right.edge.condition?.trim() ? 0 : 1;
      return leftFallback - rightFallback || left.index - right.index;
    })
    .map(({ edge }) => edge);
}

/** 从节点 choice 指令的 options 构建路由矩阵列。 */
function collectChoiceOptionColumns(graph: ProjectGraph, nodes?: NodeEntry[]): Array<{ id: string; title: string; startNodeId: string }> {
  if (!nodes) return [];
  const nodeByFile = new Map(graph.nodes.map((node) => [node.file, node.id]));
  const columns: Array<{ id: string; title: string; startNodeId: string }> = [];
  for (const entry of nodes) {
    const nodeId = nodeByFile.get(entry.relPath);
    if (!nodeId || !Array.isArray(entry.data)) continue;
    for (const choice of collectChoiceInstructions(entry.data as Instruction[])) {
      choice.options.forEach((option, index) => {
        if (!option.to) return;
        columns.push({
          id: `choice:${choice.id ?? nodeId}:${index}`,
          title: option.text || option.to,
          startNodeId: option.to,
        });
      });
    }
  }
  return columns;
}

function collectChoiceInstructions(instructions: Instruction[]): Extract<Instruction, { t: "choice" }>[] {
  const results: Extract<Instruction, { t: "choice" }>[] = [];
  for (const instr of instructions) {
    if (instr.t === "choice") {
      results.push(instr);
      for (const opt of instr.options) {
        if (opt.body) results.push(...collectChoiceInstructions(opt.body));
      }
    } else if (instr.t === "if") {
      results.push(...collectChoiceInstructions(instr.then));
      if (instr.else) results.push(...collectChoiceInstructions(instr.else));
    }
  }
  return results;
}

function structurallyReachable(graph: ProjectGraph, startNodeId: string, nodes?: NodeEntry[]): Set<string> {
  const seen = new Set<string>();
  const queue = startNodeId ? [startNodeId] : [];
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (seen.has(nodeId)) continue;
    seen.add(nodeId);
    for (const edge of graph.edges.filter((candidate) => candidate.from === nodeId)) queue.push(edge.to);
    for (const target of collectChoiceTargetsForNode(graph, nodes, nodeId)) queue.push(target);
  }
  return seen;
}

function hasChoiceTargetsFromNode(graph: ProjectGraph, nodes: NodeEntry[] | undefined, nodeId: string): boolean {
  return collectChoiceTargetsForNode(graph, nodes, nodeId).length > 0;
}

function collectChoiceTargetsForNode(graph: ProjectGraph, nodes: NodeEntry[] | undefined, nodeId: string): string[] {
  if (!nodes) return [];
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  const entry = node ? nodes.find((candidate) => candidate.relPath === node.file) : undefined;
  if (!entry?.data || !Array.isArray(entry.data)) return [];
  return collectChoiceInstructions(entry.data as Instruction[])
    .flatMap((choice) => choice.options.map((option) => option.to).filter((target): target is string => Boolean(target)));
}
