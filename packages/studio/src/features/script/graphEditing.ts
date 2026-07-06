import type { GraphEdge, GraphNode, ProjectGraph } from "../../lib/types";

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
  const nextNodes = graph.nodes.filter((node) => !ids.has(node.id));
  const nextEntryNodeId = nextNodes.some((node) => node.id === graph.entryNodeId)
    ? graph.entryNodeId
    : (nextNodes[0]?.id ?? "");

  return {
    graph: {
      ...graph,
      entryNodeId: nextEntryNodeId,
      nodes: nextNodes,
      edges: graph.edges.filter((edge) => !ids.has(edge.from) && !ids.has(edge.to)),
    },
    removedFiles: removed.map((node) => node.file),
  };
}

export function connectNodes(
  graph: ProjectGraph,
  from: string,
  to: string,
  options: Partial<Pick<GraphEdge, "mode" | "label" | "condition">> = {},
): ProjectGraph {
  const existing = graph.edges.some((edge) => edge.from === from && edge.to === to);
  if (existing) return graph;
  const currentOutgoing = graph.edges.filter((edge) => edge.from === from);
  const inheritedMode = options.mode ?? currentOutgoing[0]?.mode ?? "linear";
  const nextMode = currentOutgoing.length > 0 && inheritedMode === "linear" ? "choice" : inheritedMode;

  const next = {
    ...graph,
    edges: [
      ...graph.edges,
      normalizeGraphEdge({
        id: generateEdgeId(graph, from, to),
        from,
        to,
        mode: nextMode,
        label: options.label ?? defaultEdgeLabel(graph, to, nextMode),
        condition: options.condition ?? null,
      }),
    ],
  };
  return currentOutgoing.length > 0 && nextMode === "choice"
    ? normalizeOutgoingChoiceLabels(next, from)
    : next;
}

export function getNodeOutgoingEdges(graph: ProjectGraph, nodeId: string): GraphEdge[] {
  return graph.edges.filter((edge) => edge.from === nodeId).map(normalizeGraphEdge);
}

export function replaceNodeOutgoingEdges(graph: ProjectGraph, nodeId: string, outgoing: GraphEdge[]): ProjectGraph {
  const retained = graph.edges.filter((edge) => edge.from !== nodeId);
  const occupied = new Set(retained.map((edge) => edge.id));
  const normalized = outgoing.map((edge) => {
    const preferred = edge.id || `${nodeId}__${edge.to || "target"}`;
    const id = uniqueEdgeId(preferred, occupied);
    occupied.add(id);
    return normalizeGraphEdge({ ...edge, id, from: nodeId });
  });
  return { ...graph, edges: [...retained, ...normalized] };
}

export function normalizeGraphEdge(edge: GraphEdge): GraphEdge {
  return {
    ...edge,
    mode: edge.mode ?? "linear",
    label: edge.label ?? null,
    condition: edge.condition ?? null,
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

/**
 * 设置入口节点。nodeId 必须存在于图中。
 * 这是 Phase 8「设置入口节点」reducer：避免 entryNodeId 悬空只能靠手改 JSON。
 */
export function setEntryNode(graph: ProjectGraph, nodeId: string): ProjectGraph {
  const exists = graph.nodes.some((node) => node.id === nodeId);
  if (!exists) return graph;
  if (graph.entryNodeId === nodeId) return graph;
  return { ...graph, entryNodeId: nodeId };
}

/**
 * 复制一个节点：生成新 id、新 file、错开位置。
 * Phase 7 节点右键「复制」。
 *
 * 返回 { graph, newNode }：调用方需要根据 newNode.file 创建磁盘文件（内容复制自源节点）。
 * 不复制出边——复制出的节点默认是「接续」状态，由作者决定连向哪里。
 */
export function duplicateNode(
  graph: ProjectGraph,
  sourceId: string,
): { graph: ProjectGraph; newNode: GraphNode | null } {
  const source = graph.nodes.find((node) => node.id === sourceId);
  if (!source) return { graph, newNode: null };

  const newId = generateNodeId(graph, source.id);
  const newFile = deriveDuplicateFile(source.file, newId);
  const newNode: GraphNode = {
    id: newId,
    title: `${source.title} 副本`,
    file: newFile,
    position: {
      x: source.position.x + 40,
      y: source.position.y + 60,
    },
  };

  return { graph: { ...graph, nodes: [...graph.nodes, newNode] }, newNode };
}

/**
 * 创建一个后续节点：新建节点 + 从源节点连一条边到它。
 * Phase 7 节点右键「创建后续节点」。
 *
 * 返回 { graph, newNode }：调用方根据 newNode.file 建空文件。
 */
export function createSuccessor(
  graph: ProjectGraph,
  sourceId: string,
): { graph: ProjectGraph; newNode: GraphNode | null } {
  const source = graph.nodes.find((node) => node.id === sourceId);
  if (!source) return { graph, newNode: null };

  const newId = generateNodeId(graph, source.id);
  const newNode: GraphNode = {
    id: newId,
    title: newId,
    file: `nodes/${newId}.json`,
    position: {
      x: source.position.x + 260,
      y: source.position.y,
    },
  };
  const nextGraph = connectNodes(
    { ...graph, nodes: [...graph.nodes, newNode] },
    source.id,
    newId,
  );
  return { graph: nextGraph, newNode };
}

/** 由源 file 派生副本 file：nodes/x.json + id x_copy → nodes/x_copy.json。 */
function deriveDuplicateFile(sourceFile: string, newId: string): string {
  const lastSlash = sourceFile.lastIndexOf("/");
  const dir = lastSlash >= 0 ? sourceFile.slice(0, lastSlash + 1) : "";
  return `${dir}${newId}.json`;
}

function generateEdgeId(graph: ProjectGraph, from: string, to: string): string {
  return uniqueEdgeId(`${from}__${to}`, new Set(graph.edges.map((edge) => edge.id)));
}

function uniqueEdgeId(base: string, occupied: Set<string>): string {
  if (!occupied.has(base)) return base;
  let index = 2;
  while (occupied.has(`${base}_${index}`)) index += 1;
  return `${base}_${index}`;
}

function normalizeOutgoingChoiceLabels(graph: ProjectGraph, from: string): ProjectGraph {
  return {
    ...graph,
    edges: graph.edges.map((edge) => {
      if (edge.from !== from) return edge;
      return normalizeGraphEdge({
        ...edge,
        mode: "choice",
        label: edge.label?.trim() || defaultEdgeLabel(graph, edge.to, "choice"),
        condition: null,
      });
    }),
  };
}

function defaultEdgeLabel(graph: ProjectGraph, to: string, mode: GraphEdge["mode"]): string | null {
  if (mode !== "choice") return null;
  const target = graph.nodes.find((node) => node.id === to);
  return target?.title || to || "选项";
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
