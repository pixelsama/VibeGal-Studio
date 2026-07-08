import { z } from "zod";
import { VariableValueSchema } from "./schema";
import type { ProjectGraphData } from "./types";
import type { NovelState } from "./state";

export const RUNTIME_RECORD_SCHEMA_VERSION = 1;

export const StoryPointIdSchema = z.strictObject({
  nodeId: z.string().min(1),
  instructionId: z.string().min(1),
});
export type StoryPointId = z.infer<typeof StoryPointIdSchema>;

export const ReadTextKeySchema = StoryPointIdSchema.extend({
  textHash: z.string().min(1),
});
export type ReadTextKey = z.infer<typeof ReadTextKeySchema>;

export const SerializableSpriteSchema = z.strictObject({
  id: z.string().min(1),
  pos: z.string().min(1),
  expr: z.string().min(1),
});
export type SerializableSprite = z.infer<typeof SerializableSpriteSchema>;

export const SerializableBgmSchema = z.strictObject({
  id: z.string().min(1),
  loop: z.boolean(),
});
export type SerializableBgm = z.infer<typeof SerializableBgmSchema>;

export const RuntimeSnapshotSchema = z.strictObject({
  currentNodeId: z.string().min(1),
  currentStoryPoint: StoryPointIdSchema.nullable(),
  vars: z.record(z.string(), VariableValueSchema),
  background: z.string().nullable(),
  sprites: z.array(SerializableSpriteSchema),
  bgm: SerializableBgmSchema.nullable(),
});
export type RuntimeSnapshot = z.infer<typeof RuntimeSnapshotSchema>;

export const DecisionLogEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("start"), nodeId: z.string().min(1) }),
  z.strictObject({
    type: z.literal("choice"),
    fromNodeId: z.string().min(1),
    toNodeId: z.string().min(1),
    edgeId: z.string().min(1),
  }),
  z.strictObject({
    type: z.literal("auto"),
    fromNodeId: z.string().min(1),
    toNodeId: z.string().min(1),
    edgeId: z.string().min(1),
  }),
  z.strictObject({ type: z.literal("checkpoint"), snapshot: RuntimeSnapshotSchema }),
]);
export type DecisionLogEvent = z.infer<typeof DecisionLogEventSchema>;

export const SavePreviewSchema = z.strictObject({
  text: z.string().optional(),
  background: z.string().nullable().optional(),
});
export type SavePreview = z.infer<typeof SavePreviewSchema>;

export const SaveSlotRecordSchema = z.strictObject({
  schemaVersion: z.literal(RUNTIME_RECORD_SCHEMA_VERSION),
  projectId: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  label: z.string().optional(),
  preview: SavePreviewSchema.optional(),
  position: StoryPointIdSchema.nullable(),
  vars: z.record(z.string(), VariableValueSchema),
  decisions: z.array(DecisionLogEventSchema),
  checkpoint: RuntimeSnapshotSchema,
});
export type SaveSlotRecord = z.infer<typeof SaveSlotRecordSchema>;

export const GlobalPersistentRecordSchema = z.strictObject({
  schemaVersion: z.literal(RUNTIME_RECORD_SCHEMA_VERSION),
  projectId: z.string().min(1),
  readText: z.array(ReadTextKeySchema),
  unlockedCg: z.array(z.string()),
  unlockedMusic: z.array(z.string()),
  unlockedEndings: z.array(z.string()),
  playthroughCount: z.number().int().nonnegative(),
});
export type GlobalPersistentRecord = z.infer<typeof GlobalPersistentRecordSchema>;

export const RuntimeSettingsRecordSchema = z.strictObject({
  schemaVersion: z.literal(RUNTIME_RECORD_SCHEMA_VERSION),
  textSpeedCps: z.number().positive().optional(),
  autoAdvanceMs: z.number().int().nonnegative().optional(),
  volumes: z.strictObject({
    master: z.number().min(0).max(1),
    bgm: z.number().min(0).max(1),
    sfx: z.number().min(0).max(1),
    voice: z.number().min(0).max(1),
  }),
  fullscreen: z.boolean().optional(),
});
export type RuntimeSettingsRecord = z.infer<typeof RuntimeSettingsRecordSchema>;

export function normalizeReadText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[^\S\n\r]+$/gu, ""))
    .join("\n");
}

export function hashReadText(text: string): string {
  const normalized = normalizeReadText(text);
  const bytes = new TextEncoder().encode(normalized);
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function createReadTextKey(input: StoryPointId & { text: string }): ReadTextKey {
  return ReadTextKeySchema.parse({
    nodeId: input.nodeId,
    instructionId: input.instructionId,
    textHash: hashReadText(input.text),
  });
}

export function createRuntimeSnapshot(
  state: NovelState,
  position: Pick<RuntimeSnapshot, "currentNodeId" | "currentStoryPoint">,
): RuntimeSnapshot {
  return RuntimeSnapshotSchema.parse({
    currentNodeId: position.currentNodeId,
    currentStoryPoint: position.currentStoryPoint,
    vars: state.vars,
    background: state.background,
    sprites: state.sprites
      .filter((sprite) => !sprite.leaving)
      .map((sprite) => ({ id: sprite.id, pos: sprite.pos, expr: sprite.expr })),
    bgm: state.audio.bgm ? { id: state.audio.bgm.id, loop: state.audio.bgm.loop } : null,
  });
}

export function createSaveSlotRecord(input: {
  projectId: string;
  now: string;
  checkpoint: RuntimeSnapshot;
  decisions?: DecisionLogEvent[];
  label?: string;
  preview?: SavePreview;
  createdAt?: string;
  updatedAt?: string;
  position?: StoryPointId | null;
  vars?: Record<string, string | number | boolean | null>;
}): SaveSlotRecord {
  return SaveSlotRecordSchema.parse({
    schemaVersion: RUNTIME_RECORD_SCHEMA_VERSION,
    projectId: input.projectId,
    createdAt: input.createdAt ?? input.now,
    updatedAt: input.updatedAt ?? input.now,
    label: input.label,
    preview: input.preview,
    position: input.position ?? input.checkpoint.currentStoryPoint,
    vars: input.vars ?? input.checkpoint.vars,
    decisions: input.decisions ?? [],
    checkpoint: input.checkpoint,
  });
}

export function replayDecisionLogToNodeId(
  graph: ProjectGraphData,
  decisions: DecisionLogEvent[],
): { nodeId: string | null; warnings: string[] } {
  const warnings: string[] = [];
  let nodeId: string | null = graph.entryNodeId || null;

  for (const event of decisions) {
    switch (event.type) {
      case "start":
        nodeId = event.nodeId;
        break;
      case "choice":
      case "auto": {
        const edge = findLoggedEdge(graph, event);
        if (edge) {
          nodeId = edge.to;
          break;
        }
        nodeId = event.fromNodeId;
        warnings.push(`无法恢复 ${event.type} 决策 ${event.edgeId}，已停在 ${event.fromNodeId}。`);
        break;
      }
      case "checkpoint":
        nodeId = event.snapshot.currentNodeId;
        break;
      default: {
        const exhaustive: never = event;
        return exhaustive;
      }
    }
  }

  return { nodeId, warnings };
}

function findLoggedEdge(
  graph: ProjectGraphData,
  event: Extract<DecisionLogEvent, { type: "choice" | "auto" }>,
) {
  return graph.edges.find((edge) =>
    edge.id === event.edgeId &&
    edge.from === event.fromNodeId &&
    edge.to === event.toNodeId
  ) ?? graph.edges.find((edge) => edge.from === event.fromNodeId && edge.to === event.toNodeId);
}
