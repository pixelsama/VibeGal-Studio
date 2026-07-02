import type { Edge, Node } from "@xyflow/react";
import type { GraphNode, NodeEntry, ProjectGraph } from "../../lib/types";

export const NODE_TYPE = "galNode";

export interface FlowNodeData extends Record<string, unknown> {
  title: string;
  fileId: string;
  isEntry: boolean;
}

/** graph node -> React Flow node */
export function mapGraphToFlow(graph: ProjectGraph): { nodes: Node<FlowNodeData, typeof NODE_TYPE>[]; edges: Edge[] } {
  const nodes: Node<FlowNodeData, typeof NODE_TYPE>[] = graph.nodes.map((node) => ({
    id: node.id,
    type: NODE_TYPE,
    position: node.position,
    data: {
      title: node.title,
      fileId: node.file,
      isEntry: node.id === graph.entryNodeId,
    },
  }));
  const edges: Edge[] = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    type: "smoothstep",
    data: { condition: edge.condition },
  }));

  return { nodes, edges };
}

/** 当前选中节点对象 */
export function findNode(graph: ProjectGraph, id: string | null): GraphNode | null {
  if (!id) return null;
  return graph.nodes.find((node) => node.id === id) ?? null;
}

/** 当前选中节点对应的节点文件数据 */
export function findNodeData(
  graph: ProjectGraph,
  entries: NodeEntry[] | undefined,
  id: string | null,
): NodeEntry | null {
  const node = findNode(graph, id);
  if (!node) return null;
  return entries?.find((entry) => entry.relPath === node.file) ?? null;
}
