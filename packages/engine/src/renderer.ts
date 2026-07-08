/**
 * 渲染层契约 —— engine 与可替换渲染层之间的接口定义。
 *
 * 一个渲染层 = 一套读 NovelState 的 React 组件实现。
 * 它存在于「项目内」（每个项目自带 renderers/），开发工具加载它、挂载它。
 * 契约稳定后，换皮 = 换一个遵守本契约的目录，引擎与剧本不动。
 */
import type { ComponentType } from "react";
import type { NovelState } from "./state";
import type { Manifest, Meta } from "./types";
import {
  RUNTIME_RECORD_SCHEMA_VERSION,
  createRuntimeSnapshot,
  createSaveSlotRecord,
  type ReadTextKey,
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
export type UnlockKind = "cg" | "music" | "ending";

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
  load(slotId: string): Promise<void>;
  delete(slotId: string): Promise<void>;
  quickSave(): Promise<void>;
  quickLoad(): Promise<void>;
  autoSave(reason: "node" | "choice" | "manual"): Promise<void>;
}

export interface BacklogEntry {
  id: string;
  storyPoint: StoryPointId;
  speakerName?: string;
  text: string;
  voiceId?: string;
  readKey?: ReadTextKey;
}

export interface HistoryService {
  getBacklog(): BacklogEntry[];
  replayVoice(entryId: string): void;
  rollbackTo(entryId: string): void;
}

export interface UnlockState {
  cg: string[];
  music: string[];
  endings: string[];
}

export interface PersistentService {
  getReadStatus(key: ReadTextKey): boolean;
  markRead(key: ReadTextKey): Promise<void>;
  getUnlocks(): UnlockState;
  unlock(kind: UnlockKind, id: string): Promise<void>;
  resetGlobalProgress(): Promise<void>;
}

export interface RuntimeSettingsService {
  getSettings(): RuntimeSettingsRecord;
  updateSettings(patch: Partial<RuntimeSettingsRecord>): Promise<void>;
}

export interface AudioService {
  replayVoice(): void;
  stopBgm(fadeMs?: number): void;
  pauseBgm(): void;
  resumeBgm(): void;
  stopVoice(): void;
  stopAllSfx(): void;
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
  settings: RuntimeSettingsService;
  audio: AudioService;
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

interface RuntimeAudioBridge extends AudioService {
  setVolumes?(volumes: RuntimeSettingsRecord["volumes"]): void;
}

export interface InMemoryRuntimeServicesOptions {
  projectId?: string;
  getState: () => NovelState;
  currentStoryPoint?: () => StoryPointId | null;
  currentNodeId?: () => string;
  now?: () => string;
  initialBacklog?: BacklogEntry[];
  initialSettings?: RuntimeSettingsRecord;
  audio?: Partial<RuntimeAudioBridge>;
  onSettingsChanged?: (settings: RuntimeSettingsRecord) => void;
  rollbackTo?: (point: StoryPointId) => void;
  replayVoice?: (entryId: string) => void;
  inspectState?: () => NovelState;
  jumpTo?: (point: StoryPointId) => void;
}

export function defaultRuntimeSettings(): RuntimeSettingsRecord {
  return {
    schemaVersion: RUNTIME_RECORD_SCHEMA_VERSION,
    volumes: { master: 1, bgm: 0.8, sfx: 1, voice: 1 },
  };
}

export function createInMemoryRuntimeServices(options: InMemoryRuntimeServicesOptions): RuntimeServices {
  const projectId = options.projectId ?? "studio-preview";
  const now = options.now ?? (() => new Date().toISOString());
  const slots = new Map<string, SaveSlotRecord>();
  const readText = new Set<string>();
  const unlocks: Record<UnlockKind, Set<string>> = {
    cg: new Set(),
    music: new Set(),
    ending: new Set(),
  };
  const backlog = [...(options.initialBacklog ?? [])];
  let settings = cloneSettings(options.initialSettings ?? defaultRuntimeSettings());

  const unavailable = (service: string, method: string): never => {
    throw new RuntimeServiceUnavailableError(service, method);
  };

  const snapshot = () => createRuntimeSnapshot(options.getState(), {
    currentNodeId: options.currentNodeId?.() ?? "preview",
    currentStoryPoint: options.currentStoryPoint?.() ?? null,
  });

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
        return Array.from(slots, ([slotId, slot]) => toSummary(slotId, slot))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      },
      async save(slotId, saveOptions) {
        const existing = slots.get(slotId);
        const slot = createSaveSlotRecord({
          projectId,
          now: now(),
          checkpoint: snapshot(),
          createdAt: existing?.createdAt,
          label: saveOptions?.label ?? existing?.label,
          preview: saveOptions?.preview ?? existing?.preview,
        });
        slots.set(slotId, slot);
        return toSummary(slotId, slot);
      },
      async load(slotId) {
        if (!slots.has(slotId)) unavailable("save", "load");
      },
      async delete(slotId) {
        slots.delete(slotId);
      },
      async quickSave() {
        await this.save("quick");
      },
      async quickLoad() {
        await this.load("quick");
      },
      async autoSave(reason) {
        await this.save(`auto:${reason}`);
      },
    },
    history: {
      getBacklog() {
        return backlog.map((entry) => ({ ...entry, storyPoint: { ...entry.storyPoint }, readKey: entry.readKey ? { ...entry.readKey } : undefined }));
      },
      replayVoice(entryId) {
        if (options.replayVoice) {
          options.replayVoice(entryId);
          return;
        }
        if (options.audio?.replayVoice) {
          options.audio.replayVoice();
          return;
        }
        unavailable("history", "replayVoice");
      },
      rollbackTo(entryId) {
        const entry = backlog.find((item) => item.id === entryId);
        if (!entry) {
          unavailable("history", "rollbackTo");
          return;
        }
        const rollbackTo = options.rollbackTo ?? (() => unavailable("history", "rollbackTo"));
        rollbackTo(entry.storyPoint);
      },
    },
    persistent: {
      getReadStatus(key) {
        return readText.has(readKeyId(key));
      },
      async markRead(key) {
        readText.add(readKeyId(key));
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
      },
      async resetGlobalProgress() {
        readText.clear();
        unlocks.cg.clear();
        unlocks.music.clear();
        unlocks.ending.clear();
      },
    },
    settings: {
      getSettings() {
        return cloneSettings(settings);
      },
      async updateSettings(patch) {
        settings = mergeSettings(settings, patch);
        options.audio?.setVolumes?.(settings.volumes);
        options.onSettingsChanged?.(cloneSettings(settings));
      },
    },
    audio: {
      replayVoice: () => {
        const replayVoice = options.audio?.replayVoice ?? (() => unavailable("audio", "replayVoice"));
        replayVoice();
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

function cloneSettings(settings: RuntimeSettingsRecord): RuntimeSettingsRecord {
  return {
    ...settings,
    volumes: { ...settings.volumes },
  };
}

function mergeSettings(current: RuntimeSettingsRecord, patch: Partial<RuntimeSettingsRecord>): RuntimeSettingsRecord {
  return {
    ...current,
    ...patch,
    schemaVersion: RUNTIME_RECORD_SCHEMA_VERSION,
    volumes: { ...current.volumes, ...patch.volumes },
  };
}
