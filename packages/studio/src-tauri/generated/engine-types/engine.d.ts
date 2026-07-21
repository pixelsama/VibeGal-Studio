// ============================================================
// 由 VibeGal-Studio 生成，请勿手改。
// 来源：packages/engine/src/rendererPublic.ts（@vibegal/engine 渲染层契约面）
// 重新生成：node packages/studio/scripts/generate-engine-types.mjs
// 漂移检查：pnpm check:engine-types
// ============================================================

declare module "@vibegal/engine" {

// React 类型由 .galstudio/types/react.d.ts（最小 shim）提供。
import type { ComponentType } from "react";

  /** 台上一个立绘。pos 是剧本原始槽名（如 "center"），坐标由组件自行解释。
   *
   * 演出语义字段（中立，渲染层自由决定怎么演）：
   *   - changeId：每次该立绘发生任何变化（登场/换表情/移位）时递增。
   *               渲染层用它判断「这是一次新的变化」，决定是否触发动画。
   *   - justEntered：本次刚登场（从无到有），渲染层应播登场动画。
   *   - prevExpr / prevPos：变化前的表情/位置。若 expr 变了 = 表情切换；
   *               若 pos 变了 = 移位。渲染层据此决定过渡类型。
   *   - trans：作者在剧本里写的过渡意图（"fade"/"slide"/"cut"），仅作建议，
   *               渲染层可遵从也可重写。
   *   - leaving：该立绘正在退场。渲染层据此播退场动画。
   *               注意：interpreter 会把 leaving 立绘保留一帧供渲染层看到，
   *               下一次状态推进时才真正移除（由 player 在推进前清理）。 */
  export interface ActiveSprite {
    id: string;
    pos: string;
    expr: string;
    changeId: number;
    justEntered: boolean;
    prevExpr: string | null;
    prevPos: string | null;
    trans: "fade" | "cut" | "slide";
    leaving: boolean;
  }

  export interface AudioPlaybackOptions {
    loop?: boolean;
    fadeMs?: number;
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

  export interface BacklogEntry {
    id: string;
    storyPoint: StoryPointId;
    speakerName?: string;
    text: string;
    voiceId?: string;
    readKey?: ReadTextKey;
    createdOrder?: number;
  }

  export type BgInstr = { t: "bg"; id: string; trans: "fade" | "cut" | "dissolve"; ms: number; };

  export type BgmInstr = { t: "bgm"; id: string; fade: number; loop: boolean; };

  export type Chapter = ({ t: "set"; key: string; id?: string | undefined; value?: string | number | boolean | null | undefined; expr?: string | undefined; } | { t: "bg"; id: string; trans: "fade" | "cut" | "dissolve"; ms: number; } | { t: "bgm"; id: string; fade: number; loop: boolean; } | { t: "sfx"; id: string; } | { t: "voice"; id: string; } | { t: "char"; id: string; pos: string; expr: string; trans: "fade" | "cut" | "slide"; ms: number; clear: boolean; remove: boolean; } | { t: "say"; who: string; expr: string; text: string; id?: string | undefined; ms?: number | undefined; } | { t: "narrate"; text: string; id?: string | undefined; ms?: number | undefined; } | { t: "wait"; ms: number; id?: string | undefined; } | { t: "effect"; type: "shake" | "flash" | "blur"; intensity: number; ms: number; } | { t: "transition"; type: "fade_in" | "fade_out" | "white_in" | "white_out" | "black"; ms: number; } | { t: "pause"; id?: string | undefined; } | { t: "unlock"; kind: "cg" | "music" | "replay" | "endings"; id: string; } | { t: "showCg"; id: string; } | { t: "playVideo"; id: string; skippable?: boolean | undefined; } | { t: "completeEnding"; id: string; endingId: string; })[];

  export type CharInstr = { t: "char"; id: string; pos: string; expr: string; trans: "fade" | "cut" | "slide"; ms: number; clear: boolean; remove: boolean; };

  export type CompleteEndingInstr = { t: "completeEnding"; id: string; endingId: string; };

  export interface DebugService {
    inspectState(): NovelState;
    inspectRuntimeSnapshot(): RuntimeSnapshot;
    jumpTo(point: StoryPointId): void;
  }

  export type DecisionLogEvent = { type: "start"; nodeId: string; } | { type: "choice"; fromNodeId: string; toNodeId: string; edgeId: string; } | { type: "auto"; fromNodeId: string; toNodeId: string; edgeId: string; } | { type: "checkpoint"; snapshot: { playthroughId: string; currentNodeId: string; currentStoryPoint: { nodeId: string; instructionId: string; } | null; vars: Record<string, string | number | boolean | null>; background: string | null; sprites: { id: string; pos: string; expr: string; }[]; bgm: { id: string; loop: boolean; } | null; }; };

  export type EffectInstr = { t: "effect"; type: "shake" | "flash" | "blur"; intensity: number; ms: number; };

  export interface GalleryService {
    isUnlocked(kind: UnlockKind, id: string): boolean;
    listCg(): Array<{ id: string; assetId: string; title?: string; asset: unknown }>;
    listMusic(): Array<{ id: string; audioId: string; title?: string; asset: unknown }>;
    listReplays(): Array<{ id: string; nodeId: string; title?: string }>;
    listEndings(): Array<{ id: string; title: string; nodeId?: string }>;
  }

  export type GlobalPersistentRecord = { schemaVersion: 2; projectId: string; readText: { nodeId: string; instructionId: string; textHash: string; }[]; unlockedCg: string[]; unlockedMusic: string[]; unlockedReplays: string[]; unlockedEndings: string[]; playthroughCount: number; globalVars: Record<string, string | number | boolean | null>; lastEndingId: string | null; settledEndings: Record<string, Record<string, { completedAt: string; }>>; appliedGlobalEffects: Record<string, string[]>; };

  export type GraphEdgeData = { id: string; from: string; to: string; mode: "linear" | "choice" | "auto"; label: string | null; condition: string | null; };

  export type GraphNodeData = { id: string; file: string; position: { x: number; y: number; }; title?: string | undefined; };

  export type GraphPosition = { x: number; y: number; };

  export interface HistoryService {
    getBacklog(): BacklogEntry[];
    replayVoice(entryId: string): void;
    rollbackTo(entryId: string): void | RuntimeRestoreResult | Promise<void | RuntimeRestoreResult>;
  }

  export interface InMemoryRuntimeServicesOptions {
    projectId?: string;
    getState: () => NovelState;
    createSnapshot?: () => RuntimeSnapshot;
    restoreFromSave?: (record: SaveSlotRecord) => RuntimeRestoreResult | Promise<RuntimeRestoreResult>;
    persistenceAdapter?: RuntimePersistenceAdapter;
    decisionLog?: () => DecisionLogEvent[];
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

  export type Instruction = { t: "set"; key: string; id?: string | undefined; value?: string | number | boolean | null | undefined; expr?: string | undefined; } | { t: "bg"; id: string; trans: "fade" | "cut" | "dissolve"; ms: number; } | { t: "bgm"; id: string; fade: number; loop: boolean; } | { t: "sfx"; id: string; } | { t: "voice"; id: string; } | { t: "char"; id: string; pos: string; expr: string; trans: "fade" | "cut" | "slide"; ms: number; clear: boolean; remove: boolean; } | { t: "say"; who: string; expr: string; text: string; id?: string | undefined; ms?: number | undefined; } | { t: "narrate"; text: string; id?: string | undefined; ms?: number | undefined; } | { t: "wait"; ms: number; id?: string | undefined; } | { t: "effect"; type: "shake" | "flash" | "blur"; intensity: number; ms: number; } | { t: "transition"; type: "fade_in" | "fade_out" | "white_in" | "white_out" | "black"; ms: number; } | { t: "pause"; id?: string | undefined; } | { t: "unlock"; kind: "cg" | "music" | "replay" | "endings"; id: string; } | { t: "showCg"; id: string; } | { t: "playVideo"; id: string; skippable?: boolean | undefined; } | { t: "completeEnding"; id: string; endingId: string; };

  export type InstructionType = "bg" | "bgm" | "sfx" | "voice" | "char" | "say" | "narrate" | "set" | "wait" | "effect" | "transition" | "pause" | "unlock" | "showCg" | "playVideo" | "completeEnding";

  export type Manifest = { characters: Record<string, { name: string; color: string; sprites: Record<string, string>; }>; backgrounds: Record<string, string>; audio: { bgm: Record<string, string>; sfx: Record<string, string>; voice: Record<string, string>; }; cg: Record<string, { path: string; name?: string | undefined; tags?: string[] | undefined; thumbnail?: string | undefined; group?: string | undefined; unlockId?: string | undefined; }>; videos: Record<string, { path: string; name?: string | undefined; tags?: string[] | undefined; thumbnail?: string | undefined; poster?: string | undefined; skippable?: boolean | undefined; }>; fonts: Record<string, { path: string; family: string; weight?: string | undefined; style?: string | undefined; }>; uiSkins: Record<string, { assets: Record<string, string>; name?: string | undefined; tokens?: Record<string, string | number> | undefined; }>; animationAtlases: Record<string, { image: string; json?: string | undefined; frameWidth?: number | undefined; frameHeight?: number | undefined; }>; unlocks: { cg: Record<string, { assetId: string; title?: string | undefined; }>; music: Record<string, { audioId: string; title?: string | undefined; }>; replay: Record<string, { nodeId: string; title?: string | undefined; }>; endings: Record<string, { title: string; nodeId?: string | undefined; }>; }; };

  export interface MediaService {
    closeCg(): void;
    skipVideo(): void;
  }

  export type Meta = { title: string; typingSpeedCps: number; autoAdvanceMs: number; chapterGapMs: number; stage: { width: number; height: number; }; };

  export type NarrateInstr = { t: "narrate"; text: string; id?: string | undefined; ms?: number | undefined; };

  export interface NovelState {
    /** 剧情变量。节点内 set 指令写入，graph 自动出口条件读取。 */
    vars: Record<string, string | number | boolean | null>;

    /** 当前背景 id（引用 manifest.backgrounds），null = 黑场 */
    background: string | null;
    backgroundTrans: "fade" | "cut" | "dissolve";
    backgroundMs: number;

    /** 台上立绘列表，按登场顺序 */
    sprites: ActiveSprite[];

    /** 当前说话人，null = 无（纯旁白） */
    speaker: Speaker | null;

    /** 对话正文（已打字机化的部分由 typedLen 控制） */
    dialogue: {
      text: string;
      typedLen: number; // 0..text.length；等于 text.length 表示该句已打完
      fullyRevealed: boolean; // 玩家是否已点击跳过打字（整句直接显示）
    } | null;

    /** 旁白（无说话人时显示）。打字机同样用 typedLen */
    narration: {
      text: string;
      typedLen: number;
      fullyRevealed: boolean;
    } | null;

    /** 当前选择项。非 null 时播放器停在此处，等待渲染层调用 controls.choose。 */
    choice: {
      choices: { text: string; to: string }[];
    } | null;

    /** 待播放特效 / 转场（组件消费） */
    effects: PendingEffect[];
    transitions: PendingTransition[];

    /** 音频线索（组件据此播放，不持有音频实例） */
    audio: {
      bgm: { id: string; fade: number; loop: boolean } | null;
      /** 最近触发的音效 id 列表（带序号，便于组件去重播放） */
      sfx: { id: string; seq: number }[];
      voice: { id: string; seq: number } | null;
    };

    /** 播放状态标记，供 UI / 控制层使用 */
    flags: {
      isWaiting: boolean; // 正在执行 wait 指令
      isAutoPlay: boolean;
      skipMode: "off" | "read" | "all";
      isRecording: boolean; // 录制模式：隐藏控制 UI + 固定节奏
      chapterIndex: number;
      progress: { current: number; total: number }; // 指令进度
    };

    /** 当前文本指令打完后，自动/录制模式应停留的毫秒数（null=跟随 meta.autoAdvanceMs）。 */
    currentCueMs: number | null;
  }

  export type PauseInstr = { t: "pause"; id?: string | undefined; };

  /** 一段特效，组件播放后即从数组移除（由 useNovel 通过版本号驱动）。 */
  export interface PendingEffect {
    id: number; // 唯一标识，组件用它判断「是不是新特效」
    type: "shake" | "flash" | "blur";
    intensity: number;
    ms: number;
  }

  /** 转场覆盖层。 */
  export interface PendingTransition {
    id: number;
    type: "fade_in" | "fade_out" | "white_in" | "white_out" | "black";
    ms: number;
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

  export type PlayVideoInstr = { t: "playVideo"; id: string; skippable?: boolean | undefined; };

  export interface ProgressService {
    getSummary(): { playthroughCount: number; lastEndingId: string | null; currentPlaythroughEndingIds: string[] };
    subscribe(listener: () => void): () => void;
  }

  export type ProjectGraphData = { version: number; entryNodeId: string; nodes: { id: string; file: string; position: { x: number; y: number; }; title?: string | undefined; }[]; edges: { id: string; from: string; to: string; mode: "linear" | "choice" | "auto"; label: string | null; condition: string | null; }[]; };

  export const RENDERER_CONTRACT_VERSION: 1;

  export type ReadTextKey = { nodeId: string; instructionId: string; textHash: string; };

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

  export interface ReplayService {
    start(replayId: string): RuntimeRestoreResult | Promise<RuntimeRestoreResult>;
  }

  export interface RuntimeAudioBridge extends AudioService {
    setVolumes?(volumes: RuntimeSettingsRecord["volumes"]): void;
  }

  export interface RuntimeControls {
    advance(): void;
    choose(toNodeId: string): void;
    setAutoPlay(on: boolean): void;
    setSkipMode(mode: SkipMode): void;
    rollbackTo(point: StoryPointId): void;
    restart(): void;
  }

  export interface RuntimeLoadWarning {
    code: string;
    message: string;
    variableName?: string;
    storyPoint?: StoryPointId;
    nodeId?: string;
  }

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

  export type RuntimePersistenceErrorCode = "missing_ending_ref" | "runtime_record_future_version" | "runtime_record_invalid" | "runtime_save_slot_not_found";

  export type RuntimeRecordKind = "global" | "saveSlot" | "settings";

  export interface RuntimeRestoreResult {
    warnings: RuntimeLoadWarning[];
  }

  export class RuntimeServiceUnavailableError extends Error {
    readonly code: "runtime_service_unavailable";
    constructor(service: string, method: string);
    readonly service: string;
    readonly method: string;
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

  export type RuntimeSettingsRecord = { schemaVersion: 2; volumes: { master: number; bgm: number; sfx: number; voice: number; }; textSpeedCps?: number | undefined; autoAdvanceMs?: number | undefined; fullscreen?: boolean | undefined; };

  export interface RuntimeSettingsService {
    getSettings(): RuntimeSettingsRecord;
    updateSettings(patch: Partial<RuntimeSettingsRecord>): Promise<void>;
  }

  export type RuntimeSnapshot = { playthroughId: string; currentNodeId: string; currentStoryPoint: { nodeId: string; instructionId: string; } | null; vars: Record<string, string | number | boolean | null>; background: string | null; sprites: { id: string; pos: string; expr: string; }[]; bgm: { id: string; loop: boolean; } | null; };

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

  export interface RuntimeStorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
  }

  export interface SaveOptions {
    label?: string;
    preview?: SavePreview;
  }

  export type SavePreview = { text?: string | undefined; background?: string | null | undefined; };

  export interface SaveService {
    listSlots(): Promise<SaveSlotSummary[]>;
    save(slotId: string, options?: SaveOptions): Promise<SaveSlotSummary>;
    load(slotId: string): Promise<RuntimeRestoreResult & { slotId: string }>;
    delete(slotId: string): Promise<void>;
    quickSave(): Promise<void>;
    quickLoad(): Promise<RuntimeRestoreResult & { slotId: string }>;
    autoSave(reason: "node" | "choice" | "manual" | "ending"): Promise<void>;
  }

  export type SaveSlotRecord = { schemaVersion: 2; projectId: string; createdAt: string; updatedAt: string; position: { nodeId: string; instructionId: string; } | null; vars: Record<string, string | number | boolean | null>; decisions: ({ type: "start"; nodeId: string; } | { type: "choice"; fromNodeId: string; toNodeId: string; edgeId: string; } | { type: "auto"; fromNodeId: string; toNodeId: string; edgeId: string; } | { type: "checkpoint"; snapshot: { playthroughId: string; currentNodeId: string; currentStoryPoint: { nodeId: string; instructionId: string; } | null; vars: Record<string, string | number | boolean | null>; background: string | null; sprites: { id: string; pos: string; expr: string; }[]; bgm: { id: string; loop: boolean; } | null; }; })[]; checkpoint: { playthroughId: string; currentNodeId: string; currentStoryPoint: { nodeId: string; instructionId: string; } | null; vars: Record<string, string | number | boolean | null>; background: string | null; sprites: { id: string; pos: string; expr: string; }[]; bgm: { id: string; loop: boolean; } | null; }; label?: string | undefined; preview?: { text?: string | undefined; background?: string | null | undefined; } | undefined; };

  export interface SaveSlotSummary {
    slotId: string;
    label?: string;
    preview?: SavePreview;
    updatedAt: string;
    position: StoryPointId | null;
  }

  export type SayInstr = { t: "say"; who: string; expr: string; text: string; id?: string | undefined; ms?: number | undefined; };

  export type SerializableBgm = { id: string; loop: boolean; };

  export type SerializableSprite = { id: string; pos: string; expr: string; };

  export type SetInstr = { t: "set"; key: string; id?: string | undefined; value?: string | number | boolean | null | undefined; expr?: string | undefined; };

  export type SfxInstr = { t: "sfx"; id: string; };

  export type ShowCgInstr = { t: "showCg"; id: string; };

  export type SkipMode = "off" | "read" | "all";

  /** 当前说话人（用于名字标签 + 高亮）。 */
  export interface Speaker {
    id: string;
    name: string;
    color: string;
    expr: string;
  }

  export type StoryPointId = { nodeId: string; instructionId: string; };

  export type TransitionInstr = { t: "transition"; type: "fade_in" | "fade_out" | "white_in" | "white_out" | "black"; ms: number; };

  export type UnlockInstr = { t: "unlock"; kind: "cg" | "music" | "replay" | "endings"; id: string; };

  export type UnlockKind = "cg" | "music" | "replay" | "endings" | "ending";

  export interface UnlockState {
    cg: string[];
    music: string[];
    replay: string[];
    endings: string[];
  }

  export type VariableDeclaration = { type: "string" | "number" | "boolean"; default: string | number | boolean | null; nullable: boolean; scope: "run" | "global"; description?: string | undefined; };

  export type VariableRegistry = { version: 1; variables: Record<string, { type: "string" | "number" | "boolean"; default: string | number | boolean | null; nullable: boolean; scope: "run" | "global"; description?: string | undefined; }>; };

  export type VoiceInstr = { t: "voice"; id: string; };

  export type WaitInstr = { t: "wait"; ms: number; id?: string | undefined; };

  export const createInMemoryRuntimeServices: (options: InMemoryRuntimeServicesOptions) => RuntimeServices;

  export const createInitialState: () => NovelState;

  export const defaultRuntimeSettings: () => { schemaVersion: 2; volumes: { master: number; bgm: number; sfx: number; voice: number; }; textSpeedCps?: number | undefined; autoAdvanceMs?: number | undefined; fullscreen?: boolean | undefined; };

  export const resolveAsset: (contentBase: string, rel: string) => string;

  export const resolveRuntimeSettings: (settings: { schemaVersion: 2; volumes: { master: number; bgm: number; sfx: number; voice: number; }; textSpeedCps?: number | undefined; autoAdvanceMs?: number | undefined; fullscreen?: boolean | undefined; }, fallback?: Pick<Required<{ schemaVersion: 2; volumes: { master: number; bgm: number; sfx: number; voice: number; }; textSpeedCps?: number | undefined; autoAdvanceMs?: number | undefined; fullscreen?: boolean | undefined; }>, "autoAdvanceMs" | "textSpeedCps">) => { schemaVersion: 2; volumes: { master: number; bgm: number; sfx: number; voice: number; }; textSpeedCps?: number | undefined; autoAdvanceMs?: number | undefined; fullscreen?: boolean | undefined; } & Required<Pick<{ schemaVersion: 2; volumes: { master: number; bgm: number; sfx: number; voice: number; }; textSpeedCps?: number | undefined; autoAdvanceMs?: number | undefined; fullscreen?: boolean | undefined; }, "autoAdvanceMs" | "textSpeedCps">>;

  export const validateRendererManifestContract: (raw: unknown) => RendererManifestIssue[];

}

declare module "@galstudio/engine" {
  export * from "@vibegal/engine";
}
