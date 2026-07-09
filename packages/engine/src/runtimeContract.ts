import { z } from "zod";
import { VariableValueSchema } from "./schema";
import type { ProjectGraphData } from "./types";
import type { NovelState } from "./state";

export const RUNTIME_RECORD_SCHEMA_VERSION = 1;

export type RuntimePersistenceErrorCode =
  | "runtime_record_future_version"
  | "runtime_record_invalid"
  | "runtime_save_slot_not_found";

export class RuntimePersistenceError extends Error {
  constructor(
    readonly code: RuntimePersistenceErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "RuntimePersistenceError";
  }
}

export interface RuntimeLoadWarning {
  code: string;
  message: string;
  storyPoint?: StoryPointId;
  nodeId?: string;
}

export interface RuntimeRestoreResult {
  warnings: RuntimeLoadWarning[];
}

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
  unlockedReplays: z.array(z.string()).default([]),
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

export type RuntimeRecordKind = "saveSlot" | "global" | "settings";

export interface RuntimePersistenceAdapter {
  listSaveSlots(projectId: string): Promise<string[]>;
  readSaveSlot(projectId: string, slotId: string): Promise<SaveSlotRecord | null>;
  writeSaveSlot(projectId: string, slotId: string, record: SaveSlotRecord): Promise<void>;
  deleteSaveSlot(projectId: string, slotId: string): Promise<void>;
  readGlobal(projectId: string): Promise<GlobalPersistentRecord>;
  writeGlobal(projectId: string, record: GlobalPersistentRecord): Promise<void>;
  readSettings(projectId: string): Promise<RuntimeSettingsRecord>;
  writeSettings(projectId: string, record: RuntimeSettingsRecord): Promise<void>;
}

export interface RuntimeStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function createDefaultGlobalPersistentRecord(projectId: string): GlobalPersistentRecord {
  return {
    schemaVersion: RUNTIME_RECORD_SCHEMA_VERSION,
    projectId,
    readText: [],
    unlockedCg: [],
    unlockedMusic: [],
    unlockedReplays: [],
    unlockedEndings: [],
    playthroughCount: 0,
  };
}

export function createDefaultRuntimeSettingsRecord(): RuntimeSettingsRecord {
  return {
    schemaVersion: RUNTIME_RECORD_SCHEMA_VERSION,
    volumes: { master: 1, bgm: 0.8, sfx: 1, voice: 1 },
  };
}

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

export function migrateSaveSlotRecord(raw: unknown): SaveSlotRecord {
  assertSupportedRuntimeRecord(raw, "save slot");
  const parsed = SaveSlotRecordSchema.safeParse(raw);
  if (!parsed.success) {
    throw new RuntimePersistenceError("runtime_record_invalid", "Invalid save slot record.", parsed.error.issues);
  }
  return parsed.data;
}

export function migrateGlobalPersistentRecord(raw: unknown, projectId?: string): GlobalPersistentRecord {
  if (raw == null) return createDefaultGlobalPersistentRecord(projectId ?? "project");
  assertSupportedRuntimeRecord(raw, "global persistent");
  const parsed = GlobalPersistentRecordSchema.safeParse(raw);
  if (!parsed.success) {
    throw new RuntimePersistenceError("runtime_record_invalid", "Invalid global persistent record.", parsed.error.issues);
  }
  return parsed.data;
}

export function migrateRuntimeSettingsRecord(raw: unknown): RuntimeSettingsRecord {
  if (raw == null) return createDefaultRuntimeSettingsRecord();
  assertSupportedRuntimeRecord(raw, "runtime settings");
  const parsed = RuntimeSettingsRecordSchema.safeParse(raw);
  if (!parsed.success) {
    throw new RuntimePersistenceError("runtime_record_invalid", "Invalid runtime settings record.", parsed.error.issues);
  }
  return parsed.data;
}

export function createInMemoryRuntimePersistenceAdapter(): RuntimePersistenceAdapter {
  const slots = new Map<string, Map<string, SaveSlotRecord>>();
  const globals = new Map<string, GlobalPersistentRecord>();
  const settings = new Map<string, RuntimeSettingsRecord>();

  const projectSlots = (projectId: string) => {
    let map = slots.get(projectId);
    if (!map) {
      map = new Map();
      slots.set(projectId, map);
    }
    return map;
  };

  return {
    async listSaveSlots(projectId) {
      return Array.from(projectSlots(projectId).keys()).sort();
    },
    async readSaveSlot(projectId, slotId) {
      const raw = projectSlots(projectId).get(slotId);
      return raw ? migrateSaveSlotRecord(raw) : null;
    },
    async writeSaveSlot(projectId, slotId, record) {
      projectSlots(projectId).set(slotId, migrateSaveSlotRecord(record));
    },
    async deleteSaveSlot(projectId, slotId) {
      projectSlots(projectId).delete(slotId);
    },
    async readGlobal(projectId) {
      return globals.get(projectId) ?? createDefaultGlobalPersistentRecord(projectId);
    },
    async writeGlobal(projectId, record) {
      globals.set(projectId, migrateGlobalPersistentRecord(record, projectId));
    },
    async readSettings(projectId) {
      return settings.get(projectId) ?? createDefaultRuntimeSettingsRecord();
    },
    async writeSettings(projectId, record) {
      settings.set(projectId, migrateRuntimeSettingsRecord(record));
    },
  };
}

export function createRuntimeStorageLikePersistenceAdapter(options: {
  storage: RuntimeStorageLike;
  keyPrefix?: string;
  warnings?: string[];
}): RuntimePersistenceAdapter {
  const warnings = options.warnings;
  const prefix = options.keyPrefix ?? "vibegal";

  const key = (projectId: string, kind: "save" | "saveIndex" | "global" | "settings", id?: string) =>
    id ? `${prefix}:${projectId}:${kind}:${id}` : `${prefix}:${projectId}:${kind}`;

  const readJson = (storageKey: string): unknown | null => {
    try {
      const raw = options.storage.getItem(storageKey);
      return raw == null ? null : JSON.parse(raw);
    } catch {
      warnings?.push(`Failed to read runtime storage key: ${storageKey}`);
      return null;
    }
  };

  const writeJson = (storageKey: string, value: unknown) => {
    options.storage.setItem(storageKey, JSON.stringify(value));
  };

  const readSaveIndex = (projectId: string): string[] => {
    const raw = readJson(key(projectId, "saveIndex"));
    return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
  };

  const writeSaveIndex = (projectId: string, ids: string[]) => {
    writeJson(key(projectId, "saveIndex"), Array.from(new Set(ids)).sort());
  };

  return {
    async listSaveSlots(projectId) {
      return readSaveIndex(projectId);
    },
    async readSaveSlot(projectId, slotId) {
      const raw = readJson(key(projectId, "save", slotId));
      return raw == null ? null : migrateSaveSlotRecord(raw);
    },
    async writeSaveSlot(projectId, slotId, record) {
      writeJson(key(projectId, "save", slotId), migrateSaveSlotRecord(record));
      writeSaveIndex(projectId, [...readSaveIndex(projectId), slotId]);
    },
    async deleteSaveSlot(projectId, slotId) {
      options.storage.removeItem(key(projectId, "save", slotId));
      writeSaveIndex(projectId, readSaveIndex(projectId).filter((id) => id !== slotId));
    },
    async readGlobal(projectId) {
      return migrateGlobalPersistentRecord(readJson(key(projectId, "global")), projectId);
    },
    async writeGlobal(projectId, record) {
      writeJson(key(projectId, "global"), migrateGlobalPersistentRecord(record, projectId));
    },
    async readSettings(projectId) {
      return migrateRuntimeSettingsRecord(readJson(key(projectId, "settings")));
    },
    async writeSettings(projectId, record) {
      writeJson(key(projectId, "settings"), migrateRuntimeSettingsRecord(record));
    },
  };
}

function assertSupportedRuntimeRecord(raw: unknown, label: string) {
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  if (typeof record?.schemaVersion === "number" && record.schemaVersion > RUNTIME_RECORD_SCHEMA_VERSION) {
    throw new RuntimePersistenceError(
      "runtime_record_future_version",
      `Cannot read future ${label} schemaVersion ${record.schemaVersion}; current version is ${RUNTIME_RECORD_SCHEMA_VERSION}.`,
    );
  }
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
