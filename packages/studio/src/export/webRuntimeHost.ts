import React from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  AudioEngine,
  GraphNovelPlayer,
  ProjectGraphSchema,
  RENDERER_CONTRACT_VERSION,
  RuntimeSettingsRecordSchema,
  LocaleTableSchema,
  MetaSchema,
  createDefaultRuntimeSettingsRecord,
  createInMemoryRuntimeServices,
  createRuntimeStorageLikePersistenceAdapter,
  migrateGlobalPersistentRecord,
  migrateRuntimeSettingsRecord,
  resolveRuntimeSettings,
  resolveAsset,
  validateContent,
  validateRendererManifestContract,
  type GraphPlayerNode,
  type GlobalPersistentRecord,
  type Instruction,
  type LocaleTable,
  type Manifest,
  type Meta,
  type NovelState,
  type ProjectGraphData,
  type RendererManifest,
  type RendererProps,
  type RuntimeControls,
  type RuntimePersistenceAdapter,
  type RuntimeServices,
  type RuntimeSettingsRecord,
  type VariableRegistry,
  VariableRegistrySchema,
} from "@vibegal/engine";
import { RuntimeMediaOverlay, runtimeMediaFromEffect, type RuntimeMediaState } from "../features/preview/RuntimeMediaOverlay";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface RuntimeStorageAdapter extends RuntimePersistenceAdapter {
  warnings: string[];
  readGlobalSync?(projectId: string): GlobalPersistentRecord;
  readSettingsSync?(projectId: string): RuntimeSettingsRecord;
  listSaveSlots(): Promise<string[]>;
  getSaveSlot(slotId: string): Promise<unknown | null>;
  setSaveSlot(slotId: string, record: unknown): Promise<void>;
  deleteSaveSlot(projectId: string, slotId: string): Promise<void>;
  deleteSaveSlot(slotId: string): Promise<void>;
  getGlobalPersistent(): Promise<unknown | null>;
  setGlobalPersistent(record: unknown): Promise<void>;
  getSettings(): Promise<RuntimeSettingsRecord>;
  setSettings(settings: RuntimeSettingsRecord): Promise<void>;
}

export interface WebRuntimePlayer {
  getState(): NovelState;
  subscribe(listener: (state: NovelState) => void): () => void;
  advance(): void;
  submitName(value: string): boolean | void;
  choose(toNodeId: string): void;
  restart(): void;
  toggleAuto(): void;
  toggleRecording(): void;
  rendererProps(state?: NovelState): RendererProps;
  getMedia(): RuntimeMediaState;
  closeMedia(): void;
  skipVideo(): void;
  dispose(): void;
}

export interface WebRuntimePlayerOptions {
  meta: unknown;
  manifest: unknown;
  graph: unknown;
  nodes: GraphPlayerNode[];
  contentBase: string;
  projectId?: string;
  storage?: RuntimeStorageAdapter;
  initialSettings?: RuntimeSettingsRecord;
  locales?: Record<string, LocaleTable>;
  variables?: VariableRegistry;
}

export const VIBEGAL_BUILD_SCHEMA_VERSION = 1;

export interface WebRuntimeBehaviorSmokeResult {
  advanced: boolean;
  branch: "chosen" | "not-present";
  saveRoundTrip: boolean;
  media: "loaded" | "not-configured";
}

export function storyProgressFingerprint(state: NovelState): string {
  return JSON.stringify({
    ...state,
    dialogue: state.dialogue ? { ...state.dialogue, typedLen: 0, fullyRevealed: false } : null,
    narration: state.narration ? { ...state.narration, typedLen: 0, fullyRevealed: false } : null,
  });
}

function browserStorage(): StorageLike | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

export function defaultRuntimeSettings(): RuntimeSettingsRecord {
  return createDefaultRuntimeSettingsRecord();
}

interface WebThumbnailStore {
  write(projectId: string, key: string, data: Blob): Promise<void>;
  read(projectId: string, key: string): Promise<Blob | null>;
  delete(projectId: string, key: string): Promise<void>;
}

function createWebThumbnailStore(): WebThumbnailStore {
  if (typeof globalThis.indexedDB === "undefined") {
    const memory = new Map<string, Blob>();
    const key = (projectId: string, thumbnailId: string) =>
      `${projectId}\u0000${thumbnailId}`;
    return {
      async write(projectId, thumbnailId, data) {
        memory.set(key(projectId, thumbnailId), data);
      },
      async read(projectId, thumbnailId) {
        return memory.get(key(projectId, thumbnailId)) ?? null;
      },
      async delete(projectId, thumbnailId) {
        memory.delete(key(projectId, thumbnailId));
      },
    };
  }

  const database = openThumbnailDatabase(globalThis.indexedDB);
  const transact = async <T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason: unknown) => void) => void,
  ): Promise<T> => new Promise<T>((resolve, reject) => {
    database.then((db) => {
      const transaction = db.transaction("thumbnails", mode);
      operation(transaction.objectStore("thumbnails"), resolve, reject);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    }, reject);
  });
  const key = (projectId: string, thumbnailId: string) => [projectId, thumbnailId];

  return {
    write(projectId, thumbnailId, data) {
      return transact<void>("readwrite", (store, resolve, reject) => {
        const request = store.put(data, key(projectId, thumbnailId));
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    },
    read(projectId, thumbnailId) {
      return transact<Blob | null>("readonly", (store, resolve, reject) => {
        const request = store.get(key(projectId, thumbnailId));
        request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
        request.onerror = () => reject(request.error);
      });
    },
    delete(projectId, thumbnailId) {
      return transact<void>("readwrite", (store, resolve, reject) => {
        const request = store.delete(key(projectId, thumbnailId));
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    },
  };
}

function openThumbnailDatabase(indexedDb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDb.open("vibegal-runtime-assets", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("thumbnails")) {
        request.result.createObjectStore("thumbnails");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function createWebStorageAdapter(
  projectId: string,
  storage: StorageLike | null = browserStorage(),
): RuntimeStorageAdapter {
  const warnings: string[] = [];
  const memory = new Map<string, string>();
  let useMemory = storage == null;
  const store = storage ?? {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value); },
    removeItem: (key: string) => { memory.delete(key); },
  };

  if (!storage) warnings.push("localStorage unavailable; using in-memory runtime storage.");

  const safeStore: StorageLike = {
    getItem: (key) => {
      if (useMemory) return memory.get(key) ?? null;
      try {
        return store.getItem(key);
      } catch {
        useMemory = true;
        warnings.push(`Failed to read runtime storage key: ${key}; using in-memory runtime storage.`);
        return memory.get(key) ?? null;
      }
    },
    setItem: (key, value) => {
      if (useMemory) {
        memory.set(key, value);
        return;
      }
      try {
        store.setItem(key, value);
      } catch {
        useMemory = true;
        warnings.push(`Failed to write runtime storage key: ${key}; using in-memory runtime storage.`);
        memory.set(key, value);
      }
    },
    removeItem: (key) => {
      if (useMemory) {
        memory.delete(key);
        return;
      }
      try {
        store.removeItem(key);
      } catch {
        useMemory = true;
        warnings.push(`Failed to remove runtime storage key: ${key}; using in-memory runtime storage.`);
        memory.delete(key);
      }
    },
  };
  const adapter = createRuntimeStorageLikePersistenceAdapter({
    storage: safeStore,
    keyPrefix: "vibegal",
    warnings,
  });
  const key = (kind: "save" | "saveIndex" | "global" | "settings", id?: string) =>
    id ? `vibegal:${projectId}:${kind}:${id}` : `vibegal:${projectId}:${kind}`;
  const readRaw = (storageKey: string): unknown | null => {
    try {
      const raw = safeStore.getItem(storageKey);
      return raw == null ? null : JSON.parse(raw);
    } catch {
      warnings.push(`Failed to read runtime storage key: ${storageKey}`);
      return null;
    }
  };
  const writeRaw = (storageKey: string, value: unknown) => {
    safeStore.setItem(storageKey, JSON.stringify(value));
  };
  const readSaveIndex = () => {
    const raw = readRaw(key("saveIndex"));
    return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
  };

  const thumbnails = createWebThumbnailStore();
  const thumbnailId = (slotId: string) =>
    `${encodeURIComponent(slotId)}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;

  return {
    ...adapter,
    async writeThumbnail(readProjectId, slotId, data) {
      const id = thumbnailId(slotId);
      await thumbnails.write(readProjectId, id, data);
      return id;
    },
    readThumbnail(readProjectId, id) {
      return thumbnails.read(readProjectId, id);
    },
    deleteThumbnail(readProjectId, id) {
      return thumbnails.delete(readProjectId, id);
    },
    warnings,
    readGlobalSync(readProjectId) {
      const raw = readRaw(`vibegal:${readProjectId}:global`);
      return migrateGlobalPersistentRecord(raw, readProjectId);
    },
    readSettingsSync(readProjectId) {
      const raw = readRaw(`vibegal:${readProjectId}:settings`);
      return migrateRuntimeSettingsRecord(raw);
    },
    async listSaveSlots() {
      return adapter.listSaveSlots(projectId);
    },
    async getSaveSlot(slotId) {
      return readRaw(key("save", slotId));
    },
    async setSaveSlot(slotId, record) {
      writeRaw(key("save", slotId), record);
      writeRaw(key("saveIndex"), Array.from(new Set([...readSaveIndex(), slotId])).sort());
    },
    async deleteSaveSlot(projectOrSlotId: string, maybeSlotId?: string) {
      await adapter.deleteSaveSlot(
        maybeSlotId == null ? projectId : projectOrSlotId,
        maybeSlotId ?? projectOrSlotId,
      );
    },
    async getGlobalPersistent() {
      return readRaw(key("global"));
    },
    async setGlobalPersistent(record) {
      writeRaw(key("global"), record);
    },
    async getSettings() {
      return adapter.readSettings(projectId);
    },
    async setSettings(settings) {
      await adapter.writeSettings(projectId, RuntimeSettingsRecordSchema.parse(settings));
    },
  };
}

export function resetWebRuntimeSmokeStorage(
  projectId: string,
  storage: StorageLike | null = browserStorage(),
): void {
  if (!storage) return;
  const prefix = `vibegal:${projectId}`;
  try {
    const rawIndex = storage.getItem(`${prefix}:saveIndex`);
    const slotIds = rawIndex == null ? [] : JSON.parse(rawIndex);
    if (Array.isArray(slotIds)) {
      for (const slotId of slotIds) {
        if (typeof slotId === "string") storage.removeItem(`${prefix}:save:${slotId}`);
      }
    }
    storage.removeItem(`${prefix}:saveIndex`);
    storage.removeItem(`${prefix}:global`);
    storage.removeItem(`${prefix}:settings`);
  } catch {
    // A blocked storage backend already falls back safely when the adapter is created.
  }
}

export function runtimeStorageProjectId(projectId: string, smokeRequested: boolean): string {
  return smokeRequested ? `${projectId}:__smoke__` : projectId;
}

export function createWebRuntimePlayer(options: WebRuntimePlayerOptions): WebRuntimePlayer {
  const content = validateContent({
    meta: options.meta,
    manifest: options.manifest,
    chapters: options.nodes.map((node) => ({ file: `${node.id}.json`, data: node.instructions })),
  });
  const graph = ProjectGraphSchema.parse(options.graph);
  const projectId = options.projectId ?? "web-export";
  const storage = options.storage ?? createWebStorageAdapter(projectId);
  const settings = resolveRuntimeSettings(
    options.initialSettings ?? storage.readSettingsSync?.(projectId) ?? defaultRuntimeSettings(),
    {
    textSpeedCps: content.meta.typingSpeedCps,
    autoAdvanceMs: content.meta.autoAdvanceMs,
    },
  );
  let runtimeServices!: RuntimeServices;
  let audio: AudioEngine | null = null;
  let primaryPlayer!: GraphNovelPlayer;
  let replayPlayer: GraphNovelPlayer | null = null;
  let replayUnsubscribe: (() => void) | null = null;
  let activePlayer!: GraphNovelPlayer;
  let replayActive = false;
  const replayListeners = new Set<(active: boolean) => void>();
  const graphNodes = options.nodes.map((node, index) => ({
    id: node.id,
    instructions: (content.chapters[index] ?? []) as Instruction[],
  }));
  const publishReplayActive = (active: boolean) => {
    replayActive = active;
    replayListeners.forEach((listener) => listener(active));
  };
  const player = new GraphNovelPlayer({
    meta: content.meta as Meta,
    manifest: content.manifest as Manifest,
    locales: options.locales,
    currentLocale: settings.currentLocale ?? content.meta.locale?.default,
    variables: options.variables,
    globalState: () => {
      const record = storage.readGlobalSync?.(projectId);
      return { vars: record?.globalVars ?? {}, playthroughCount: record?.playthroughCount ?? 0, lastEndingId: record?.lastEndingId ?? null };
    },
    persistent: {
      getReadStatus: (key) => runtimeServices?.persistent.getReadStatus(key) ?? false,
      markRead: (key) => runtimeServices?.persistent.markRead(key),
    },
    replayVoice: (voiceId) => audio?.replayVoice(voiceId),
    onRuntimeTextDiagnostic: ({ storyPoint, diagnostic }) => {
      runtimeServices?.status?.report({
        level: "warning",
        code: diagnostic.code,
        message: `${storyPoint.nodeId} / ${storyPoint.instructionId}: ${diagnostic.message}`,
      });
    },
    onRuntimeEffect: (effect) => {
      if (effect.type === "unlock") {
        void runtimeServices?.persistent.unlock(effect.kind, effect.id);
      } else if (effect.type === "completeEnding" && effect.playthroughId) {
        return runtimeServices?.persistent.completeEnding({ playthroughId: effect.playthroughId, endingId: effect.endingId }).then(() => undefined);
      } else if (effect.type === "globalSet" && effect.playthroughId && effect.nodeId) {
        return runtimeServices?.persistent.applyGlobalEffect({
          playthroughId: effect.playthroughId,
          effectKey: `${effect.nodeId}:${effect.id}`,
          key: effect.key,
          value: effect.value,
        }).then(() => undefined);
      } else {
        publishMedia(runtimeMediaFromEffect(effect, content.manifest as Manifest, options.contentBase));
      }
      return undefined;
    },
    onStableCheckpoint: (event) => {
      void runtimeServices?.save.autoSave(event.reason).catch((autoSaveError) => {
        runtimeServices.status?.report({
          level: "error",
          code: "runtime_auto_save_failed",
          message: autoSaveError instanceof Error ? autoSaveError.message : String(autoSaveError),
        });
      });
    },
    onChapterReached: (chapterId) => runtimeServices?.persistent.unlockChapter(chapterId),
    onEndingCommitted: () => runtimeServices?.save.autoSave("ending").catch((autoSaveError) => {
      runtimeServices.status?.report({ level: "warning", code: "ending_auto_save_failed", message: autoSaveError instanceof Error ? autoSaveError.message : String(autoSaveError) });
    }),
  });
  primaryPlayer = player;
  activePlayer = player;
  player.setPlaybackTiming({
    textSpeedCps: settings.textSpeedCps,
    autoAdvanceMs: settings.autoAdvanceMs,
  });
  audio = typeof Audio === "undefined" ? null : new AudioEngine(content.manifest as Manifest, options.contentBase);
  audio?.setVolumes(settings.volumes);
  const listeners = new Set<(state: NovelState) => void>();
  let state = player.getState();
  let media: RuntimeMediaState = null;

  function publishMedia(next: RuntimeMediaState) {
    media = next;
    listeners.forEach((listener) => listener(state));
  }

  const closeMedia = () => publishMedia(null);
  const skipVideo = () => {
    if (media?.type === "video" && media.skippable) publishMedia(null);
  };

  player.loadGraph(
    graph as ProjectGraphData,
    graphNodes,
  );

  const unsubscribe = player.subscribe((nextState) => {
    state = { ...nextState };
    audio?.sync(nextState);
    listeners.forEach((listener) => listener(state));
  });

  const replayPlayerDeps = () => ({
    meta: content.meta as Meta,
    manifest: content.manifest as Manifest,
    locales: options.locales,
    currentLocale: runtimeServices.settings.getSettings().currentLocale ?? content.meta.locale?.default,
    variables: options.variables,
    globalState: () => {
      const record = storage.readGlobalSync?.(projectId);
      return {
        vars: record?.globalVars ?? {},
        playthroughCount: record?.playthroughCount ?? 0,
        lastEndingId: record?.lastEndingId ?? null,
      };
    },
    replayVoice: (voiceId: string) => audio?.replayVoice(voiceId),
    onRuntimeTextDiagnostic: ({ storyPoint, diagnostic }: Parameters<NonNullable<ConstructorParameters<typeof GraphNovelPlayer>[0]["onRuntimeTextDiagnostic"]>>[0]) => {
      runtimeServices.status?.report({
        level: "warning",
        code: diagnostic.code,
        message: `${storyPoint.nodeId} / ${storyPoint.instructionId}: ${diagnostic.message}`,
      });
    },
    onRuntimeEffect: (effect: Parameters<NonNullable<ConstructorParameters<typeof GraphNovelPlayer>[0]["onRuntimeEffect"]>>[0]) => {
      if (effect.type !== "unlock" && effect.type !== "completeEnding" && effect.type !== "globalSet") {
        publishMedia(runtimeMediaFromEffect(effect, content.manifest as Manifest, options.contentBase));
      }
      return undefined;
    },
    onPlaybackEnded: () => exitReplay(),
  });

  function exitReplay() {
    if (!replayPlayer && !replayActive) return;
    replayUnsubscribe?.();
    replayUnsubscribe = null;
    replayPlayer?.dispose();
    replayPlayer = null;
    activePlayer = primaryPlayer;
    state = { ...primaryPlayer.getState() };
    audio?.sync(state);
    publishReplayActive(false);
    listeners.forEach((listener) => listener(state));
  }

  function startReplay(nodeId: string) {
    exitReplay();
    const next = new GraphNovelPlayer(replayPlayerDeps());
    next.setPlaybackTiming({
      textSpeedCps: runtimeServices.settings.getSettings().textSpeedCps ?? content.meta.typingSpeedCps,
      autoAdvanceMs: runtimeServices.settings.getSettings().autoAdvanceMs ?? content.meta.autoAdvanceMs,
    });
    next.loadGraph(graph as ProjectGraphData, graphNodes);
    replayPlayer = next;
    activePlayer = next;
    replayUnsubscribe = next.subscribe((nextState) => {
      state = { ...nextState };
      audio?.sync(nextState);
      listeners.forEach((listener) => listener(state));
    });
    replayActive = true;
    const result = next.startReplay(nodeId);
    if (result.warnings.length > 0) {
      exitReplay();
      return result;
    }
    if (replayPlayer === next) publishReplayActive(true);
    return result;
  }

  const controls: RuntimeControls = {
    advance: () => activePlayer.advance(),
    submitName: (value) => activePlayer.submitName(value),
    choose: (toNodeId) => activePlayer.choose(toNodeId),
    setAutoPlay: (on) => activePlayer.setAutoPlay(on),
    setSkipMode: (mode) => activePlayer.setSkipMode(mode),
    rollbackTo: (point) => activePlayer.jumpToStoryPoint(point),
    restart: () => {
      if (replayActive) exitReplay();
      else primaryPlayer.restart();
    },
  };
  runtimeServices = createWebRuntimeServices({
    projectId,
    state: () => state,
    storage,
    initialGlobal: storage.readGlobalSync?.(projectId),
    manifest: content.manifest as Manifest,
    graph: graph as ProjectGraphData,
    variables: options.variables,
    createSnapshot: () => primaryPlayer.createSnapshot(),
    restoreFromSave: (record) => {
      if (replayActive) exitReplay();
      return primaryPlayer.restoreFromSave(record);
    },
    decisionLog: () => primaryPlayer.getDecisionLog(),
    getBacklog: () => activePlayer.getBacklog(),
    rollbackHistoryEntry: (entryId) => activePlayer.rollbackToHistoryEntry(entryId),
    replayVoice: (entryId) => activePlayer.replayVoice(entryId),
    startChapter: (checkpoint) => {
      if (replayActive) exitReplay();
      return primaryPlayer.startChapter(checkpoint);
    },
    startReplay,
    isReplayActive: () => replayActive,
    exitReplay,
    subscribeReplay: (listener) => {
      replayListeners.add(listener);
      listener(replayActive);
      return () => replayListeners.delete(listener);
    },
    persistenceEnabled: () => !replayActive,
    audio,
    initialSettings: settings,
    settingsFallback: {
      textSpeedCps: content.meta.typingSpeedCps,
      autoAdvanceMs: content.meta.autoAdvanceMs,
    },
    onSettingsChanged: (nextSettings) => {
      const timing = {
        textSpeedCps: nextSettings.textSpeedCps ?? content.meta.typingSpeedCps,
        autoAdvanceMs: nextSettings.autoAdvanceMs ?? content.meta.autoAdvanceMs,
      };
      primaryPlayer.setPlaybackTiming(timing);
      replayPlayer?.setPlaybackTiming(timing);
      const locale = nextSettings.currentLocale ?? content.meta.locale?.default;
      primaryPlayer.setCurrentLocale(locale);
      replayPlayer?.setCurrentLocale(locale);
      listeners.forEach((listener) => listener(state));
    },
    media: { closeCg: closeMedia, skipVideo },
  });
  for (const warning of storage.warnings) {
    runtimeServices.status?.report({
      level: "warning",
      code: warning.includes("localStorage unavailable") ? "runtime_storage_fallback" : "runtime_storage_warning",
      message: warning,
    });
  }

  function makeRendererProps(nextState = state): RendererProps {
    return {
      state: nextState,
      manifest: content.manifest as Manifest,
      contentBase: options.contentBase,
      meta: content.meta as Meta,
      stage: (content.meta as Meta).stage,
      controls,
      runtime: runtimeServices,
    };
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    advance: () => activePlayer.advance(),
    submitName: (value) => activePlayer.submitName(value),
    choose: (toNodeId) => activePlayer.choose(toNodeId),
    restart: () => controls.restart(),
    toggleAuto: () => activePlayer.setAutoPlay(!activePlayer.getState().flags.isAutoPlay),
    toggleRecording: () => activePlayer.setRecording(!activePlayer.getState().flags.isRecording),
    rendererProps: makeRendererProps,
    getMedia: () => media,
    closeMedia,
    skipVideo,
    dispose() {
      replayUnsubscribe?.();
      replayPlayer?.dispose();
      unsubscribe();
      player.dispose();
      audio?.dispose();
      listeners.clear();
    },
  };
}

export async function runWebRuntimeBehaviorSmoke(
  runtime: WebRuntimePlayer,
  fetcher: (input: RequestInfo | URL) => Promise<{ ok: boolean }> = fetch,
): Promise<WebRuntimeBehaviorSmokeResult> {
  const before = JSON.stringify(runtime.getState());
  let advanced = false;
  let branch: WebRuntimeBehaviorSmokeResult["branch"] = "not-present";
  for (let attempt = 0; attempt < 128; attempt += 1) {
    if (runtime.getState().nameInput) {
      runtime.submitName("Smoke Player");
    } else {
      runtime.advance();
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const choice = runtime.getState().choice?.choices[0];
    if (choice) {
      const beforeChoice = JSON.stringify(runtime.getState());
      runtime.choose(choice.to);
      branch = JSON.stringify(runtime.getState()) === beforeChoice ? "not-present" : "chosen";
      advanced = JSON.stringify(runtime.getState()) !== before;
      break;
    }
    if (JSON.stringify(runtime.getState()) !== before) {
      advanced = true;
    }
  }

  let saveRoundTrip = false;
  const save = runtime.rendererProps().runtime?.save;
  if (save) {
    await save.quickSave();
    await save.quickLoad();
    saveRoundTrip = (await save.listSlots()).some((slot) => slot.slotId === "quick");
  }

  const props = runtime.rendererProps();
  const mediaPath = Object.values(props.manifest.cg)[0]?.path
    ?? Object.values(props.manifest.videos)[0]?.path;
  let media: WebRuntimeBehaviorSmokeResult["media"] = "not-configured";
  if (mediaPath) {
    const response = await fetcher(resolveAsset(props.contentBase, mediaPath));
    if (!response.ok) throw new Error(`Smoke media request failed: ${mediaPath}`);
    media = "loaded";
  }

  return { advanced, branch, saveRoundTrip, media };
}

interface UiSmokePhase {
  advanced: boolean;
  branch: WebRuntimeBehaviorSmokeResult["branch"];
  savedText: string;
}

const UI_SMOKE_PHASE_KEY = "vibegal:smoke:player-ui-v1";

export async function runWebRuntimeUiBehaviorSmoke(
  runtime: WebRuntimePlayer,
  fetcher: (input: RequestInfo | URL) => Promise<{ ok: boolean }> = fetch,
): Promise<WebRuntimeBehaviorSmokeResult> {
  const previous = readUiSmokePhase();
  if (!previous) {
    const firstPhase = await runUiSmokeFirstPhase(runtime);
    sessionStorage.setItem(UI_SMOKE_PHASE_KEY, JSON.stringify(firstPhase));
    window.location.reload();
    return new Promise<WebRuntimeBehaviorSmokeResult>(() => {});
  }

  sessionStorage.removeItem(UI_SMOKE_PHASE_KEY);
  const services = runtime.rendererProps().runtime;
  if (!services) throw new Error("默认界面风格 UI 冒烟测试需要运行时服务。");
  // 标题门（Spec 21）：重载后同样先落在标题画面，点「开始游戏」回剧情。
  await clickUiButton('[data-title-action="start"]');
  await waitForCondition(
    () => document.querySelector('[data-ui-part="titleScreen"]') == null,
    "title screen did not close after start (second phase)",
  );
  await waitForCondition(
    async () => (await services.save.listSlots()).some((slot) => slot.slotId === "quick"),
    "quick save did not persist across reload",
  );
  if (Math.abs(services.settings.getSettings().volumes.master - 0.55) > 0.001) {
    throw new Error("runtime settings did not persist across reload");
  }

  await clickUiButton('[data-player-action="quick-load"]');
  await waitForCondition(() => visibleRuntimeText(runtime) === previous.savedText, "quick load did not restore the saved text");

  // reload 后渲染层需重新编译挂载，同样用放宽窗口（Windows CI 冷启动）。
  const stage = await waitForUiElement<HTMLElement>('[data-player-stage="true"]', 30_000);
  stage.click();
  await waitForCondition(() => services.history.getBacklog().length > 0, "history did not update after restored playback");
  await clickUiButton('[data-player-action="history"]');
  await waitForUiElement('[data-player-menu="history"] [data-history-entry]');
  const rollbackEntry = services.history.getBacklog().at(-1);
  if (!rollbackEntry) throw new Error("history rollback smoke requires a backlog entry");
  await clickUiButton('[data-player-menu="history"] [data-history-action="rollback"]');
  await waitForUiElement('[data-vibegal-confirm="true"]');
  await clickUiButton('[data-confirm-action="confirm"]');
  await waitForCondition(
    () => document.querySelector('[data-player-menu]') == null
      && document.querySelector('[data-vibegal-confirm]') == null
      && visibleRuntimeText(runtime) === rollbackEntry.text,
    "history rollback did not restore the selected entry and close the menu",
  );

  const props = runtime.rendererProps();
  const mediaPath = Object.values(props.manifest.cg)[0]?.path
    ?? Object.values(props.manifest.videos)[0]?.path;
  let media: WebRuntimeBehaviorSmokeResult["media"] = "not-configured";
  if (mediaPath) {
    const response = await fetcher(resolveAsset(props.contentBase, mediaPath));
    if (!response.ok) throw new Error(`Smoke media request failed: ${mediaPath}`);
    media = "loaded";
  }

  return {
    advanced: previous.advanced,
    branch: previous.branch,
    saveRoundTrip: true,
    media,
  };
}

async function runUiSmokeFirstPhase(runtime: WebRuntimePlayer): Promise<UiSmokePhase> {
  const services = runtime.rendererProps().runtime;
  if (!services) throw new Error("默认界面风格 UI 冒烟测试需要运行时服务。");
  // 首次 stage 等待要覆盖冷启动全链路（渲染层编译 + React 挂载）：
  // CI Windows runner 冷启动 5s 默认窗口不够（smoke_behavior_failed）。
  const stage = await waitForUiElement<HTMLElement>('[data-player-stage="true"]', 30_000);
  // 标题门（Spec 21 §7）：真实启动先呈现标题画面——先断言「开始游戏」出现并
  // 点击，再做 stage-click 推进断言，标题门从 smoke 的破坏者变成被测路径。
  await clickUiButton('[data-title-action="start"]');
  await waitForCondition(
    () => document.querySelector('[data-ui-part="titleScreen"]') == null,
    "title screen did not close after start",
  );
  // start 推进首行后打字机仍在走字（typedLen 持续变化）；等首行完整显示，
  // 保证后续"失败 quick-load 不改状态"等对比以稳定快照为基准。
  await waitForCondition(() => {
    const state = runtime.getState();
    const text = state.dialogue ?? state.narration;
    return text != null && text.fullyRevealed;
  }, "title start did not reach a fully revealed story line");
  await verifyDefaultPlayerLayouts(stage, false);
  const initialState = JSON.stringify(runtime.getState());

  await clickUiButton('[data-player-action="auto"]');
  await waitForCondition(() => runtime.getState().flags.isAutoPlay, "auto HUD control did not enable auto playback");
  await clickUiButton('[data-player-action="quick-load"]');
  const missingQuickAlert = await waitForUiElement<HTMLElement>('[data-player-menu="save"] [role="alert"]');
  if (!missingQuickAlert.textContent?.includes("还没有可读取的存档")) {
    throw new Error("missing quick-load error was not visible in the save menu");
  }
  if (missingQuickAlert.textContent.includes("runtime_save_slot_not_found")) {
    throw new Error("missing quick-load exposed an internal error code");
  }
  if (JSON.stringify(runtime.getState()) !== initialState) {
    throw new Error("missing quick-load changed the story state");
  }
  await clickUiButton('[aria-label="关闭玩家菜单"]');

  stage.click();
  await waitForCondition(() => JSON.stringify(runtime.getState()) !== initialState, "stage click did not advance playback");
  const savedText = visibleRuntimeText(runtime);
  if (!savedText) throw new Error("stage click did not reach a visible story point");

  await clickUiButton('[data-player-action="quick-save"]');
  await waitForCondition(
    async () => (await services.save.listSlots()).some((slot) => slot.slotId === "quick"),
    "quick save button did not create the quick slot",
  );

  await clickUiButton('[data-player-action="menu"]');
  const beforeMenuInteraction = storyProgressFingerprint(runtime.getState());
  await clickUiButton('[data-menu-page="history"]');
  const afterMenuInteraction = storyProgressFingerprint(runtime.getState());
  if (afterMenuInteraction !== beforeMenuInteraction) {
    throw new Error(`menu interaction changed playback state: before=${beforeMenuInteraction}; after=${afterMenuInteraction}`);
  }
  await clickUiButton('[data-menu-page="save"]');
  await clickUiButton('[data-player-slot="manual-01"] [data-slot-action="save"]');
  await waitForCondition(
    async () => (await services.save.listSlots()).some((slot) => slot.slotId === "manual-01"),
    "manual save button did not create manual-01",
  );
  await clickUiButton('[aria-label="关闭玩家菜单"]');

  await advanceUiToDifferentText(stage, runtime, savedText);
  const overwrittenText = visibleRuntimeText(runtime);
  if (!overwrittenText || overwrittenText === savedText) throw new Error("manual overwrite setup did not advance playback");
  await clickUiButton('[data-player-action="menu"]');
  await clickUiButton('[data-player-slot="manual-01"] [data-slot-action="save"]');
  await waitForUiElement('[data-vibegal-confirm="true"]');
  await clickUiButton('[data-confirm-action="confirm"]');
  await waitForCondition(
    async () => (await services.save.listSlots()).find((slot) => slot.slotId === "manual-01")?.preview?.text === overwrittenText,
    "manual overwrite did not update manual-01",
  );
  await clickUiButton('[aria-label="关闭玩家菜单"]');

  await advanceUiToDifferentText(stage, runtime, overwrittenText);
  await clickUiButton('[data-player-action="menu"]');
  await clickUiButton('[data-player-slot="manual-01"] [data-slot-action="load"]');
  await waitForCondition(() => visibleRuntimeText(runtime) === overwrittenText, "manual load did not restore manual-01");
  await clickUiButton('[data-player-action="menu"]');
  await clickUiButton('[data-player-slot="manual-01"] [data-slot-action="delete"]');
  await waitForUiElement('[data-vibegal-confirm="true"]');
  await clickUiButton('[data-confirm-action="confirm"]');
  await waitForCondition(
    async () => !(await services.save.listSlots()).some((slot) => slot.slotId === "manual-01"),
    "manual delete did not remove manual-01",
  );
  await clickUiButton('[aria-label="关闭玩家菜单"]');

  let branch: WebRuntimeBehaviorSmokeResult["branch"] = "not-present";
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const choice = document.querySelector<HTMLElement>("[data-choice-to]");
    if (choice) {
      choice.click();
      branch = "chosen";
      await nextUiTurn();
      break;
    }
    if (visibleRuntimeText(runtime) !== savedText) break;
    stage.click();
    await nextUiTurn();
  }

  await clickUiButton('[data-player-action="quick-load"]');
  await waitForCondition(() => visibleRuntimeText(runtime) === savedText, "quick load button did not restore playback");
  await clickUiButton('[data-player-action="history"]');
  await waitForUiElement('[data-player-menu="history"] [data-history-entry]');
  await clickUiButton('[data-menu-page="save"]');
  await waitForUiElement("[data-save-panel]");
  await verifyDefaultPlayerLayouts(stage, true);
  await clickUiButton('[data-menu-page="settings"]');

  const master = await waitForUiElement<HTMLInputElement>("#setting-master");
  setRangeInputValue(master, "0.55");
  await waitForCondition(
    () => Math.abs(services.settings.getSettings().volumes.master - 0.55) < 0.001,
    "settings UI did not persist the master volume",
  );
  await clickUiButton('[aria-label="关闭玩家菜单"]');

  return {
    advanced: JSON.stringify(runtime.getState()) !== initialState,
    branch,
    savedText,
  };
}

async function advanceUiToDifferentText(
  _stage: HTMLElement,
  runtime: WebRuntimePlayer,
  currentText: string,
): Promise<void> {
  await waitForCondition(() => {
    const liveStage = document.querySelector<HTMLElement>('[data-player-stage="true"]');
    return liveStage?.dataset.playerBlocking === "false"
      && document.querySelector('[data-player-menu]') == null
      && document.querySelector('[data-vibegal-confirm]') == null;
  }, "player UI remained blocked after closing the menu");
  for (let attempt = 0; attempt < 16; attempt += 1) {
    if (runtime.getState().nameInput) {
      runtime.submitName("Smoke Player");
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (visibleRuntimeText(runtime) !== currentText && visibleRuntimeText(runtime) != null) return;
      continue;
    }
    if (runtime.getState().flags.isWaiting) {
      await waitForCondition(() => !runtime.getState().flags.isWaiting, "story wait did not complete", 3_000);
      if (visibleRuntimeText(runtime) !== currentText && visibleRuntimeText(runtime) != null) return;
    }
    const liveStage = await waitForUiElement<HTMLElement>('[data-player-stage="true"]');
    liveStage.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (visibleRuntimeText(runtime) !== currentText && visibleRuntimeText(runtime) != null) return;
  }
  const liveStage = document.querySelector<HTMLElement>('[data-player-stage="true"]');
  throw new Error([
    "stage UI did not advance to a different text line",
    `text=${String(visibleRuntimeText(runtime))}`,
    `progress=${runtime.getState().flags.progress.current}/${runtime.getState().flags.progress.total}`,
    `blocking=${liveStage?.dataset.playerBlocking ?? "missing"}`,
  ].join("; "));
}

function readUiSmokePhase(): UiSmokePhase | null {
  const raw = sessionStorage.getItem(UI_SMOKE_PHASE_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<UiSmokePhase>;
    if (typeof value.advanced !== "boolean" || typeof value.savedText !== "string") return null;
    return {
      advanced: value.advanced,
      branch: value.branch === "chosen" ? "chosen" : "not-present",
      savedText: value.savedText,
    };
  } catch {
    return null;
  }
}

function visibleRuntimeText(runtime: WebRuntimePlayer): string | null {
  const state = runtime.getState();
  return state.dialogue?.text ?? state.narration?.text ?? null;
}

function setRangeInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("Unable to set runtime settings range value.");
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function clickUiButton(selector: string): Promise<void> {
  const button = await waitForUiElement<HTMLButtonElement>(selector);
  await waitForCondition(() => !button.disabled, `UI control remained disabled: ${selector}`);
  button.click();
  await nextUiTurn();
}

async function waitForUiElement<T extends Element = Element>(selector: string, timeoutMs?: number): Promise<T> {
  let found: T | null = null;
  await waitForCondition(() => {
    found = document.querySelector<T>(selector);
    return found != null;
  }, `UI element was not rendered: ${selector}`, timeoutMs);
  return found!;
}

async function waitForCondition(
  predicate: () => boolean | Promise<boolean>,
  message: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await nextUiTurn();
  }
  throw new Error(message);
}

function nextUiTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

async function verifyDefaultPlayerLayouts(stage: HTMLElement, menuOpen: boolean): Promise<void> {
  const sizes = [
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
    { width: 960, height: 540 },
    { width: 1024, height: 768 },
  ];
  const originalWidth = stage.style.width;
  const originalHeight = stage.style.height;
  try {
    for (const size of sizes) {
      stage.style.width = `${size.width}px`;
      stage.style.height = `${size.height}px`;
      await nextUiTurn();
      const stageRect = stage.getBoundingClientRect();
      const contained = menuOpen
        ? Array.from(stage.querySelectorAll<HTMLElement>('[data-player-menu], [data-player-menu] > section'))
        : Array.from(stage.querySelectorAll<HTMLElement>('[aria-label="玩家控制"] button'));
      for (const element of contained) {
        const rect = element.getBoundingClientRect();
        if (
          rect.left < stageRect.left - 1
          || rect.top < stageRect.top - 1
          || rect.right > stageRect.right + 1
          || rect.bottom > stageRect.bottom + 1
        ) {
          const label = element.getAttribute("data-player-menu")
            ?? element.getAttribute("data-ui-part")
            ?? element.getAttribute("aria-label")
            ?? element.tagName.toLowerCase();
          throw new Error([
            `player UI overflow at ${size.width}x${size.height}: ${label}`,
            `stage=${formatRect(stageRect)}`,
            `element=${formatRect(rect)}`,
          ].join("; "));
        }
      }
      for (const button of stage.querySelectorAll<HTMLButtonElement>("button")) {
        if (button.offsetParent == null) continue;
        if (button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1) {
          throw new Error(`player button text overflow at ${size.width}x${size.height}: ${button.textContent ?? "button"}`);
        }
      }
    }
  } finally {
    stage.style.width = originalWidth;
    stage.style.height = originalHeight;
    await nextUiTurn();
  }
}

function formatRect(rect: DOMRect): string {
  return `${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.right)},${Math.round(rect.bottom)}`;
}

function createWebRuntimeServices(options: {
  projectId: string;
  state: () => NovelState;
  storage?: RuntimeStorageAdapter;
  initialGlobal?: GlobalPersistentRecord;
  manifest: Manifest;
  graph: ProjectGraphData;
  variables?: VariableRegistry;
  createSnapshot: () => ReturnType<GraphNovelPlayer["createSnapshot"]>;
  restoreFromSave: GraphNovelPlayer["restoreFromSave"];
  decisionLog: GraphNovelPlayer["getDecisionLog"];
  getBacklog: GraphNovelPlayer["getBacklog"];
  rollbackHistoryEntry: GraphNovelPlayer["rollbackToHistoryEntry"];
  replayVoice: GraphNovelPlayer["replayVoice"];
  startChapter: GraphNovelPlayer["startChapter"];
  startReplay: GraphNovelPlayer["startReplay"];
  isReplayActive: () => boolean;
  exitReplay: () => void;
  subscribeReplay: (listener: (active: boolean) => void) => () => void;
  persistenceEnabled: () => boolean;
  audio: AudioEngine | null;
  initialSettings: RuntimeSettingsRecord;
  settingsFallback: { textSpeedCps: number; autoAdvanceMs: number };
  onSettingsChanged: (settings: RuntimeSettingsRecord) => void;
  media: { closeCg: () => void; skipVideo: () => void };
}): RuntimeServices {
  const services = createInMemoryRuntimeServices({
    projectId: options.projectId,
    getState: options.state,
    persistenceAdapter: options.storage,
    initialGlobalPersistent: options.initialGlobal,
    manifest: options.manifest,
    graph: options.graph,
    variables: options.variables,
    createSnapshot: options.createSnapshot,
    restoreFromSave: options.restoreFromSave,
    decisionLog: options.decisionLog,
    getBacklog: options.getBacklog,
    rollbackHistoryEntry: options.rollbackHistoryEntry,
    replayVoice: options.replayVoice,
    startChapter: options.startChapter,
    startReplay: options.startReplay,
    isReplayActive: options.isReplayActive,
    exitReplay: options.exitReplay,
    subscribeReplay: options.subscribeReplay,
    persistenceEnabled: options.persistenceEnabled,
    audio: options.audio
      ? {
          replayVoice: (voiceId) => options.audio?.replayVoice(voiceId),
          playMusic: (audioId, playbackOptions) => options.audio?.playMusic(audioId, playbackOptions),
          stopMusic: (fadeMs) => options.audio?.stopMusic(fadeMs),
          stopBgm: (fadeMs) => options.audio?.stopBgm(fadeMs),
          pauseBgm: () => options.audio?.pauseBgm(),
          resumeBgm: () => options.audio?.resumeBgm(),
          stopVoice: () => options.audio?.stopVoice(),
          stopAllSfx: () => options.audio?.stopAllSfx(),
          setVolumes: (volumes) => options.audio?.setVolumes(volumes),
        }
      : undefined,
    initialSettings: options.initialSettings,
    settingsFallback: options.settingsFallback,
    onSettingsChanged: options.onSettingsChanged,
    media: options.media,
  });
  const { debug: _debug, ...runtimeServices } = services;
  return runtimeServices;
}

function joinBasePath(basePath: string, relPath: string): string {
  const base = basePath.endsWith("/") ? basePath : `${basePath}/`;
  if (base === "./") return `./${relPath}`;
  return `${base}${relPath}`;
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Failed to load ${path}: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

interface GameManifest {
  projectId: string;
  title: string;
  rendererId: string;
  contractVersion: number;
  buildTarget: "web";
  basePath: string;
  builtAt: string;
  vibegalBuildSchemaVersion: number;
}

async function loadExportedContent(basePath: string) {
  const graph = await fetchJson<ProjectGraphData>(joinBasePath(basePath, "content/graph.json"));
  const [meta, manifest] = await Promise.all([
    fetchJson<unknown>(joinBasePath(basePath, "content/meta.json")),
    fetchJson<unknown>(joinBasePath(basePath, "content/manifest.json")),
  ]);
  const parsedMeta = MetaSchema.parse(meta);
  const nodes = await Promise.all(graph.nodes.map(async (node) => ({
    id: node.id,
    instructions: await fetchJson<Instruction[]>(joinBasePath(basePath, `content/${node.file}`)),
  })));
  let variables: VariableRegistry = { version: 1, variables: {} };
  try { variables = VariableRegistrySchema.parse(await fetchJson<unknown>(joinBasePath(basePath, "content/variables.json"))); } catch { /* Old exports have no registry. */ }
  const locales: Record<string, LocaleTable> = {};
  await Promise.all((parsedMeta.locale?.available ?? []).map(async (locale) => {
    try {
      locales[locale] = LocaleTableSchema.parse(
        await fetchJson<unknown>(joinBasePath(basePath, `content/locales/${locale}.json`)),
      );
    } catch { /* Locale files are optional; runtime falls back to source text. */ }
  }));
  return { graph, meta, manifest, nodes, variables, locales };
}

function mountRuntime(root: Root, runtime: WebRuntimePlayer, rendererManifest: RendererManifest) {
  const Renderer = rendererManifest.Component;
  return runtime.subscribe((state) => {
    root.render(React.createElement(
      React.Fragment,
      null,
      React.createElement(Renderer, runtime.rendererProps(state)),
      React.createElement(RuntimeMediaOverlay, {
        media: runtime.getMedia(),
        onClose: runtime.closeMedia,
        onSkip: runtime.skipVideo,
      }),
    ));
  });
}

export async function startVibeGalWebRuntime(rendererManifest: RendererManifest) {
  const issues = validateRendererManifestContract(rendererManifest);
  const error = issues.find((issue) => issue.level === "error");
  if (error) throw new Error(error.message);

  const gameManifest = await fetchJson<GameManifest>("./game.manifest.json");
  if (gameManifest.contractVersion !== RENDERER_CONTRACT_VERSION) {
    throw new Error(`界面风格契约版本不匹配：${gameManifest.contractVersion}`);
  }
  const content = await loadExportedContent(gameManifest.basePath || "./");
  const smokeRequested = new URLSearchParams(window.location.search).get("vibegalSmoke") === "1";
  const storageProjectId = runtimeStorageProjectId(gameManifest.projectId, smokeRequested);
  if (smokeRequested && sessionStorage.getItem(UI_SMOKE_PHASE_KEY) == null) {
    resetWebRuntimeSmokeStorage(storageProjectId);
  }
  const storage = createWebStorageAdapter(storageProjectId);
  const runtime = createWebRuntimePlayer({
    ...content,
    contentBase: joinBasePath(gameManifest.basePath || "./", "content"),
    projectId: storageProjectId,
    storage,
  });
  const rootElement = document.getElementById("root");
  if (!rootElement) throw new Error("Missing #root element.");
  const root = createRoot(rootElement);
  const unsubscribe = mountRuntime(root, runtime, rendererManifest);

  if (smokeRequested) {
    const marker = document.createElement("div");
    marker.hidden = true;
    marker.dataset.vibegalSmoke = "running";
    document.body.append(marker);
    const smoke = rendererManifest.capabilities?.includes("player-ui-v1")
      ? runWebRuntimeUiBehaviorSmoke(runtime)
      : runWebRuntimeBehaviorSmoke(runtime);
    void smoke
      .then((result) => {
        const status = result.advanced && result.saveRoundTrip ? "passed" : "failed";
        marker.dataset.vibegalSmoke = status;
        marker.dataset.vibegalSmokeAdvance = String(result.advanced);
        marker.dataset.vibegalSmokeBranch = result.branch;
        marker.dataset.vibegalSmokeSave = String(result.saveRoundTrip);
        marker.dataset.vibegalSmokeMedia = result.media;
        publishWebRuntimeSmokeResult({
          status,
          advance: String(result.advanced),
          branch: result.branch,
          save: String(result.saveRoundTrip),
          media: result.media,
        });
      })
      .catch((smokeError) => {
        const message = smokeError instanceof Error ? smokeError.message : String(smokeError);
        marker.dataset.vibegalSmoke = "failed";
        marker.dataset.vibegalSmokeError = message;
        publishWebRuntimeSmokeResult({
          status: "failed",
          advance: "false",
          branch: "not-present",
          save: "false",
          media: "not-configured",
          error: message,
        });
      });
  }

  window.addEventListener("keydown", (event) => {
    if (event.key === " " || event.key === "Enter") runtime.advance();
    if (event.key.toLowerCase() === "a") runtime.toggleAuto();
    if (event.key.toLowerCase() === "r") runtime.toggleRecording();
  });

  return { runtime, storage, gameManifest, unsubscribe };
}

function publishWebRuntimeSmokeResult(result: Record<string, string>) {
  const query = new URLSearchParams(result);
  void fetch(`/__vibegal_smoke_result__?${query.toString()}`, {
    cache: "no-store",
  }).catch(() => {
    // The CLI times out with a clear error if the callback server is unavailable.
  });
}
