import type { Manifest } from "../../lib/types";

export interface AffectedNodeReference {
  registry: "replay" | "ending";
  id: string;
  nodeId: string;
}

export function referencesAffectedByNodeDeletion(manifest: Manifest, nodeIds: string[]): AffectedNodeReference[] {
  const targets = new Set(nodeIds);
  return [
    ...Object.entries(manifest.unlocks.replay)
      .filter(([, entry]) => targets.has(entry.nodeId))
      .map(([id, entry]) => ({ registry: "replay" as const, id, nodeId: entry.nodeId })),
    ...Object.entries(manifest.unlocks.endings)
      .filter(([, entry]) => entry.nodeId != null && targets.has(entry.nodeId))
      .map(([id, entry]) => ({ registry: "ending" as const, id, nodeId: entry.nodeId! })),
  ];
}
