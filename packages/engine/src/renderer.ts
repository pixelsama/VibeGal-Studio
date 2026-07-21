/**
 * 渲染层契约 —— engine 与可替换渲染层之间的接口定义。
 *
 * 一个渲染层 = 一套读 NovelState 的 React 组件实现。
 * 它存在于「项目内」（每个项目自带 renderers/），开发工具加载它、挂载它。
 * 契约稳定后，换皮 = 换一个遵守本契约的目录，引擎与剧本不动。
 */
import type { ComponentType } from "react";
import type { NovelState } from "./state";
import type { Manifest, Meta, VariableRegistry } from "./types";
import { variableDefaults } from "./variables";
import {
  RuntimePersistenceError,
  RUNTIME_RECORD_SCHEMA_VERSION,
  createDefaultGlobalPersistentRecord,
  createDefaultRuntimeSettingsRecord,
  createInMemoryRuntimePersistenceAdapter,
  createRuntimeSnapshot,
  createSaveSlotRecord,
  migrateGlobalPersistentRecord,
  migrateRuntimeSettingsRecord,
  type GlobalPersistentRecord,
  type ReadTextKey,
  type RuntimePersistenceAdapter,
  type RuntimeRestoreResult,
  type RuntimeSettingsRecord,
  type RuntimeSnapshot,
  type SavePreview,
  type SaveSlotRecord,
  type StoryPointId,
} from "./runtimeContract";

export type {
  ReadTextKey,
  RuntimeSettingsRecord,
  RuntimeSnapshot,
  SaveSlotRecord,
  StoryPointId,
} from "./runtimeContract";

export const RENDERER_CONTRACT_VERSION = 1;

export type SkipMode = "off" | "read" | "all";
export type UnlockKind = "cg" | "music" | "replay" | "ending" | "endings";

export interface RuntimeControls {
  advance(): void;
  choose(toNodeId: string): void;
  setAutoPlay(on: boolean): void;
  setSkipMode(mode: SkipMode): void;
  rollbackTo(point: StoryPointId): void;
  restart(): void;
}

export interface SaveSlotSummary {
  slotId: string;
  label?: string;
  preview?: SavePreview;
  updatedAt: string;
  position: StoryPointId | null;
}

export interface SaveOptions {
  label?: string;
  preview?: SavePreview;
}

export interface SaveService {
  listSlots(): Promise<SaveSlotSummary[]>;
  save(slotId: string, options?: SaveOptions): Promise<SaveSlotSummary>;
  load(slotId: string): Promise<RuntimeRestoreResult & { slotId: string }>;
  delete(slotId: string): Promise<void>;
  quickSave(): Promise<void>;
  quickLoad(): Promise<RuntimeRestoreResult & { slotId: string }>;
  autoSave(reason: "node" | "choice" | "manual" | "ending"): Promise<void>;
}

export interface BacklogEntry {
  id: string;
  storyPoint: StoryPointId;
  speakerName?: string;
  text: string;
  voiceId?: string;
  readKey?: ReadTextKey;
  createdOrder?: number;
}

export interface HistoryService {
  getBacklog(): BacklogEntry[];
  replayVoice(entryId: string): void;
  rollbackTo(entryId: string): void | RuntimeRestoreResult | Promise<void | RuntimeRestoreResult>;
}

export interface UnlockState {
  cg: string[];
  music: string[];
  replay: string[];
  endings: string[];
}

export interface PersistentService {
  getReadStatus(key: ReadTextKey): boolean;
  markRead(key: ReadTextKey): Promise<void>;
  getUnlocks(): UnlockState;
  unlock(kind: UnlockKind, id: string): Promise<void>;
  resetGlobalProgress(): Promise<void>;
  getGlobalVars(): Record<string, string | number | boolean | null>;
  applyGlobalEffect(input: { playthroughId: string; effectKey: string; key: string; value: string | number | boolean | null }): Promise<{ applied: boolean }>;
  completeEnding(input: { playthroughId: string; endingId: string }): Promise<{ settled: boolean }>;
}

export interface ProgressService {
  getSummary(): { playthroughCount: number; lastEndingId: string | null; currentPlaythroughEndingIds: string[] };
  subscribe(listener: () => void): () => void;
}

export interface RuntimeSettingsService {
  getSettings(): RuntimeSettingsRecord;
  updateSettings(patch: Partial<RuntimeSettingsRecord>): Promise<void>;
}

export interface AudioService {
  replayVoice(voiceId?: string): void;
  playMusic(audioId: string, options?: AudioPlaybackOptions): void;
  stopMusic(fadeMs?: number): void;
  stopBgm(fadeMs?: number): void;
  pauseBgm(): void;
  resumeBgm(): void;
  stopVoice(): void;
  stopAllSfx(): void;
}

export interface AudioPlaybackOptions {
  loop?: boolean;
  fadeMs?: number;
}

export interface GalleryService {
  isUnlocked(kind: UnlockKind, id: string): boolean;
  listCg(): Array<{ id: string; assetId: string; title?: string; asset: unknown }>;
  listMusic(): Array<{ id: string; audioId: string; title?: string; asset: unknown }>;
  listReplays(): Array<{ id: string; nodeId: string; title?: string }>;
  listEndings(): Array<{ id: string; title: string; nodeId?: string }>;
}

export interface ReplayService {
  start(replayId: string): RuntimeRestoreResult | Promise<RuntimeRestoreResult>;
}

export interface MediaService {
  closeCg(): void;
  skipVideo(): void;
}

export interface RuntimeStatusNotice {
  id: number;
  level: "warning" | "error";
  code: string;
  message: string;
}

export interface RuntimeStatusService {
  getNotices(): RuntimeStatusNotice[];
  subscribe(listener: () => void): () => void;
  report(notice: Omit<RuntimeStatusNotice, "id">): void;
}

export interface DebugService {
  inspectState(): NovelState;
  inspectRuntimeSnapshot(): RuntimeSnapshot;
  jumpTo(point: StoryPointId): void;
}

export interface RuntimeServices {
  save: SaveService;
  history: HistoryService;
  persistent: PersistentService;
  progress: ProgressService;
  settings: RuntimeSettingsService;
  audio: AudioService;
  gallery: GalleryService;
  replay: ReplayService;
  media: MediaService;
  status?: RuntimeStatusService;
  debug?: DebugService;
}

export class RuntimeServiceUnavailableError extends Error {
  readonly code = "runtime_service_unavailable";

  constructor(readonly service: string, readonly method: string) {
    super(`Runtime service unavailable: ${service}.${method}`);
  }
}

/** 渲染层组件接收的 props。引擎把「当前场景状态 + 资源表 + 控制回调」交给它。 */
export interface RendererProps {
  /** 当前场景状态（视图契约），是渲染层唯一需要读懂的核心数据 */
  state: NovelState;
  /** 资源表，渲染层用它把 id 解析成图片/音频路径 */
  manifest: Manifest;
  /** 资源根路径（相对），用于拼绝对 URL */
  contentBase: string;
  /** 项目固定舞台尺寸，renderer 的坐标系应以它为准 */
  stage: Meta["stage"];
  /** 正式播放控制 API */
  controls: RuntimeControls;
  /** 正式 runtime services。Studio preview 必须提供完整字段，可用结构化 unavailable 表示未落地能力。 */
  runtime?: RuntimeServices;
}

/** 每个渲染层目录必须导出的清单。 */
export interface RendererManifest {
  /** 唯一 id，通常 = 目录名 */
  id: string;
  /** 在 UI 里显示的名字 */
  name: string;
  /** renderer contract version supported by this engine release */
  contractVersion: typeof RENDERER_CONTRACT_VERSION;
  /** Optional capability flags for later feature probing. */
  capabilities?: string[];
  /** 描述（可选） */
  description?: string;
  /** 渲染层主组件 */
  Component: ComponentType<RendererProps>;
}

export interface RendererManifestIssue {
  level: "error" | "warn";
  code: string;
  message: string;
}

export function validateRendererManifestContract(raw: unknown): RendererManifestIssue[] {
  const issues: RendererManifestIssue[] = [];
  const manifest = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  if (!manifest) {
    return [{ level: "error", code: "renderer_manifest_invalid", message: "Renderer manifest must be an object." }];
  }

  if (typeof manifest.id !== "string" || manifest.id.trim() === "") {
    issues.push({ level: "error", code: "renderer_manifest_invalid", message: "Renderer manifest id must be a non-empty string." });
  }
  if (typeof manifest.name !== "string" || manifest.name.trim() === "") {
    issues.push({ level: "error", code: "renderer_manifest_invalid", message: "Renderer manifest name must be a non-empty string." });
  }
  if (manifest.contractVersion !== RENDERER_CONTRACT_VERSION) {
    issues.push({
      level: "error",
      code: "renderer_contract_unsupported",
      message: `Unsupported renderer contract version ${String(manifest.contractVersion)}; expected ${RENDERER_CONTRACT_VERSION}.`,
    });
  }
  if (typeof manifest.Component !== "function") {
    issues.push({ level: "error", code: "renderer_manifest_invalid", message: "Renderer manifest Component must be a React component function." });
  }
  if (manifest.capabilities != null && (!Array.isArray(manifest.capabilities) || !manifest.capabilities.every((item) => typeof item === "string"))) {
    issues.push({ level: "error", code: "renderer_manifest_invalid", message: "Renderer manifest capabilities must be a string array when present." });
  }

  return issues;
}

export interface RuntimeAudioBridge extends AudioService {
  setVolumes?(volumes: RuntimeSettingsRecord["volumes"]): void;
}

export interface InMemoryRuntimeServicesOptions {
  projectId?: string;
  getState: () => NovelState;
  createSnapshot?: () => RuntimeSnapshot;
  restoreFromSave?: (record: SaveSlotRecord) => RuntimeRestoreResult | Promise<RuntimeRestoreResult>;
  persistenceAdapter?: RuntimePersistenceAdapter;
  decisionLog?: () => import("./runtimeContract").DecisionLogEvent[];
  currentStoryPoint?: () => StoryPointId | null;
  currentNodeId?: () => string;
  now?: () => string;
  initialBacklog?: BacklogEntry[];
  initialGlobalPersistent?: GlobalPersistentRecord;
  getBacklog?: () => BacklogEntry[];
  initialSettings?: RuntimeSettingsRecord;
  settingsFallback?: Pick<RuntimeSettingsRecord, "textSpeedCps" | "autoAdvanceMs">;
  audio?: Partial<RuntimeAudioBridge>;
  manifest?: Manifest;
  variables?: VariableRegistry;
  media?: Partial<MediaService>;
  onSettingsChanged?: (settings: RuntimeSettingsRecord) => void;
  startReplay?: (nodeId: string) => void | RuntimeRestoreResult | Promise<void | RuntimeRestoreResult>;
  rollbackTo?: (point: StoryPointId) => RuntimeRestoreResult | Promise<RuntimeRestoreResult>;
  rollbackHistoryEntry?: (entryId: string) => RuntimeRestoreResult | Promise<RuntimeRestoreResult>;
  replayVoice?: (entryId: string) => void;
  inspectState?: () => NovelState;
  jumpTo?: (point: StoryPointId) => void;
}

export function defaultRuntimeSettings(): RuntimeSettingsRecord {
  return createDefaultRuntimeSettingsRecord();
}

export function resolveRuntimeSettings(
  settings: RuntimeSettingsRecord,
  fallback: Pick<Required<RuntimeSettingsRecord>, "textSpeedCps" | "autoAdvanceMs"> = {
    textSpeedCps: 30,
    autoAdvanceMs: 1_200,
  },
): RuntimeSettingsRecord & Required<Pick<RuntimeSettingsRecord, "textSpeedCps" | "autoAdvanceMs">> {
  const migrated = migrateRuntimeSettingsRecord(settings);
  return {
    ...migrated,
    textSpeedCps: migrated.textSpeedCps ?? fallback.textSpeedCps,
    autoAdvanceMs: migrated.autoAdvanceMs ?? fallback.autoAdvanceMs,
    volumes: { ...migrated.volumes },
  };
}

export function createInMemoryRuntimeServices(options: InMemoryRuntimeServicesOptions): RuntimeServices {
  const projectId = options.projectId ?? "studio-preview";
  const now = options.now ?? (() => new Date().toISOString());
  const persistenceAdapter = options.persistenceAdapter ?? createInMemoryRuntimePersistenceAdapter();
  const initialGlobal = migrateGlobalPersistentRecord(
    options.initialGlobalPersistent ?? createDefaultGlobalPersistentRecord(projectId),
    projectId,
  );
  const globalDefaults = variableDefaults(options.variables, "global");
  const readText = new Map<string, ReadTextKey>(
    initialGlobal.readText.map((key) => [readKeyId(key), { ...key }]),
  );
  const unlocks: Record<UnlockKind, Set<string>> = {
    cg: new Set(initialGlobal.unlockedCg),
    music: new Set(initialGlobal.unlockedMusic),
    replay: new Set(initialGlobal.unlockedReplays),
    ending: new Set(),
    endings: new Set(initialGlobal.unlockedEndings),
  };
  const backlog = [...(options.initialBacklog ?? [])];
  const settingsFallback = {
    textSpeedCps: options.settingsFallback?.textSpeedCps ?? 30,
    autoAdvanceMs: options.settingsFallback?.autoAdvanceMs ?? 1_200,
  };
  let settings = resolveRuntimeSettings(options.initialSettings ?? defaultRuntimeSettings(), settingsFallback);
  let statusNoticeId = 0;
  const statusNotices: RuntimeStatusNotice[] = [];
  const statusListeners = new Set<() => void>();
  let mutationQueue = Promise.resolve();
  let globalRecord = {
    ...initialGlobal,
    globalVars: { ...globalDefaults, ...initialGlobal.globalVars },
  };
  const progressListeners = new Set<() => void>();
  const mutate = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  };
  const unavailable = (service: string, method: string): never => {
    throw new RuntimeServiceUnavailableError(service, method);
  };

  const snapshot = () => createRuntimeSnapshot(options.getState(), {
    currentNodeId: options.currentNodeId?.() ?? "preview",
    currentStoryPoint: options.currentStoryPoint?.() ?? null,
  });
  const createSnapshot = options.createSnapshot ?? snapshot;

  const toSummary = (slotId: string, slot: SaveSlotRecord): SaveSlotSummary => ({
    slotId,
    label: slot.label,
    preview: slot.preview,
    updatedAt: slot.updatedAt,
    position: slot.position,
  });

  return {
    save: {
      async listSlots() {
        const summaries = await Promise.all((await persistenceAdapter.listSaveSlots(projectId)).map(async (slotId) => {
          const slot = await persistenceAdapter.readSaveSlot(projectId, slotId);
          return slot ? toSummary(slotId, slot) : null;
        }));
        return summaries
          .filter((summary): summary is SaveSlotSummary => summary != null)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      },
      async save(slotId, saveOptions) {
        const checkpoint = createSnapshot();
        const decisions = options.decisionLog?.();
        return mutate(async () => {
          const existing = await persistenceAdapter.readSaveSlot(projectId, slotId);
          const slot = createSaveSlotRecord({
            projectId,
            now: now(),
            checkpoint,
            decisions: decisions ?? existing?.decisions,
            createdAt: existing?.createdAt,
            label: saveOptions?.label ?? existing?.label,
            preview: saveOptions?.preview ?? existing?.preview,
          });
          await persistenceAdapter.writeSaveSlot(projectId, slotId, slot);
          return toSummary(slotId, slot);
        });
      },
      async load(slotId) {
        return mutate(async () => {
          const slot = await persistenceAdapter.readSaveSlot(projectId, slotId);
          if (!slot) {
            throw new RuntimePersistenceError("runtime_save_slot_not_found", `Save slot "${slotId}" was not found.`);
          }
          const result = await (options.restoreFromSave?.(slot) ?? { warnings: [] });
          return { ...result, slotId };
        });
      },
      async delete(slotId) {
        await mutate(() => persistenceAdapter.deleteSaveSlot(projectId, slotId));
      },
      async quickSave() {
        await this.save("quick", { preview: savePreviewFromState(options.getState()) });
      },
      async quickLoad() {
        return this.load("quick");
      },
      async autoSave(reason) {
        await this.save(`auto:${reason}`, { preview: savePreviewFromState(options.getState()) });
      },
    },
    history: {
      getBacklog() {
        return (options.getBacklog?.() ?? backlog)
          .map((entry) => ({ ...entry, storyPoint: { ...entry.storyPoint }, readKey: entry.readKey ? { ...entry.readKey } : undefined }));
      },
      replayVoice(entryId) {
        if (options.replayVoice) {
          options.replayVoice(entryId);
          return;
        }
        if (options.audio?.replayVoice) {
          const entry = (options.getBacklog?.() ?? backlog).find((item) => item.id === entryId);
          options.audio.replayVoice(entry?.voiceId);
          return;
        }
        unavailable("history", "replayVoice");
      },
      rollbackTo(entryId) {
        const entry = (options.getBacklog?.() ?? backlog).find((item) => item.id === entryId);
        if (!entry) {
          return unavailable("history", "rollbackTo");
        }
        if (options.rollbackHistoryEntry) return options.rollbackHistoryEntry(entryId);
        const rollbackTo = options.rollbackTo ?? (() => unavailable("history", "rollbackTo"));
        return rollbackTo(entry.storyPoint);
      },
    },
    persistent: {
      getReadStatus(key) {
        return readText.has(readKeyId(key));
      },
      getGlobalVars() {
        return { ...globalRecord.globalVars };
      },
      async markRead(key) {
        readText.set(readKeyId(key), { ...key });
        globalRecord = currentGlobalRecord(globalRecord, readText, unlocks);
        await persistenceAdapter.writeGlobal(projectId, globalRecord);
      },
      getUnlocks() {
        return {
          cg: Array.from(unlocks.cg),
          music: Array.from(unlocks.music),
          replay: Array.from(unlocks.replay),
          endings: Array.from(new Set([...unlocks.ending, ...unlocks.endings])),
        };
      },
      async unlock(kind, id) {
        unlocks[kind].add(id);
        globalRecord = currentGlobalRecord(globalRecord, readText, unlocks);
        await persistenceAdapter.writeGlobal(projectId, globalRecord);
      },
      async resetGlobalProgress() {
        readText.clear();
        unlocks.cg.clear();
        unlocks.music.clear();
        unlocks.replay.clear();
        unlocks.ending.clear();
        unlocks.endings.clear();
        globalRecord = createDefaultGlobalPersistentRecord(projectId, globalDefaults);
        await persistenceAdapter.writeGlobal(projectId, globalRecord);
        progressListeners.forEach((listener) => listener());
      },
      async applyGlobalEffect(input) {
        return mutate(async () => {
          const applied = new Set(globalRecord.appliedGlobalEffects[input.playthroughId] ?? []);
          if (applied.has(input.effectKey)) return { applied: false };
          applied.add(input.effectKey);
          const nextRecord = {
            ...currentGlobalRecord(globalRecord, readText, unlocks),
            globalVars: { ...globalRecord.globalVars, [input.key]: input.value },
            appliedGlobalEffects: { ...globalRecord.appliedGlobalEffects, [input.playthroughId]: [...applied] },
          };
          await persistenceAdapter.writeGlobal(projectId, nextRecord);
          globalRecord = nextRecord;
          return { applied: true };
        });
      },
      async completeEnding(input) {
        return mutate(async () => {
          if (options.manifest && !options.manifest.unlocks?.endings?.[input.endingId]) {
            throw new RuntimePersistenceError(
              "missing_ending_ref",
              `Ending "${input.endingId}" is not registered in the manifest.`,
            );
          }
          const settled = globalRecord.settledEndings[input.playthroughId]?.[input.endingId];
          if (settled) return { settled: false };
          const endings = { ...(globalRecord.settledEndings[input.playthroughId] ?? {}), [input.endingId]: { completedAt: now() } };
          const nextUnlocks = cloneUnlockSets(unlocks);
          nextUnlocks.endings.add(input.endingId);
          const nextRecord = {
            ...currentGlobalRecord(globalRecord, readText, nextUnlocks),
            playthroughCount: globalRecord.playthroughCount + 1,
            lastEndingId: input.endingId,
            settledEndings: { ...globalRecord.settledEndings, [input.playthroughId]: endings },
          };
          await persistenceAdapter.writeGlobal(projectId, nextRecord);
          globalRecord = nextRecord;
          unlocks.endings.add(input.endingId);
          progressListeners.forEach((listener) => listener());
          return { settled: true };
        });
      },
    },
    progress: {
      getSummary() {
        const current = Object.keys(globalRecord.settledEndings[options.createSnapshot?.().playthroughId ?? ""] ?? {});
        return { playthroughCount: globalRecord.playthroughCount, lastEndingId: globalRecord.lastEndingId, currentPlaythroughEndingIds: current };
      },
      subscribe(listener) { progressListeners.add(listener); return () => progressListeners.delete(listener); },
    },
    settings: {
      getSettings() {
        return cloneSettings(settings);
      },
      async updateSettings(patch) {
        await mutate(async () => {
          const nextSettings = resolveRuntimeSettings(mergeSettings(settings, patch), settingsFallback);
          await persistenceAdapter.writeSettings(projectId, nextSettings);
          settings = nextSettings;
          options.audio?.setVolumes?.(nextSettings.volumes);
          options.onSettingsChanged?.(cloneSettings(nextSettings));
        });
      },
    },
    audio: {
      replayVoice: (voiceId) => {
        const replayVoice = options.audio?.replayVoice ?? (() => unavailable("audio", "replayVoice"));
        replayVoice(voiceId);
      },
      playMusic: (audioId, playbackOptions) => {
        const playMusic = options.audio?.playMusic ?? (() => unavailable("audio", "playMusic"));
        playMusic(audioId, playbackOptions);
      },
      stopMusic: (fadeMs) => {
        const stopMusic = options.audio?.stopMusic ?? options.audio?.stopBgm ?? (() => unavailable("audio", "stopMusic"));
        stopMusic(fadeMs);
      },
      stopBgm: (fadeMs) => {
        const stopBgm = options.audio?.stopBgm ?? (() => unavailable("audio", "stopBgm"));
        stopBgm(fadeMs);
      },
      pauseBgm: () => {
        const pauseBgm = options.audio?.pauseBgm ?? (() => unavailable("audio", "pauseBgm"));
        pauseBgm();
      },
      resumeBgm: () => {
        const resumeBgm = options.audio?.resumeBgm ?? (() => unavailable("audio", "resumeBgm"));
        resumeBgm();
      },
      stopVoice: () => {
        const stopVoice = options.audio?.stopVoice ?? (() => unavailable("audio", "stopVoice"));
        stopVoice();
      },
      stopAllSfx: () => {
        const stopAllSfx = options.audio?.stopAllSfx ?? (() => unavailable("audio", "stopAllSfx"));
        stopAllSfx();
      },
    },
    gallery: {
      isUnlocked(kind, id) {
        if (kind === "endings") return unlocks.endings.has(id) || unlocks.ending.has(id);
        return unlocks[kind].has(id);
      },
      listCg() {
        const registry = options.manifest?.unlocks?.cg ?? {};
        return Object.entries(registry)
          .filter(([id]) => unlocks.cg.has(id))
          .map(([id, entry]) => ({
            id,
            assetId: entry.assetId,
            title: entry.title,
            asset: options.manifest?.cg?.[entry.assetId],
          }));
      },
      listMusic() {
        const registry = options.manifest?.unlocks?.music ?? {};
        return Object.entries(registry)
          .filter(([id]) => unlocks.music.has(id))
          .map(([id, entry]) => ({
            id,
            audioId: entry.audioId,
            title: entry.title,
            asset: options.manifest?.audio.bgm[entry.audioId],
          }));
      },
      listReplays() {
        const registry = options.manifest?.unlocks?.replay ?? {};
        return Object.entries(registry)
          .filter(([id]) => unlocks.replay.has(id))
          .map(([id, entry]) => ({ id, nodeId: entry.nodeId, title: entry.title }));
      },
      listEndings() {
        const registry = options.manifest?.unlocks?.endings ?? {};
        const endingUnlocks = new Set([...unlocks.ending, ...unlocks.endings]);
        return Object.entries(registry)
          .filter(([id]) => endingUnlocks.has(id))
          .map(([id, entry]) => ({ id, title: entry.title, nodeId: entry.nodeId }));
      },
    },
    replay: {
      start(replayId) {
        const entry = options.manifest?.unlocks?.replay?.[replayId];
        if (!entry || !unlocks.replay.has(replayId)) {
          return unavailable("replay", "start");
        }
        const startReplay = options.startReplay ?? (() => unavailable("replay", "start"));
        const result = startReplay(entry.nodeId);
        if (result && typeof (result as Promise<void | RuntimeRestoreResult>).then === "function") {
          return (result as Promise<void | RuntimeRestoreResult>).then((value) => value ?? { warnings: [] });
        }
        return (result as RuntimeRestoreResult | undefined) ?? { warnings: [] };
      },
    },
    media: {
      closeCg: () => options.media?.closeCg?.(),
      skipVideo: () => options.media?.skipVideo?.(),
    },
    status: {
      getNotices() {
        return statusNotices.map((notice) => ({ ...notice }));
      },
      subscribe(listener) {
        statusListeners.add(listener);
        return () => statusListeners.delete(listener);
      },
      report(notice) {
        statusNotices.push({ ...notice, id: ++statusNoticeId });
        for (const listener of statusListeners) listener();
      },
    },
    debug: {
      inspectState: () => options.inspectState?.() ?? options.getState(),
      inspectRuntimeSnapshot: snapshot,
      jumpTo: (point) => {
        const jumpTo = options.jumpTo ?? (() => unavailable("debug", "jumpTo"));
        jumpTo(point);
      },
    },
  };
}

function readKeyId(key: ReadTextKey): string {
  return `${key.nodeId}\u0000${key.instructionId}\u0000${key.textHash}`;
}

function savePreviewFromState(state: NovelState): SavePreview {
  const text = state.dialogue?.text ?? state.narration?.text;
  return {
    ...(text ? { text } : {}),
    background: state.background,
  };
}

function cloneSettings(settings: RuntimeSettingsRecord): RuntimeSettingsRecord {
  return {
    ...settings,
    volumes: { ...settings.volumes },
  };
}

function mergeSettings(current: RuntimeSettingsRecord, patch: Partial<RuntimeSettingsRecord>): RuntimeSettingsRecord {
  return migrateRuntimeSettingsRecord({
    ...current,
    ...patch,
    schemaVersion: RUNTIME_RECORD_SCHEMA_VERSION,
    volumes: { ...current.volumes, ...patch.volumes },
  });
}

function currentGlobalRecord(
  current: GlobalPersistentRecord,
  readText: Map<string, ReadTextKey>,
  unlocks: Record<UnlockKind, Set<string>>,
) {
  return migrateGlobalPersistentRecord({
    schemaVersion: RUNTIME_RECORD_SCHEMA_VERSION,
    projectId: current.projectId,
    readText: Array.from(readText.values()).map((key) => ({ ...key })),
    unlockedCg: Array.from(unlocks.cg),
    unlockedMusic: Array.from(unlocks.music),
    unlockedReplays: Array.from(unlocks.replay),
    unlockedEndings: Array.from(new Set([...unlocks.ending, ...unlocks.endings])),
    playthroughCount: current.playthroughCount,
    globalVars: current.globalVars,
    lastEndingId: current.lastEndingId,
    settledEndings: current.settledEndings,
    appliedGlobalEffects: current.appliedGlobalEffects,
  }, current.projectId);
}

function cloneUnlockSets(unlocks: Record<UnlockKind, Set<string>>): Record<UnlockKind, Set<string>> {
  return {
    cg: new Set(unlocks.cg),
    music: new Set(unlocks.music),
    replay: new Set(unlocks.replay),
    ending: new Set(unlocks.ending),
    endings: new Set(unlocks.endings),
  };
}
