import type { Instruction, VariableRegistry } from "@vibegal/engine";
import type { NodeEntry, ProjectGraph } from "../../lib/types";
import { parseGraphCondition, collectConditionVariables } from "./graphCondition";

export type VariableValueType = "string" | "number" | "boolean" | "null" | "unknown";

export interface VariableUsagePoint {
  nodeId?: string;
  edgeId?: string;
  file: string;
  jsonPath: string;
  instructionIndex?: number;
  preview: string;
}

export interface VariableIssue {
  code: "read_before_write" | "write_without_read" | "type_conflict";
  message: string;
  severity: "error" | "warn";
}

export interface VariableEntry {
  name: string;
  types: VariableValueType[];
  writes: VariableUsagePoint[];
  reads: VariableUsagePoint[];
  issues: VariableIssue[];
}

export interface VariableParseIssue {
  edgeId: string;
  nodeId: string;
  file: string;
  jsonPath: string;
  message: string;
}

export interface VariableAnalysisReport {
  variables: VariableEntry[];
  parseIssues: VariableParseIssue[];
}

export function analyzeGraphVariables(
  graph: ProjectGraph,
  nodeEntries?: NodeEntry[],
  registry?: VariableRegistry,
): VariableAnalysisReport {
  const nodesByFile = new Map(graph.nodes.map((node) => [node.file, node]));
  const variableMap = new Map<string, { types: Set<VariableValueType>; writes: VariableUsagePoint[]; reads: VariableUsagePoint[] }>();
  const parseIssues: VariableParseIssue[] = [];

  for (const entry of nodeEntries ?? []) {
    const node = nodesByFile.get(entry.relPath);
    if (!node || !Array.isArray(entry.data)) continue;
    visitInstructionTree(entry.data as Instruction[], (instruction, jsonPath, instructionIndex) => {
      if (instruction.t === "set" && typeof instruction.key === "string") {
        const slot = ensureVariable(variableMap, instruction.key);
        slot.types.add(inferVariableValueType("value" in instruction ? instruction.value : undefined));
        slot.writes.push({
          nodeId: node.id,
          file: `content/${node.file}`,
          jsonPath: `${jsonPath}.value`,
          instructionIndex,
          preview: `set ${instruction.key}`,
        });
        if (instruction.expr) collectInstructionExpressionReads(instruction.expr, node, instructionIndex, jsonPath, variableMap);
      }
      if (instruction.t === "if") {
        collectInstructionExpressionReads(instruction.condition, node, instructionIndex, jsonPath, variableMap);
      }
    });
  }

  graph.edges.forEach((edge, index) => {
    // 出口效果是写入点：不计入的话「没有任何地方改变它」会误报。
    (edge.effects ?? []).forEach((effect, effectIndex) => {
      if (typeof effect.key !== "string") return;
      const slot = ensureVariable(variableMap, effect.key);
      slot.types.add(inferVariableValueType("value" in effect ? effect.value : undefined));
      slot.writes.push({
        nodeId: edge.from,
        edgeId: edge.id,
        file: "content/graph.json",
        jsonPath: `$.edges[${index}].effects[${effectIndex}]`,
        preview: `走这条出口后 ${effect.key}`,
      });
    });

    const condition = edge.condition?.trim();
    if (!condition) return;
    const parsed = parseGraphCondition(condition);
    if (!parsed.ok) {
      parseIssues.push({
        edgeId: edge.id,
        nodeId: edge.from,
        file: "content/graph.json",
        jsonPath: `$.edges[${index}].condition`,
        message: parsed.error,
      });
      return;
    }
    collectConditionVariables(parsed.ast).forEach((name) => {
      const slot = ensureVariable(variableMap, name);
      slot.reads.push({
        nodeId: edge.from,
        edgeId: edge.id,
        file: "content/graph.json",
        jsonPath: `$.edges[${index}].condition`,
        preview: condition,
      });
    });
  });

  const variables = Array.from(variableMap, ([name, data]) => {
    const types = Array.from(data.types).sort();
    const declaration = registry?.variables[name];
    const issues: VariableIssue[] = [];
    if (data.reads.length > 0 && data.writes.length === 0) {
      issues.push({ code: "read_before_write", message: "条件读取了未赋值变量", severity: "error" });
    }
    // 声明为「仅用于界面显示」的状态本来就不参与分流，不该报没人读。
    if (data.writes.length > 0 && data.reads.length === 0 && !declaration?.displayOnly) {
      issues.push({ code: "write_without_read", message: "变量已写入但没有被条件读取", severity: "warn" });
    }
    if (types.filter((type) => type !== "unknown").length > 1) {
      issues.push({ code: "type_conflict", message: "变量被写成了多种类型", severity: "warn" });
    }
    return { name, types, writes: data.writes, reads: data.reads, issues };
  }).sort((left, right) => left.name.localeCompare(right.name));

  return { variables, parseIssues };
}

function visitInstructionTree(
  instructions: Instruction[],
  visit: (instruction: Instruction, jsonPath: string, instructionIndex: number) => void,
  path = "$",
  rootIndex?: number,
) {
  instructions.forEach((instruction, index) => {
    const jsonPath = `${path}[${index}]`;
    const instructionIndex = rootIndex ?? index;
    visit(instruction, jsonPath, instructionIndex);
    if (instruction.t === "if") {
      visitInstructionTree(instruction.then, visit, `${jsonPath}.then`, instructionIndex);
      if (instruction.else) visitInstructionTree(instruction.else, visit, `${jsonPath}.else`, instructionIndex);
    } else if (instruction.t === "choice") {
      instruction.options.forEach((option, optionIndex) => {
        if (option.effects) visitInstructionTree(option.effects, visit, `${jsonPath}.options[${optionIndex}].effects`, instructionIndex);
        if (option.body) visitInstructionTree(option.body, visit, `${jsonPath}.options[${optionIndex}].body`, instructionIndex);
      });
    }
  });
}

function collectInstructionExpressionReads(
  source: string,
  node: ProjectGraph["nodes"][number],
  instructionIndex: number,
  jsonPath: string,
  variableMap: Map<string, { types: Set<VariableValueType>; writes: VariableUsagePoint[]; reads: VariableUsagePoint[] }>,
) {
  const parsed = parseGraphCondition(source);
  if (!parsed.ok) return;
  collectConditionVariables(parsed.ast).forEach((name) => {
    const slot = ensureVariable(variableMap, name);
    slot.reads.push({
      nodeId: node.id,
      file: `content/${node.file}`,
      jsonPath,
      instructionIndex,
      preview: source,
    });
  });
}

function ensureVariable(
  variableMap: Map<string, { types: Set<VariableValueType>; writes: VariableUsagePoint[]; reads: VariableUsagePoint[] }>,
  name: string,
) {
  const existing = variableMap.get(name);
  if (existing) return existing;
  const created = { types: new Set<VariableValueType>(), writes: [], reads: [] };
  variableMap.set(name, created);
  return created;
}

function inferVariableValueType(value: unknown): VariableValueType {
  if (value === null) return "null";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "unknown";
}

export interface RouteCoverageSummary {
  totalNodes: number;
  reachableNodes: number;
  endingNodes: number;
  orphanNodes: number;
  choiceBranches: ChoiceBranchCoverage[];
  autoBranches: AutoBranchCoverage[];
}

export interface ChoiceBranchCoverage {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  label: string;
  reachesEnding: boolean;
  endingNodeIds: string[];
}

export interface AutoBranchCoverage {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  condition: string | null;
  conditionState: "default" | "unknown" | "invalid" | "always" | "never";
  reachesEnding: boolean;
  endingNodeIds: string[];
}

export function buildRouteCoverage(graph: ProjectGraph, nodes?: NodeEntry[]): RouteCoverageSummary {
  const reachable = collectReachableNodeIds(graph, nodes);
  const outgoingCounts = new Map<string, number>();
  const incomingCounts = new Map<string, number>();
  const outgoingByNode = new Map<string, ProjectGraph["edges"]>();
  graph.nodes.forEach((node) => outgoingByNode.set(node.id, []));
  graph.edges.forEach((edge) => {
    outgoingCounts.set(edge.from, (outgoingCounts.get(edge.from) ?? 0) + 1);
    incomingCounts.set(edge.to, (incomingCounts.get(edge.to) ?? 0) + 1);
    outgoingByNode.get(edge.from)?.push(edge);
  });
  const choiceOptionEdges = collectChoiceOptionEdges(graph, nodes);
  for (const choiceEdge of choiceOptionEdges) {
    // A choice option may already have a matching graph edge. That edge is
    // already represented in the structural counts; only add a synthetic
    // adjacency entry when the graph intentionally omits it.
    if (!choiceEdge.synthetic) continue;
    outgoingCounts.set(choiceEdge.fromNodeId, (outgoingCounts.get(choiceEdge.fromNodeId) ?? 0) + 1);
    incomingCounts.set(choiceEdge.toNodeId, (incomingCounts.get(choiceEdge.toNodeId) ?? 0) + 1);
    outgoingByNode.get(choiceEdge.fromNodeId)?.push({
      id: choiceEdge.edgeId,
      from: choiceEdge.fromNodeId,
      to: choiceEdge.toNodeId,
      condition: null,
    });
  }
  const endingNodeIds = graph.nodes
    .filter((node) => reachable.has(node.id) && (outgoingCounts.get(node.id) ?? 0) === 0)
    .map((node) => node.id)
    .sort();
  const endingNodeSet = new Set(endingNodeIds);
  const edgeEndingCache = new Map<string, string[]>();
  const endingsReachableFrom = (nodeId: string) =>
    collectEndingIdsFromNode(nodeId, outgoingByNode, endingNodeSet, edgeEndingCache);

  // Spec 35 Phase 3：choiceBranches 从节点 choice 指令的 options 派生，
  // autoBranches = 多出口且无 choice 指令的节点的 outgoing edges。
  const choiceNodeEdges = new Set(choiceOptionEdges.map((e) => e.edgeId));
  return {
    totalNodes: graph.nodes.length,
    reachableNodes: reachable.size,
    endingNodes: endingNodeIds.length,
    orphanNodes: graph.nodes.filter((node) => (incomingCounts.get(node.id) ?? 0) === 0 && (outgoingCounts.get(node.id) ?? 0) === 0).length,
    choiceBranches: choiceOptionEdges.map((entry) => {
      const endingIds = endingsReachableFrom(entry.toNodeId);
      return {
        edgeId: entry.edgeId,
        fromNodeId: entry.fromNodeId,
        toNodeId: entry.toNodeId,
        label: entry.label,
        reachesEnding: endingIds.length > 0,
        endingNodeIds: endingIds,
      };
    }),
    autoBranches: graph.edges
      .filter((edge) => !choiceNodeEdges.has(edge.id) && (outgoingCounts.get(edge.from) ?? 0) > 1)
      .map((edge) => {
        const endingIds = endingsReachableFrom(edge.to);
        return {
          edgeId: edge.id,
          fromNodeId: edge.from,
          toNodeId: edge.to,
          condition: edge.condition,
          conditionState: classifyAutoCondition(edge.condition),
          reachesEnding: endingIds.length > 0,
          endingNodeIds: endingIds,
        };
      }),
  };
}

/** 从节点 choice 指令的 options 收集 choice 分支信息（用于 RouteCoverage）。 */
function collectChoiceOptionEdges(graph: ProjectGraph, nodes?: NodeEntry[]): Array<{
  edgeId: string; fromNodeId: string; toNodeId: string; label: string; synthetic: boolean;
}> {
  if (!nodes) return [];
  const nodeByFile = new Map(graph.nodes.map((node) => [node.file, node.id]));
  const nodeTitle = new Map(graph.nodes.map((node) => [node.id, node.title || node.id]));
  const results: Array<{ edgeId: string; fromNodeId: string; toNodeId: string; label: string; synthetic: boolean }> = [];
  for (const entry of nodes) {
    const nodeId = nodeByFile.get(entry.relPath);
    if (!nodeId || !Array.isArray(entry.data)) continue;
    for (const choice of collectChoiceInstructions(entry.data as Instruction[])) {
      choice.options.forEach((option, index) => {
        if (!option.to) return;
        // 匹配 graph edge：同一节点下 to 相同的边。
        const edge = graph.edges.find((e) => e.from === nodeId && e.to === option.to);
        results.push({
          edgeId: edge?.id ?? `${choice.id ?? nodeId}:${index}`,
          fromNodeId: nodeId,
          toNodeId: option.to,
          label: option.text || nodeTitle.get(option.to) || option.to,
          synthetic: !edge,
        });
      });
    }
  }
  return results;
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

function collectEndingIdsFromNode(
  startNodeId: string,
  outgoingByNode: Map<string, ProjectGraph["edges"]>,
  endingNodeIds: Set<string>,
  cache: Map<string, string[]>,
): string[] {
  const cached = cache.get(startNodeId);
  if (cached) return cached;

  const endings = new Set<string>();
  const stack = [startNodeId];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const nodeId = stack.pop()!;
    if (seen.has(nodeId)) continue;
    seen.add(nodeId);
    if (endingNodeIds.has(nodeId)) {
      endings.add(nodeId);
      continue;
    }
    (outgoingByNode.get(nodeId) ?? []).forEach((edge) => stack.push(edge.to));
  }

  const result = Array.from(endings).sort();
  cache.set(startNodeId, result);
  return result;
}

function classifyAutoCondition(condition: string | null | undefined): AutoBranchCoverage["conditionState"] {
  const source = condition?.trim();
  if (!source) return "default";
  const parsed = parseGraphCondition(source);
  if (!parsed.ok) return "invalid";
  if (parsed.ast.type === "literal") return parsed.ast.value ? "always" : "never";
  return "unknown";
}

function collectReachableNodeIds(graph: ProjectGraph, nodes?: NodeEntry[]): Set<string> {
  if (!graph.entryNodeId || !graph.nodes.some((node) => node.id === graph.entryNodeId)) return new Set();
  const adjacency = new Map<string, string[]>();
  graph.nodes.forEach((node) => adjacency.set(node.id, []));
  graph.edges.forEach((edge) => adjacency.get(edge.from)?.push(edge.to));
  for (const entry of nodes ?? []) {
    const node = graph.nodes.find((candidate) => candidate.file === entry.relPath);
    if (!node || !Array.isArray(entry.data)) continue;
    for (const choice of collectChoiceInstructions(entry.data as Instruction[])) {
      for (const option of choice.options) {
        if (option.to) adjacency.get(node.id)?.push(option.to);
      }
    }
  }
  const seen = new Set<string>();
  const stack = [graph.entryNodeId];
  while (stack.length > 0) {
    const nodeId = stack.pop()!;
    if (seen.has(nodeId)) continue;
    seen.add(nodeId);
    (adjacency.get(nodeId) ?? []).forEach((next) => stack.push(next));
  }
  return seen;
}
