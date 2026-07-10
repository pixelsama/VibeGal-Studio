import React from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  AudioEngine,
  GraphNovelPlayer,
  ProjectGraphSchema,
  RENDERER_CONTRACT_VERSION,
  RuntimeSettingsRecordSchema,
  createInMemoryRuntimeServices,
  createRuntimeStorageLikePersistenceAdapter,
  migrateGlobalPersistentRecord,
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
  listSaveSlots(): Promise<string[]>;
  getSaveSlot(slotId: string): Promise<unknown | null>;
  setSaveSlot(slotId: string, record: unknown): Promise<void>;
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
}

export const VIBEGAL_BUILD_SCHEMA_VERSION = 1;

export interface WebRuntimeBehaviorSmokeResult {
  advanced: boolean;
  branch: "chosen" | "not-present";
  saveRoundTrip: boolean;
  media: "loaded" | "not-configured";
}

function browserStorage(): StorageLike | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

export function defaultRuntimeSettings(): RuntimeSettingsRecord {
  return RuntimeSettingsRecordSchema.parse({
    schemaVersion: 1,
    volumes: {
      master: 1,
      bgm: 1,
      sfx: 1,
      voice: 1,
    },
  });
}

export function createWebStorageAdapter(
  projectId: string,
  storage: StorageLike | null = browserStorage(),
): RuntimeStorageAdapter {
  const warnings: string[] = [];
  const memory = new Map<string, string>();
  const store = storage ?? {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value); },
    removeItem: (key: string) => { memory.delete(key); },
  };

  if (!storage) warnings.push("localStorage unavailable; using in-memory runtime storage.");

  const safeStore: StorageLike = {
    getItem: (key) => store.getItem(key),
    setItem: (key, value) => {
      try {
        store.setItem(key, value);
      } catch {
        warnings.push(`Failed to write runtime storage key: ${key}`);
        memory.set(key, value);
      }
    },
    removeItem: (key) => store.removeItem(key),
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
    async deleteSaveSlot(slotId) {
      await adapter.deleteSaveSlot(projectId, slotId);
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

export function createWebRuntimePlayer(options: WebRuntimePlayerOptions): WebRuntimePlayer {
  const content = validateContent({
    meta: options.meta,
    manifest: options.manifest,
    chapters: options.nodes.map((node) => ({ file: `${node.id}.json`, data: node.instructions })),
  });
  const graph = ProjectGraphSchema.parse(options.graph);
  const projectId = options.projectId ?? "web-export";
  const storage = options.storage ?? createWebStorageAdapter(projectId);
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
  });
  audio = typeof Audio === "undefined" ? null : new AudioEngine(content.manifest as Manifest, options.contentBase);
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
    audio,
    media: { closeCg: closeMedia, skipVideo },
  });

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

function createWebRuntimeServices(options: {
  projectId: string;
  state: () => NovelState;
  storage?: RuntimeStorageAdapter;
  initialGlobal?: GlobalPersistentRecord;
  manifest: Manifest;
  createSnapshot: () => ReturnType<GraphNovelPlayer["createSnapshot"]>;
  restoreFromSave: GraphNovelPlayer["restoreFromSave"];
  decisionLog: GraphNovelPlayer["getDecisionLog"];
  audio: AudioEngine | null;
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
    audio: options.audio
      ? {
          replayVoice: () => options.audio?.replayVoice(),
          stopBgm: (fadeMs) => options.audio?.stopBgm(fadeMs),
          pauseBgm: () => options.audio?.pauseBgm(),
          resumeBgm: () => options.audio?.resumeBgm(),
          stopVoice: () => options.audio?.stopVoice(),
          stopAllSfx: () => options.audio?.stopAllSfx(),
          setVolumes: (volumes) => options.audio?.setVolumes(volumes),
        }
      : undefined,
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
  const storage = createWebStorageAdapter(gameManifest.projectId);
  const runtime = createWebRuntimePlayer({
    ...content,
    contentBase: joinBasePath(gameManifest.basePath || "./", "content"),
    projectId: gameManifest.projectId,
    storage,
  });
  const rootElement = document.getElementById("root");
  if (!rootElement) throw new Error("Missing #root element.");
  const root = createRoot(rootElement);
  const unsubscribe = mountRuntime(root, runtime, rendererManifest);

  if (new URLSearchParams(window.location.search).get("vibegalSmoke") === "1") {
    const marker = document.createElement("div");
    marker.hidden = true;
    marker.dataset.vibegalSmoke = "running";
    document.body.append(marker);
    void runWebRuntimeBehaviorSmoke(runtime)
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
