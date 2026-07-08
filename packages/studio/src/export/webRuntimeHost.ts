import React from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  AudioEngine,
  GraphNovelPlayer,
  ProjectGraphSchema,
  RENDERER_CONTRACT_VERSION,
  RuntimeServiceUnavailableError,
  RuntimeSettingsRecordSchema,
  createInMemoryRuntimeServices,
  createRuntimeSnapshot,
  createSaveSlotRecord,
  validateContent,
  validateRendererManifestContract,
  type GraphPlayerNode,
  type Instruction,
  type Manifest,
  type Meta,
  type NovelState,
  type ProjectGraphData,
  type RendererManifest,
  type RendererProps,
  type RuntimeControls,
  type RuntimeServices,
  type RuntimeSettingsRecord,
  type SaveOptions,
  type SaveSlotRecord,
  type SaveSlotSummary,
  type UnlockKind,
} from "@galstudio/engine";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface RuntimeStorageAdapter {
  warnings: string[];
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

export const GALSTUDIO_BUILD_SCHEMA_VERSION = 1;

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
  const prefix = `galstudio:${projectId}`;
  const store = storage ?? {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value); },
    removeItem: (key: string) => { memory.delete(key); },
  };

  if (!storage) warnings.push("localStorage unavailable; using in-memory runtime storage.");

  function key(kind: "save" | "saveIndex" | "global" | "settings", id?: string) {
    return id ? `${prefix}:${kind}:${id}` : `${prefix}:${kind}`;
  }

  function readSaveIndex(): string[] {
    const raw = read(key("saveIndex"));
    return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
  }

  function writeSaveIndex(ids: string[]) {
    write(key("saveIndex"), Array.from(new Set(ids)).sort());
  }

  function read(rawKey: string): unknown | null {
    try {
      const raw = store.getItem(rawKey);
      return raw == null ? null : JSON.parse(raw);
    } catch {
      warnings.push(`Failed to read runtime storage key: ${rawKey}`);
      return null;
    }
  }

  function write(rawKey: string, value: unknown) {
    try {
      store.setItem(rawKey, JSON.stringify(value));
    } catch {
      warnings.push(`Failed to write runtime storage key: ${rawKey}`);
      memory.set(rawKey, JSON.stringify(value));
    }
  }

  return {
    warnings,
    async listSaveSlots() {
      return readSaveIndex();
    },
    async getSaveSlot(slotId) {
      return read(key("save", slotId));
    },
    async setSaveSlot(slotId, record) {
      write(key("save", slotId), record);
      writeSaveIndex([...readSaveIndex(), slotId]);
    },
    async deleteSaveSlot(slotId) {
      store.removeItem(key("save", slotId));
      writeSaveIndex(readSaveIndex().filter((id) => id !== slotId));
    },
    async getGlobalPersistent() {
      return read(key("global"));
    },
    async setGlobalPersistent(record) {
      write(key("global"), record);
    },
    async getSettings() {
      const raw = read(key("settings"));
      const parsed = RuntimeSettingsRecordSchema.safeParse(raw);
      return parsed.success ? parsed.data : defaultRuntimeSettings();
    },
    async setSettings(settings) {
      write(key("settings"), RuntimeSettingsRecordSchema.parse(settings));
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
  const player = new GraphNovelPlayer({
    meta: content.meta as Meta,
    manifest: content.manifest as Manifest,
  });
  const audio = typeof Audio === "undefined" ? null : new AudioEngine(content.manifest as Manifest, options.contentBase);
  const listeners = new Set<(state: NovelState) => void>();
  let state = player.getState();

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
    setSkipMode: (mode) => {
      if (mode !== "off") throw new RuntimeServiceUnavailableError("controls", "setSkipMode");
    },
    rollbackTo: () => {
      throw new RuntimeServiceUnavailableError("controls", "rollbackTo");
    },
    restart: () => player.restart(),
  };
  const runtimeServices = createWebRuntimeServices({
    projectId: options.projectId ?? "web-export",
    state: () => state,
    graph,
    storage: options.storage,
    audio,
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
    dispose() {
      unsubscribe();
      player.dispose();
      audio?.dispose();
      listeners.clear();
    },
  };
}

function createWebRuntimeServices(options: {
  projectId: string;
  state: () => NovelState;
  graph: ProjectGraphData;
  storage?: RuntimeStorageAdapter;
  audio: AudioEngine | null;
}): RuntimeServices {
  const memory = createInMemoryRuntimeServices({
    projectId: options.projectId,
    getState: options.state,
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
  });
  if (!options.storage) return memory;

  const storage = options.storage;
  let settings = defaultRuntimeSettings();
  const readText = new Set<string>();
  const unlocks: Record<UnlockKind, Set<string>> = {
    cg: new Set(),
    music: new Set(),
    ending: new Set(),
  };

  const snapshot = () => createRuntimeSnapshot(options.state(), {
    currentNodeId: options.graph.entryNodeId || "entry",
    currentStoryPoint: null,
  });
  const toSummary = (slotId: string, slot: SaveSlotRecord): SaveSlotSummary => ({
    slotId,
    label: slot.label,
    preview: slot.preview,
    updatedAt: slot.updatedAt,
    position: slot.position,
  });
  const readKeyId = (key: { nodeId: string; instructionId: string; textHash: string }) =>
    `${key.nodeId}\u0000${key.instructionId}\u0000${key.textHash}`;
  const writeGlobal = async () => {
    await storage.setGlobalPersistent({
      schemaVersion: 1,
      projectId: options.projectId,
      readText: Array.from(readText),
      unlockedCg: Array.from(unlocks.cg),
      unlockedMusic: Array.from(unlocks.music),
      unlockedEndings: Array.from(unlocks.ending),
      playthroughCount: 0,
    });
  };

  return {
    ...memory,
    save: {
      async listSlots() {
        const summaries = await Promise.all((await storage.listSaveSlots()).map(async (slotId) => {
          const raw = await storage.getSaveSlot(slotId);
          return raw && typeof raw === "object"
            ? toSummary(slotId, raw as SaveSlotRecord)
            : null;
        }));
        return summaries
          .filter((summary): summary is SaveSlotSummary => summary != null)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      },
      async save(slotId: string, saveOptions?: SaveOptions) {
        const existing = await storage.getSaveSlot(slotId) as SaveSlotRecord | null;
        const slot = createSaveSlotRecord({
          projectId: options.projectId,
          now: new Date().toISOString(),
          checkpoint: snapshot(),
          createdAt: existing?.createdAt,
          label: saveOptions?.label ?? existing?.label,
          preview: saveOptions?.preview ?? existing?.preview,
        });
        await storage.setSaveSlot(slotId, slot);
        return toSummary(slotId, slot);
      },
      async load(slotId: string) {
        if (!(await storage.getSaveSlot(slotId))) {
          throw new RuntimeServiceUnavailableError("save", "load");
        }
      },
      async delete(slotId: string) {
        await storage.deleteSaveSlot(slotId);
      },
      async quickSave() {
        await this.save("quick");
      },
      async quickLoad() {
        await this.load("quick");
      },
      async autoSave(reason: "node" | "choice" | "manual") {
        await this.save(`auto:${reason}`);
      },
    },
    persistent: {
      getReadStatus(key) {
        return readText.has(readKeyId(key));
      },
      async markRead(key) {
        readText.add(readKeyId(key));
        await writeGlobal();
      },
      getUnlocks() {
        return {
          cg: Array.from(unlocks.cg),
          music: Array.from(unlocks.music),
          endings: Array.from(unlocks.ending),
        };
      },
      async unlock(kind, id) {
        unlocks[kind].add(id);
        await writeGlobal();
      },
      async resetGlobalProgress() {
        readText.clear();
        unlocks.cg.clear();
        unlocks.music.clear();
        unlocks.ending.clear();
        await writeGlobal();
      },
    },
    settings: {
      getSettings() {
        return { ...settings, volumes: { ...settings.volumes } };
      },
      async updateSettings(patch) {
        settings = RuntimeSettingsRecordSchema.parse({
          ...settings,
          ...patch,
          schemaVersion: 1,
          volumes: { ...settings.volumes, ...patch.volumes },
        });
        await storage.setSettings(settings);
        options.audio?.setVolumes(settings.volumes);
      },
    },
  };
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
  galstudioBuildSchemaVersion: number;
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
    root.render(React.createElement(Renderer, runtime.rendererProps(state)));
  });
}

export async function startGalStudioWebRuntime(rendererManifest: RendererManifest) {
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

  window.addEventListener("keydown", (event) => {
    if (event.key === " " || event.key === "Enter") runtime.advance();
    if (event.key.toLowerCase() === "a") runtime.toggleAuto();
    if (event.key.toLowerCase() === "r") runtime.toggleRecording();
  });

  return { runtime, storage, gameManifest, unsubscribe };
}
