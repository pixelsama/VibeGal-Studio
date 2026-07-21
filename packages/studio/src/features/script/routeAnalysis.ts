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
    ...input.graph.edges.filter((edge) => (edge.mode ?? "linear") === "choice")
      .map((edge) => ({ id: `choice:${edge.id}`, title: edge.label?.trim() || edge.id, startNodeId: edge.to })),
  ];
  const results = columns.map((column) => analyzeEndingRoutesFrom(input, column.startNodeId));
  return {
    columns,
    rows: Object.entries(input.manifest.unlocks.endings).map(([endingId, ending]) => ({
      endingId,
      title: ending.title,
      cells: results.map((result) => result.find((cell) => cell.endingId === endingId) ?? {
        endingId, title: ending.title, reachability: "unknown", reason: "分析未产生结果",
      }),
    })),
  };
}

export function collectUnregisteredTerminals(graph: ProjectGraph, manifest: Manifest): Array<{ nodeId: string; title: string }> {
  const registered = new Set(Object.values(manifest.unlocks.endings).map((ending) => ending.nodeId).filter(Boolean));
  const reachable = structurallyReachable(graph, graph.entryNodeId);
  return graph.nodes.filter((node) => reachable.has(node.id)
    && !graph.edges.some((edge) => edge.from === node.id)
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
    const vars = { ...current.vars };
    for (const instruction of instructions.get(current.nodeId) ?? []) {
      if (instruction.t === "set" && "value" in instruction) vars[instruction.key] = instruction.value ?? null;
      if (instruction.t === "set" && "expr" in instruction && instruction.expr != null) {
        try {
          vars[instruction.key] = evaluateAssignmentExpression(instruction.expr, vars);
        } catch {
          uncertain = true;
        }
      }
      if (instruction.t === "completeEnding" && !found.has(instruction.endingId)) found.set(instruction.endingId, current.path);
    }
    const outgoing = input.graph.edges.filter((edge) => edge.from === current.nodeId);
    if (outgoing.every((edge) => (edge.mode ?? "linear") === "auto")) {
      let matched = false;
      for (const edge of outgoing) {
        const result = evaluateGraphConditionResult(edge.condition, vars);
        if (!result.ok) { uncertain = true; queue.push({ nodeId: edge.to, vars, path: [...current.path, edge.to] }); continue; }
        if (result.value) { queue.push({ nodeId: edge.to, vars, path: [...current.path, edge.to] }); matched = true; break; }
      }
      if (!matched && outgoing.length > 0) uncertain = true;
    } else {
      for (const edge of outgoing) queue.push({ nodeId: edge.to, vars, path: [...current.path, edge.to] });
    }
  }
  if (queue.length > 0) uncertain = true;

  return Object.entries(input.manifest.unlocks.endings).map(([endingId, ending]) => {
    const witness = found.get(endingId);
    if (witness) return { endingId, title: ending.title, reachability: "reachable", witness };
    if (ending.nodeId && seenHasNode(seen, ending.nodeId)) return { endingId, title: ending.title, reachability: "unknown", reason: "关联节点可达，但没有结算指令" };
    return { endingId, title: ending.title, reachability: uncertain ? "unknown" : "unreachable", reason: uncertain ? "条件或预算无法证明" : "完整有界分析未找到路径" };
  });
}

function seenHasNode(seen: Set<string>, nodeId: string) { return [...seen].some((key) => key.startsWith(`${nodeId}:`)); }

function structurallyReachable(graph: ProjectGraph, startNodeId: string): Set<string> {
  const seen = new Set<string>();
  const queue = startNodeId ? [startNodeId] : [];
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (seen.has(nodeId)) continue;
    seen.add(nodeId);
    for (const edge of graph.edges.filter((candidate) => candidate.from === nodeId)) queue.push(edge.to);
  }
  return seen;
}
