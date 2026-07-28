import type { FileRevision, GraphPositionPatch, ProjectGraph } from "../../lib/types";

export function buildGraphPositionUpdates(before: ProjectGraph, after: ProjectGraph): GraphPositionPatch[] {
  const beforeById = new Map(before.nodes.map((node) => [node.id, node.position]));
  return after.nodes
    .filter((node) => {
      const previous = beforeById.get(node.id);
      return previous && (previous.x !== node.position.x || previous.y !== node.position.y);
    })
    .map((node) => ({ id: node.id, position: node.position }));
}

export function takePendingGraphPositionUpdates(
  pending: Map<string, { x: number; y: number }>,
): GraphPositionPatch[] {
  const updates = Array.from(pending, ([id, position]) => ({ id, position }));
  pending.clear();
  return updates;
}

export interface PersistCreatedNodeWithCompensationParams {
  projectPath: string;
  nodeFile: string;
  content: string;
  graph: ProjectGraph;
  saveFileFn: (
    projectPath: string,
    relPath: string,
    content: string,
    expectedRevision?: FileRevision | null,
  ) => Promise<FileRevision | null>;
  persistGraphFn: (graph: ProjectGraph) => Promise<boolean>;
  deleteFileFn: (
    projectPath: string,
    relPath: string,
    expectedRevision?: FileRevision | null,
  ) => Promise<void>;
}

export type PersistCreatedNodeWithCompensationResult =
  | { saved: true; rolledBack: false }
  | { saved: false; rolledBack: true }
  | { saved: false; rolledBack: false; rollbackError: unknown };

export async function persistCreatedNodeWithCompensation({
  projectPath,
  nodeFile,
  content,
  graph,
  saveFileFn,
  persistGraphFn,
  deleteFileFn,
}: PersistCreatedNodeWithCompensationParams): Promise<PersistCreatedNodeWithCompensationResult> {
  const createdRevision = await saveFileFn(projectPath, `content/${nodeFile}`, content);
  if (await persistGraphFn(graph)) {
    return { saved: true, rolledBack: false };
  }
  try {
    await deleteFileFn(projectPath, nodeFile, createdRevision);
    return { saved: false, rolledBack: true };
  } catch (rollbackError) {
    return { saved: false, rolledBack: false, rollbackError };
  }
}
