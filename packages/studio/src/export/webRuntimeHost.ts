import React from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  AudioEngine,
  GraphNovelPlayer,
  ProjectGraphSchema,
  RENDERER_CONTRACT_VERSION,
  RuntimeSettingsRecordSchema,
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

  return {
    ...adapter,
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
  const player = new GraphNovelPlayer({
    meta: content.meta as Meta,
    manifest: content.manifest as Manifest,
    persistent: {
      getReadStatus: (key) => runtimeServices?.persistent.getReadStatus(key) ?? false,
      markRead: (key) => runtimeServices?.persistent.markRead(key),
    },
    replayVoice: (voiceId) => audio?.replayVoice(voiceId),
    onRuntimeEffect: (effect) => {
      if (effect.type === "unlock") {
        void runtimeServices?.persistent.unlock(effect.kind, effect.id);
      } else {
        publishMedia(runtimeMediaFromEffect(effect, content.manifest as Manifest, options.contentBase));
      }
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
  });
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
    options.nodes.map((node, index) => ({
      id: node.id,
      instructions: (content.chapters[index] ?? []) as Instruction[],
    })),
  );

  const unsubscribe = player.subscribe((nextState) => {
    state = { ...nextState };
    audio?.sync(nextState);
    listeners.forEach((listener) => listener(state));
  });

  const controls: RuntimeControls = {
    advance: () => player.advance(),
    choose: (toNodeId) => player.choose(toNodeId),
    setAutoPlay: (on) => player.setAutoPlay(on),
    setSkipMode: (mode) => player.setSkipMode(mode),
    rollbackTo: (point) => player.jumpToStoryPoint(point),
    restart: () => player.restart(),
  };
  runtimeServices = createWebRuntimeServices({
    projectId,
    state: () => state,
    storage,
    initialGlobal: storage.readGlobalSync?.(projectId),
    manifest: content.manifest as Manifest,
    createSnapshot: () => player.createSnapshot(),
    restoreFromSave: (record) => player.restoreFromSave(record),
    decisionLog: () => player.getDecisionLog(),
    getBacklog: () => player.getBacklog(),
    rollbackHistoryEntry: (entryId) => player.rollbackToHistoryEntry(entryId),
    replayVoice: (entryId) => player.replayVoice(entryId),
    startReplay: (nodeId) => player.startReplay(nodeId),
    audio,
    initialSettings: settings,
    settingsFallback: {
      textSpeedCps: content.meta.typingSpeedCps,
      autoAdvanceMs: content.meta.autoAdvanceMs,
    },
    onSettingsChanged: (nextSettings) => {
      player.setPlaybackTiming({
        textSpeedCps: nextSettings.textSpeedCps ?? content.meta.typingSpeedCps,
        autoAdvanceMs: nextSettings.autoAdvanceMs ?? content.meta.autoAdvanceMs,
      });
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
    advance: () => player.advance(),
    choose: (toNodeId) => player.choose(toNodeId),
    restart: () => player.restart(),
    toggleAuto: () => player.setAutoPlay(!player.getState().flags.isAutoPlay),
    toggleRecording: () => player.setRecording(!player.getState().flags.isRecording),
    rendererProps: makeRendererProps,
    getMedia: () => media,
    closeMedia,
    skipVideo,
    dispose() {
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
    runtime.advance();
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
  if (!services) throw new Error("Default renderer UI smoke requires runtime services.");
  await waitForCondition(
    async () => (await services.save.listSlots()).some((slot) => slot.slotId === "quick"),
    "quick save did not persist across reload",
  );
  if (Math.abs(services.settings.getSettings().volumes.master - 0.55) > 0.001) {
    throw new Error("runtime settings did not persist across reload");
  }

  await clickUiButton('[data-player-action="quick-load"]');
  await waitForCondition(() => visibleRuntimeText(runtime) === previous.savedText, "quick load did not restore the saved text");

  const stage = await waitForUiElement<HTMLElement>('[data-player-stage="true"]');
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
  if (!services) throw new Error("Default renderer UI smoke requires runtime services.");
  const stage = await waitForUiElement<HTMLElement>('[data-player-stage="true"]');
  await verifyDefaultPlayerLayouts(stage, false);
  const initialState = JSON.stringify(runtime.getState());

  await clickUiButton('[data-player-action="auto"]');
  await waitForCondition(() => runtime.getState().flags.isAutoPlay, "auto HUD control did not enable auto playback");
  await clickUiButton('[data-player-action="quick-load"]');
  const missingQuickAlert = await waitForUiElement<HTMLElement>('[data-player-menu="save"] [role="alert"]');
  if (!missingQuickAlert.textContent?.includes("runtime_save_slot_not_found")) {
    throw new Error("missing quick-load error was not visible in the save menu");
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
  await clickUiButton('[data-settings-action="save"]');
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

async function waitForUiElement<T extends Element = Element>(selector: string): Promise<T> {
  let found: T | null = null;
  await waitForCondition(() => {
    found = document.querySelector<T>(selector);
    return found != null;
  }, `UI element was not rendered: ${selector}`);
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
  createSnapshot: () => ReturnType<GraphNovelPlayer["createSnapshot"]>;
  restoreFromSave: GraphNovelPlayer["restoreFromSave"];
  decisionLog: GraphNovelPlayer["getDecisionLog"];
  getBacklog: GraphNovelPlayer["getBacklog"];
  rollbackHistoryEntry: GraphNovelPlayer["rollbackToHistoryEntry"];
  replayVoice: GraphNovelPlayer["replayVoice"];
  startReplay: GraphNovelPlayer["startReplay"];
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
    createSnapshot: options.createSnapshot,
    restoreFromSave: options.restoreFromSave,
    decisionLog: options.decisionLog,
    getBacklog: options.getBacklog,
    rollbackHistoryEntry: options.rollbackHistoryEntry,
    replayVoice: options.replayVoice,
    startReplay: options.startReplay,
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
  const nodes = await Promise.all(graph.nodes.map(async (node) => ({
    id: node.id,
    instructions: await fetchJson<Instruction[]>(joinBasePath(basePath, `content/${node.file}`)),
  })));
  return { graph, meta, manifest, nodes };
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
    throw new Error(`Renderer contract mismatch: ${gameManifest.contractVersion}`);
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
