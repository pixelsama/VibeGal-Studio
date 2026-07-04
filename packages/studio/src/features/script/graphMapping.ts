import type { Edge, Node } from "@xyflow/react";
import type { GraphIssue, GraphReport, GraphNode, NodeEntry, ProjectGraph } from "../../lib/types";

export const NODE_TYPE = "galNode";

export interface FlowNodeData extends Record<string, unknown> {
  title: string;
  fileId: string;
  isEntry: boolean;
  duplicateNodeId?: boolean;
  status: GraphNodeStatus;
  incoming: number;
  outgoing: number;
}

/** graph node -> React Flow node */
export function mapGraphToFlow(
  graph: ProjectGraph,
  graphReport?: GraphReport,
  nodeEntries?: NodeEntry[],
): { nodes: Node<FlowNodeData, typeof NODE_TYPE>[]; edges: Edge[] } {
  const duplicateNodeIds = collectDuplicateNodeIds(graphReport);
  const choiceEdgeLabels = collectChoiceEdgeLabels(graph, nodeEntries);
  const suspiciousEdgeIds = new Set(
    graphReport?.graphIssues
      .filter((issue) => issue.code === "dangling_edge" && issue.edgeId)
      .map((issue) => issue.edgeId as string) ?? [],
  );

  const nodes: Node<FlowNodeData, typeof NODE_TYPE>[] = graph.nodes.map((node) => {
    // nodeEntries 未提供时（测试/旧调用），无法判定文件缺失，保守视为「有文件」。
    // 仅当明确提供 entries 且对应条目 data 为 null（后端确认文件缺失）时才判 missing-file。
    const entry = nodeEntries ? findNodeEntry(nodeEntries, node.file) : null;
    const hasFile = nodeEntries == null ? true : entry?.data != null;
    const { incoming, outgoing } = summarizeNodeConnections(graph, node.id);
    const baseStatus = deriveGraphNodeStatus(graph, node.id, { hasFile, duplicateNodeIds });
    const status = hasChoiceInstruction(entry?.data) && !["duplicate", "missing-file", "entry"].includes(baseStatus)
      ? "branch"
      : baseStatus;
    return {
      id: node.id,
      type: NODE_TYPE,
      position: node.position,
      data: {
        title: node.title,
        fileId: node.file,
        isEntry: status === "entry",
        status,
        incoming,
        outgoing,
        ...(duplicateNodeIds.has(node.id) ? { duplicateNodeId: true } : {}),
      },
    };
  });
  const edges: Edge[] = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    type: "smoothstep",
    label: choiceEdgeLabels.get(`${edge.from}\0${edge.to}`),
    data: {
      condition: edge.condition,
      ...(suspiciousEdgeIds.has(edge.id) ? { suspicious: true } : {}),
    },
  }));

  return { nodes, edges };
}

export function issueTargetsNode(issue: GraphIssue): string | null {
  return issue.nodeId ?? null;
}

/** 节点的可视状态。优先级见 deriveGraphNodeStatus。 */
export type GraphNodeStatus =
  | "duplicate"
  | "missing-file"
  | "entry"
  | "orphan"
  | "ending"
  | "branch"
  | "normal";

/** 单个节点的入/出边连接摘要。 */
export interface NodeConnectionSummary {
  incoming: number;
  outgoing: number;
}

/**
 * 为图里每个节点派生可视状态。
 *
 * 优先级（高 → 低）：duplicate > missing-file > entry > orphan > ending > branch > normal。
 * - duplicate：graphReport 标记的重复 id（最严重，要先解决）。
 * - missing-file：节点文件缺失（red）。
 * - entry：等于 entryNodeId 的节点（蓝/起点徽标）。
 * - orphan：有节点存在但既无入边也无出边，且不是入口（黄）。
 * - ending：有入边、无出边（绿，终点）。
 * - branch：出边 ≥ 2（黄，分支）。
 * - normal：其余。
 *
 * 注意：entry 也可能同时是 orphan（单节点图）。entry 优先于 orphan，让入口徽标稳定。
 */
export function deriveGraphNodeStatus(
  graph: ProjectGraph,
  nodeId: string,
  options: { hasFile?: boolean; duplicateNodeIds?: Set<string> } = {},
): GraphNodeStatus {
  const { hasFile = true, duplicateNodeIds } = options;
  if (duplicateNodeIds?.has(nodeId)) return "duplicate";
  if (!hasFile) return "missing-file";
  if (nodeId === graph.entryNodeId) return "entry";

  const summary = summarizeNodeConnections(graph, nodeId);
  const isConnected = summary.incoming > 0 || summary.outgoing > 0;
  if (!isConnected) return "orphan";
  if (summary.outgoing === 0) return "ending";
  if (summary.outgoing >= 2) return "branch";
  return "normal";
}

/** 计算节点入边/出边数量（忽略自环：from === to 的边不计入任一方）。 */
export function summarizeNodeConnections(graph: ProjectGraph, nodeId: string): NodeConnectionSummary {
  let incoming = 0;
  let outgoing = 0;
  for (const edge of graph.edges) {
    if (edge.from === edge.to) continue; // 自环不计
    if (edge.from === nodeId) outgoing += 1;
    if (edge.to === nodeId) incoming += 1;
  }
  return { incoming, outgoing };
}

/** 从 graphReport 收集重复节点 id 集合，供状态派生复用。 */
export function collectDuplicateNodeIds(graphReport?: GraphReport): Set<string> {
  return new Set(
    graphReport?.graphIssues
      .filter((issue) => issue.code === "duplicate_node_id" && issue.nodeId)
      .map((issue) => issue.nodeId as string) ?? [],
  );
}

export function issueTargetsEdge(issue: GraphIssue): string | null {
  return issue.edgeId ?? null;
}

/** 当前选中节点对象 */
export function findNode(graph: ProjectGraph, id: string | null): GraphNode | null {
  if (!id) return null;
  return graph.nodes.find((node) => node.id === id) ?? null;
}

/** 节点文件条目 */
export function findNodeEntry(entries: NodeEntry[] | undefined, file: string): NodeEntry | null {
  return entries?.find((entry) => entry.relPath === file) ?? null;
}

/** 节点文件数据 */
export function findNodeData(entries: NodeEntry[] | undefined, file: string): unknown | null {
  return findNodeEntry(entries, file)?.data ?? null;
}

function collectChoiceEdgeLabels(graph: ProjectGraph, nodeEntries?: NodeEntry[]): Map<string, string> {
  const labels = new Map<string, string>();
  if (!nodeEntries) return labels;

  for (const node of graph.nodes) {
    const data = findNodeEntry(nodeEntries, node.file)?.data;
    if (!Array.isArray(data)) continue;
    for (const instruction of data) {
      if (!isChoiceInstruction(instruction)) continue;
      for (const choice of instruction.choices) {
        if (!labels.has(`${node.id}\0${choice.to}`)) {
          labels.set(`${node.id}\0${choice.to}`, choice.text);
        }
      }
    }
  }

  return labels;
}

function hasChoiceInstruction(data: unknown): boolean {
  return Array.isArray(data) && data.some(isChoiceInstruction);
}

function isChoiceInstruction(value: unknown): value is { t: "choice"; choices: { text: string; to: string }[] } {
  if (!value || typeof value !== "object") return false;
  const instruction = value as { t?: unknown; choices?: unknown };
  return instruction.t === "choice" && Array.isArray(instruction.choices) && instruction.choices.some(isChoiceItem);
}

function isChoiceItem(value: unknown): value is { text: string; to: string } {
  if (!value || typeof value !== "object") return false;
  const choice = value as { text?: unknown; to?: unknown };
  return typeof choice.text === "string" && typeof choice.to === "string";
}
