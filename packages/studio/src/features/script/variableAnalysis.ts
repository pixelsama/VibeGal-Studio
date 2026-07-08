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

export function analyzeGraphVariables(graph: ProjectGraph, nodeEntries?: NodeEntry[]): VariableAnalysisReport {
  const nodesByFile = new Map(graph.nodes.map((node) => [node.file, node]));
  const variableMap = new Map<string, { types: Set<VariableValueType>; writes: VariableUsagePoint[]; reads: VariableUsagePoint[] }>();
  const parseIssues: VariableParseIssue[] = [];

  for (const entry of nodeEntries ?? []) {
    const node = nodesByFile.get(entry.relPath);
    if (!node || !Array.isArray(entry.data)) continue;
    entry.data.forEach((instruction, instructionIndex) => {
      const obj = typeof instruction === "object" && instruction != null ? instruction as Record<string, unknown> : null;
      if (!obj || obj.t !== "set" || typeof obj.key !== "string") return;
      const slot = ensureVariable(variableMap, obj.key);
      slot.types.add(inferVariableValueType(obj.value));
      slot.writes.push({
        nodeId: node.id,
        file: `content/${node.file}`,
        jsonPath: `$[${instructionIndex}].value`,
        instructionIndex,
        preview: `set ${obj.key}`,
      });
    });
  }

  graph.edges.forEach((edge, index) => {
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
    const issues: VariableIssue[] = [];
    if (data.reads.length > 0 && data.writes.length === 0) {
      issues.push({ code: "read_before_write", message: "条件读取了未赋值变量", severity: "error" });
    }
    if (data.writes.length > 0 && data.reads.length === 0) {
      issues.push({ code: "write_without_read", message: "变量已写入但没有被条件读取", severity: "warn" });
    }
    if (types.filter((type) => type !== "unknown").length > 1) {
      issues.push({ code: "type_conflict", message: "变量被写成了多种类型", severity: "warn" });
    }
    return { name, types, writes: data.writes, reads: data.reads, issues };
  }).sort((left, right) => left.name.localeCompare(right.name));

  return { variables, parseIssues };
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
}

export function buildRouteCoverage(graph: ProjectGraph): RouteCoverageSummary {
  const reachable = collectReachableNodeIds(graph);
  const outgoingCounts = new Map<string, number>();
  const incomingCounts = new Map<string, number>();
  graph.edges.forEach((edge) => {
    outgoingCounts.set(edge.from, (outgoingCounts.get(edge.from) ?? 0) + 1);
    incomingCounts.set(edge.to, (incomingCounts.get(edge.to) ?? 0) + 1);
  });

  return {
    totalNodes: graph.nodes.length,
    reachableNodes: reachable.size,
    endingNodes: graph.nodes.filter((node) => reachable.has(node.id) && (outgoingCounts.get(node.id) ?? 0) === 0).length,
    orphanNodes: graph.nodes.filter((node) => (incomingCounts.get(node.id) ?? 0) === 0 && (outgoingCounts.get(node.id) ?? 0) === 0).length,
  };
}

function collectReachableNodeIds(graph: ProjectGraph): Set<string> {
  if (!graph.entryNodeId || !graph.nodes.some((node) => node.id === graph.entryNodeId)) return new Set();
  const adjacency = new Map<string, string[]>();
  graph.nodes.forEach((node) => adjacency.set(node.id, []));
  graph.edges.forEach((edge) => adjacency.get(edge.from)?.push(edge.to));
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
