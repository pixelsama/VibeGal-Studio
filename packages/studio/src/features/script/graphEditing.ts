import type { GraphNode, ProjectGraph } from "../../lib/types";

const DEFAULT_NODE_POSITION = { x: 120, y: 120 };
const NEW_NODE_OFFSET = { x: 260, y: 120 };

export function addNode(
  graph: ProjectGraph,
  opts: { id: string; title: string; file: string; position?: { x: number; y: number } },
): ProjectGraph {
  const node: GraphNode = {
    id: opts.id,
    title: opts.title,
    file: opts.file,
    position: opts.position ?? defaultPosition(graph),
  };

  return {
    ...graph,
    entryNodeId: graph.entryNodeId || node.id,
    nodes: [...graph.nodes, node],
  };
}

export function removeNode(graph: ProjectGraph, nodeId: string): { graph: ProjectGraph; removedFile: string | null } {
  const result = removeNodes(graph, [nodeId]);
  return { graph: result.graph, removedFile: result.removedFiles[0] ?? null };
}

export function removeNodes(graph: ProjectGraph, nodeIds: string[]): { graph: ProjectGraph; removedFiles: string[] } {
  const ids = new Set(nodeIds);
  const removed = graph.nodes.filter((node) => ids.has(node.id));
  if (removed.length === 0) return { graph, removedFiles: [] };

  return {
    graph: {
      ...graph,
      nodes: graph.nodes.filter((node) => !ids.has(node.id)),
      edges: graph.edges.filter((edge) => !ids.has(edge.from) && !ids.has(edge.to)),
    },
    removedFiles: removed.map((node) => node.file),
  };
}

export function connectNodes(graph: ProjectGraph, from: string, to: string): ProjectGraph {
  const existing = graph.edges.some((edge) => edge.from === from && edge.to === to);
  if (existing) return graph;

  return {
    ...graph,
    edges: [
      ...graph.edges,
      {
        id: `${from}__${to}`,
        from,
        to,
        condition: null,
      },
    ],
  };
}

export function renameNode(graph: ProjectGraph, nodeId: string, title: string): ProjectGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => (node.id === nodeId ? { ...node, title } : node)),
  };
}

export function moveNode(graph: ProjectGraph, nodeId: string, position: { x: number; y: number }): ProjectGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => (node.id === nodeId ? { ...node, position } : node)),
  };
}

export function removeEdge(graph: ProjectGraph, edgeId: string): ProjectGraph {
  return {
    ...graph,
    edges: graph.edges.filter((edge) => edge.id !== edgeId),
  };
}

export function generateNodeId(graph: ProjectGraph, base: string): string {
  const normalized = normalizeNodeId(base);
  const used = new Set(graph.nodes.map((node) => node.id));
  if (!used.has(normalized)) return normalized;

  let suffix = 2;
  while (used.has(`${normalized}_${suffix}`)) suffix += 1;
  return `${normalized}_${suffix}`;
}

export function defaultPosition(graph: ProjectGraph): { x: number; y: number } {
  if (graph.nodes.length === 0) return DEFAULT_NODE_POSITION;

  const centroid = graph.nodes.reduce(
    (acc, node) => ({ x: acc.x + node.position.x, y: acc.y + node.position.y }),
    { x: 0, y: 0 },
  );
  const candidate = {
    x: Math.max(0, Math.round(centroid.x / graph.nodes.length + NEW_NODE_OFFSET.x)),
    y: Math.max(0, Math.round(centroid.y / graph.nodes.length + NEW_NODE_OFFSET.y)),
  };
  const occupied = new Set(graph.nodes.map((node) => positionKey(node.position)));
  while (occupied.has(positionKey(candidate))) {
    candidate.x += NEW_NODE_OFFSET.x;
    candidate.y += NEW_NODE_OFFSET.y;
  }
  return candidate;
}

function normalizeNodeId(base: string): string {
  const normalized = base
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
  return normalized || "node";
}

function positionKey(position: { x: number; y: number }): string {
  return `${position.x}:${position.y}`;
}
