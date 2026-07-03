/**
 * Phase 9：确定性自动排布。
 *
 * 从 entryNodeId BFS 分层，同层按 id 字典序，不可达节点放底部。
 * 只改 position，不动 id/file/edge/title/entryNodeId。幂等：同一图重复运行结果一致。
 */
import type { ProjectGraph } from "../../lib/types";

const ORIGIN_X = 80;
const ORIGIN_Y = 80;
const LAYER_GAP_X = 280; // 层与层水平间距
const ROW_GAP_Y = 160; // 同层节点垂直间距
const UNREACHABLE_GAP_Y = 80; // 可达区与不可达区之间的额外纵向间距

/**
 * 对图做确定性分层排布。
 *
 * - 从 entryNodeId 出发 BFS 分层（邻接表来自 edges.from→to，忽略自环 from===to）。
 * - entry 缺失/为空时，所有节点都视为不可达。
 * - 同层按 id 字典序排列，保证幂等。
 * - 不可达节点排到底部单独区域，内部也按 id 字典序。
 * - 返回新 ProjectGraph，只更新各节点 position，其余字段不变。
 */
export function autoLayoutGraph(graph: ProjectGraph): ProjectGraph {
  if (graph.nodes.length === 0) return graph;

  const adjacency = buildAdjacency(graph);
  const allIds = graph.nodes.map((node) => node.id);

  // BFS 分层：可达节点 → layer 编号；不可达节点不在 map 里。
  const reachableLayers = bfsLayers(graph.entryNodeId, adjacency);

  // 按 layer 分桶，桶内按 id 字典序
  const maxLayer = reachableLayers.size === 0 ? -1 : Math.max(...reachableLayers.values());
  const layerBuckets: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const node of graph.nodes) {
    const layer = reachableLayers.get(node.id);
    if (layer != null) layerBuckets[layer].push(node.id);
  }
  layerBuckets.forEach((bucket) => bucket.sort());

  const unreachable = allIds
    .filter((id) => !reachableLayers.has(id))
    .sort();

  // 计算每层占用的行数（用于 y 起始偏移）
  const positionById = new Map<string, { x: number; y: number }>();
  let yOffset = ORIGIN_Y;
  for (let layer = 0; layer < layerBuckets.length; layer += 1) {
    const bucket = layerBuckets[layer];
    const x = ORIGIN_X + layer * LAYER_GAP_X;
    bucket.forEach((id, indexInLayer) => {
      positionById.set(id, { x, y: yOffset + indexInLayer * ROW_GAP_Y });
    });
    yOffset += bucket.length * ROW_GAP_Y;
  }

  // 不可达区：从可达区底部 + 间距开始，x 回到 ORIGIN_X，按字典序铺
  if (unreachable.length > 0) {
    yOffset += UNREACHABLE_GAP_Y;
    unreachable.forEach((id, index) => {
      positionById.set(id, { x: ORIGIN_X, y: yOffset + index * ROW_GAP_Y });
    });
  }

  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({
      ...node,
      position: positionById.get(node.id) ?? node.position,
    })),
  };
}

/** 邻接表：from → Set<to>，忽略自环。 */
function buildAdjacency(graph: ProjectGraph): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const node of graph.nodes) adj.set(node.id, new Set());
  for (const edge of graph.edges) {
    if (edge.from === edge.to) continue; // 自环不计
    adj.get(edge.from)?.add(edge.to);
  }
  return adj;
}

/** BFS 分层：返回 nodeId → layer（0 起）。入口缺失/无效时返回空 map。 */
function bfsLayers(entryNodeId: string, adjacency: Map<string, Set<string>>): Map<string, number> {
  if (!entryNodeId || !adjacency.has(entryNodeId)) return new Map();

  const layers = new Map<string, number>();
  const queue: string[] = [entryNodeId];
  layers.set(entryNodeId, 0);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentLayer = layers.get(current)!;
    for (const next of adjacency.get(current) ?? []) {
      if (!layers.has(next)) {
        layers.set(next, currentLayer + 1);
        queue.push(next);
      }
    }
  }
  return layers;
}
