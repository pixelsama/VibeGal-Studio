import type { Edge, Node } from "@xyflow/react";
import type { GraphIssue, GraphReport, GraphNode, NodeEntry, ProjectGraph } from "../../lib/types";

export const NODE_TYPE = "galNode";

export interface FlowNodeData extends Record<string, unknown> {
  title: string;
  fileId: string;
  isEntry: boolean;
  duplicateNodeId?: boolean;
}

/** graph node -> React Flow node */
export function mapGraphToFlow(
  graph: ProjectGraph,
  graphReport?: GraphReport,
): { nodes: Node<FlowNodeData, typeof NODE_TYPE>[]; edges: Edge[] } {
  const duplicateNodeIds = new Set(
    graphReport?.graphIssues
      .filter((issue) => issue.code === "duplicate_node_id" && issue.nodeId)
      .map((issue) => issue.nodeId as string) ?? [],
  );
  const suspiciousEdgeIds = new Set(
    graphReport?.graphIssues
      .filter((issue) => issue.code === "dangling_edge" && issue.edgeId)
      .map((issue) => issue.edgeId as string) ?? [],
  );

  const nodes: Node<FlowNodeData, typeof NODE_TYPE>[] = graph.nodes.map((node) => ({
    id: node.id,
    type: NODE_TYPE,
    position: node.position,
    data: {
      title: node.title,
      fileId: node.file,
      isEntry: node.id === graph.entryNodeId,
      ...(duplicateNodeIds.has(node.id) ? { duplicateNodeId: true } : {}),
    },
  }));
  const edges: Edge[] = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    type: "smoothstep",
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
