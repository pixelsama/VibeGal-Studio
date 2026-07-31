/**
 * useProjectPlayer —— 在 studio 内用引擎跑一个项目（数据来自 Tauri 后端，而非 fetch）。
 *
 * 这是原 useNovel 的变体：把「fetch public/content」替换成「直接拿 openProject 返回的数据」。
 * 引擎核心（player/interpreter/AudioEngine）零改写复用。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  GraphNovelPlayer,
  AudioEngine,
  validateContent,
  createInitialState,
  ProjectGraphSchema,
  type Manifest,
  type Meta,
  type Instruction,
  type NovelState,
  type RendererProps,
  type RuntimeControls,
  type SkipMode,
  type RuntimeServices,
  type RuntimeSettingsRecord,
  type StateWriteEvent,
  type InMemoryRuntimeServicesOptions,
  createInMemoryRuntimeServices,
  createRuntimeSnapshot,
  evaluateGraphCondition,
} from "@vibegal/engine";
import type { NodeEntry, ProjectData, ProjectGraph } from "../../lib/types";
import { EMPTY_MANIFEST } from "../../lib/types";
import { readProjectMeta } from "../../lib/projectMeta";
import { runtimeMediaFromEffect, type RuntimeMediaState } from "./RuntimeMediaOverlay";

export interface ProjectPlayerResult {
  state: NovelState;
  error: string | null;
  advance: () => void;
  restart: () => void;
  toggleAuto: () => void;
  setSkipMode: (mode: SkipMode) => void;
  toggleRecording: () => void;
  seekBy: (delta: number) => void;
  stepOnce: () => void;
  prevChapter: () => void;
  nextChapter: () => void;
  /** 给渲染层的 props（展开后直接传给 renderer.Component） */
  rendererProps: RendererProps;
  media: RuntimeMediaState;
  closeMedia: () => void;
  skipVideo: () => void;
  startDebugSession: (nodeId: string, variableOverrides?: PreviewInitialVars, instructionId?: string) => void;
  setDebugVariable: (name: string, value: string | number | boolean | null) => void;
  resetDebugVariables: () => void;
  /** 本次运行中改变过故事状态的位置，供只读的「剧情检查」解释因果。 */
  stateWrites: StateWriteEvent[];
  currentNodeId: string | null;
}

export interface ProjectRendererPropsInput {
  state: NovelState;
  manifest: Manifest;
  contentBase: string;
  meta: Meta;
  controls: RuntimeControls;
  runtime: RuntimeServices | null;
  /** Spec 34：真实预览工作台始终是预览环境。缺省 undefined = 非预览。 */
  preview?: boolean;
}

export function createProjectRendererProps(input: ProjectRendererPropsInput): RendererProps {
  return {
    state: input.state,
    manifest: input.manifest,
    contentBase: input.contentBase,
    meta: input.meta,
    // stage 是 meta.stage 的快捷方式，两者必须同源，避免渲染层读到两套尺寸。
    stage: input.meta.stage,
    controls: input.controls,
    runtime: input.runtime ?? createInMemoryRuntimeServices({ getState: () => input.state }),
    ...(input.preview !== undefined ? { preview: input.preview } : {}),
  };
}

export type PreviewInitialVars = Record<string, string | number | boolean | null>;

export interface PreviewStartPoint {
  nodeId: string;
  instructionId?: string;
}

export interface ProjectPreviewOptions {
  start?: PreviewStartPoint;
  initialVars?: PreviewInitialVars;
}

export function buildProjectPreviewContent(project: ProjectData, options: ProjectPreviewOptions = {}) {
  const chapters = graphPreviewChapters(project.graph, project.nodes, options.start);
  return {
    meta: project.content.meta,
    manifest: project.content.manifest,
    locales: Object.fromEntries((project.locales ?? []).map((entry) => [entry.locale, entry.value])),
    chapters: chapters.map((chapter) => ({ file: chapter.file, data: chapter.data })),
    nodeIds: chapters.map((chapter) => chapter.nodeId),
    entryNodeId: options.start?.nodeId ?? project.graph?.entryNodeId ?? "",
    initialVars: options.initialVars ?? {},
  };
}

function graphPreviewChapters(
  graph: ProjectGraph | undefined,
  nodeEntries: NodeEntry[] | undefined,
  start?: PreviewStartPoint,
) {
  if (!graph || !nodeEntries) return [];
  const entryByPath = new Map(nodeEntries.map((entry) => [entry.relPath, entry]));
  return graph.nodes.flatMap((node) => {
    const data = entryByPath.get(node.file)?.data;
    if (data == null) return [];
    return [{ nodeId: node.id, file: node.file, data: sliceNodePreviewData(node.id, data, start) }];
  });
}

function sliceNodePreviewData(nodeId: string, data: unknown, start?: PreviewStartPoint): unknown {
  if (!start || start.nodeId !== nodeId || !start.instructionId || !Array.isArray(data)) return data;
  const index = data.findIndex((instruction) => {
    const obj = typeof instruction === "object" && instruction != null ? instruction as Record<string, unknown> : null;
    return obj?.id === start.instructionId;
  });
  return index >= 0 ? data.slice(index) : data;
}

export type AutoRoutePreviewResult =
  | { kind: "target"; edgeId: string; nodeId: string }
  | { kind: "end" }
  | { kind: "not_auto" }
  | { kind: "no_match" };

export function resolveAutoRoutePreview(
  graph: ProjectGraph,
  nodeId: string,
  initialVars: PreviewInitialVars = {},
): AutoRoutePreviewResult {
  const outgoing = graph.edges.filter((edge) => edge.from === nodeId);
  if (outgoing.length === 0) return { kind: "end" };
  if (!outgoing.every((edge) => (edge.mode ?? "linear") === "auto")) return { kind: "not_auto" };
  const edge = outgoing.find((candidate) => evaluatePreviewCondition(candidate.condition, initialVars));
  return edge ? { kind: "target", edgeId: edge.id, nodeId: edge.to } : { kind: "no_match" };
}

function evaluatePreviewCondition(condition: string | null | undefined, vars: PreviewInitialVars): boolean {
  return evaluateGraphCondition(condition, vars);
}

function createInitialRuntimeSnapshot(state: NovelState) {
  return createRuntimeSnapshot(state, {
    currentNodeId: "preview",
    currentStoryPoint: null,
  });
}

export interface ProjectPreviewRuntimeServicesInput extends Omit<
  InMemoryRuntimeServicesOptions,
  "settingsFallback" | "onSettingsChanged"
> {
  meta: Pick<Meta, "typingSpeedCps" | "autoAdvanceMs">;
  applyPlaybackTiming: (timing: { textSpeedCps: number; autoAdvanceMs: number }) => void;
  onSettingsChanged?: (settings: RuntimeSettingsRecord) => void;
}

export function createProjectPreviewRuntimeServices(input: ProjectPreviewRuntimeServicesInput): RuntimeServices {
  const { meta, applyPlaybackTiming, onSettingsChanged, ...options } = input;
  return createInMemoryRuntimeServices({
    ...options,
    settingsFallback: {
      textSpeedCps: meta.typingSpeedCps,
      autoAdvanceMs: meta.autoAdvanceMs,
    },
    onSettingsChanged: (settings) => {
      applyPlaybackTiming({
        textSpeedCps: settings.textSpeedCps ?? meta.typingSpeedCps,
        autoAdvanceMs: settings.autoAdvanceMs ?? meta.autoAdvanceMs,
      });
      onSettingsChanged?.(settings);
    },
  });
}


export function useProjectPlayer(project: ProjectData): ProjectPlayerResult {
  const [state, setState] = useState<NovelState>(createInitialState);
  const [stateWrites, setStateWrites] = useState<StateWriteEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [media, setMedia] = useState<RuntimeMediaState>(null);
  const playerRef = useRef<GraphNovelPlayer | null>(null);
  const primaryPlayerRef = useRef<GraphNovelPlayer | null>(null);
  const replayPlayerRef = useRef<GraphNovelPlayer | null>(null);
  const replayUnsubscribeRef = useRef<(() => void) | null>(null);
  const replayListenersRef = useRef(new Set<(active: boolean) => void>());
  const audioRef = useRef<AudioEngine | null>(null);
  const stateRef = useRef(state);
  const runtimeRef = useRef<RuntimeServices | null>(null);
  const runtimeProjectRef = useRef<string | null>(null);

  if (runtimeProjectRef.current !== project.path) {
    runtimeProjectRef.current = project.path;
    runtimeRef.current = null;
  }

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    let player: GraphNovelPlayer | null = null;
    let audio: AudioEngine | null = null;
    try {
      // 用引擎的校验器解析项目数据（应用 Zod 默认值 + 引用检查）
      const content = buildProjectPreviewContent(project);
      const validated = validateContent(content);
      const graph = ProjectGraphSchema.parse(project.graph ?? {
        version: 1,
        entryNodeId: "",
        chapters: [{ id: "chapter_1", title: "第一章" }],
        nodes: [],
        edges: [],
      });
      const contentDirAbs = `${project.path}/content`;

      const chapters = validated.chapters as Instruction[][];
      player = new GraphNovelPlayer({
        meta: validated.meta as Meta,
        manifest: validated.manifest as Manifest,
        locales: content.locales,
        currentLocale: runtimeRef.current?.settings.getSettings().currentLocale ?? validated.meta.locale?.default,
        variables: project.content.variables,
        onRuntimeEffect: (effect) => {
          if (effect.type === "unlock") {
            void runtimeRef.current?.persistent.unlock(effect.kind, effect.id);
          } else if (effect.type === "completeEnding" && effect.playthroughId) {
            return runtimeRef.current?.persistent.completeEnding({ playthroughId: effect.playthroughId, endingId: effect.endingId }).then(() => undefined);
          } else if (effect.type === "globalSet" && effect.playthroughId && effect.nodeId) {
            return runtimeRef.current?.persistent.applyGlobalEffect({
              playthroughId: effect.playthroughId,
              effectKey: `${effect.nodeId}:${effect.id}`,
              key: effect.key,
              value: effect.value,
            }).then(() => undefined);
          } else {
            setMedia(runtimeMediaFromEffect(effect, validated.manifest as Manifest, contentDirAbs));
          }
          return undefined;
        },
        persistent: {
          getReadStatus: (key) => runtimeRef.current?.persistent.getReadStatus(key) ?? false,
          markRead: (key) => runtimeRef.current?.persistent.markRead(key),
        },
        replayVoice: (voiceId) => audioRef.current?.replayVoice(voiceId),
        onRuntimeTextDiagnostic: ({ storyPoint, diagnostic }) => {
          runtimeRef.current?.status?.report({
            level: "warning",
            code: diagnostic.code,
            message: `${storyPoint.nodeId} / ${storyPoint.instructionId}：${diagnostic.message}`,
          });
        },
        onStableCheckpoint: (event) => {
          void runtimeRef.current?.save.autoSave(event.reason).catch((autoSaveError) => {
            runtimeRef.current?.status?.report({
              level: "error",
              code: "runtime_auto_save_failed",
              message: autoSaveError instanceof Error ? autoSaveError.message : String(autoSaveError),
            });
          });
        },
        onChapterReached: (chapterId) => runtimeRef.current?.persistent.unlockChapter(chapterId),
        onEndingCommitted: () => runtimeRef.current?.save.autoSave("ending").catch((autoSaveError) => {
          runtimeRef.current?.status?.report({ level: "warning", code: "ending_auto_save_failed", message: autoSaveError instanceof Error ? autoSaveError.message : String(autoSaveError) });
        }),
        globalState: () => ({
          vars: runtimeRef.current?.persistent.getGlobalVars() ?? {},
          playthroughCount: runtimeRef.current?.progress.getSummary().playthroughCount ?? 0,
          lastEndingId: runtimeRef.current?.progress.getSummary().lastEndingId ?? null,
        }),
      });
      const activeSettings = runtimeRef.current?.settings.getSettings();
      player.setPlaybackTiming({
        textSpeedCps: activeSettings?.textSpeedCps ?? validated.meta.typingSpeedCps,
        autoAdvanceMs: activeSettings?.autoAdvanceMs ?? validated.meta.autoAdvanceMs,
      });
      const previewContent = buildProjectPreviewContent(project);
      player.loadGraph(
        { ...graph, entryNodeId: previewContent.entryNodeId || graph.entryNodeId },
        content.nodeIds.map((id, index) => ({ id, instructions: chapters[index] ?? [] })),
      );
      playerRef.current = player;
      primaryPlayerRef.current = player;

      // contentBase 传原始 content 目录。engine.resolveAsset 会在最终文件路径级别
      // 调用 Tauri convertFileSrc，避免把 asset 协议的目录 URL 当普通 URL 继续拼接。
      audio = new AudioEngine(validated.manifest as Manifest, contentDirAbs);
      if (activeSettings) audio.setVolumes(activeSettings.volumes);
      audioRef.current = audio;

      player.subscribe((s) => {
        setState({ ...s });
        setStateWrites(playerRef.current?.getStateWrites() ?? []);
        audio?.sync(s);
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }

    return () => {
      setMedia(null);
      replayUnsubscribeRef.current?.();
      replayUnsubscribeRef.current = null;
      replayPlayerRef.current?.dispose();
      replayPlayerRef.current = null;
      player?.dispose();
      audio?.dispose();
      if (playerRef.current === player) playerRef.current = null;
      if (primaryPlayerRef.current === player) primaryPlayerRef.current = null;
      if (audioRef.current === audio) audioRef.current = null;
    };
  }, [project]);

  const advance = useCallback(() => playerRef.current?.advance(), []);
  const choose = useCallback((toNodeId: string) => playerRef.current?.choose(toNodeId), []);
  const restart = useCallback(() => {
    if (replayPlayerRef.current) exitPreviewReplay();
    else primaryPlayerRef.current?.restart();
  }, []);
  const toggleAuto = useCallback(() => {
    const p = playerRef.current;
    if (p) p.setAutoPlay(!p.getState().flags.isAutoPlay);
  }, []);
  const setSkipMode = useCallback((mode: SkipMode) => playerRef.current?.setSkipMode(mode), []);
  const toggleRecording = useCallback(() => {
    const p = playerRef.current;
    if (p) p.setRecording(!p.getState().flags.isRecording);
  }, []);
  const seekBy = useCallback((d: number) => playerRef.current?.seekBy(d), []);
  const stepOnce = useCallback(() => playerRef.current?.stepOnce(), []);
  const prevChapter = useCallback(() => playerRef.current?.prevChapter(), []);
  const nextChapter = useCallback(() => playerRef.current?.nextChapter(), []);
  const closeMedia = useCallback(() => setMedia(null), []);
  const skipVideo = useCallback(() => {
    setMedia((current) => current?.type === "video" && current.skippable ? null : current);
  }, []);
  const startDebugSession = useCallback((nodeId: string, variableOverrides: PreviewInitialVars = {}, instructionId?: string) => {
    playerRef.current?.startDebugSession({ nodeId, variableOverrides, instructionId, suppressPersistentEffects: true });
  }, []);

  const contentBase = `${project.path}/content`;
  const meta = readProjectMeta(project.content.meta);

  function exitPreviewReplay() {
    if (!replayPlayerRef.current) return;
    replayUnsubscribeRef.current?.();
    replayUnsubscribeRef.current = null;
    replayPlayerRef.current.dispose();
    replayPlayerRef.current = null;
    playerRef.current = primaryPlayerRef.current;
    setMedia(null);
    const next = primaryPlayerRef.current?.getState();
    if (next) {
      setState({ ...next });
      setStateWrites(primaryPlayerRef.current?.getStateWrites() ?? []);
      audioRef.current?.sync(next);
    }
    replayListenersRef.current.forEach((listener) => listener(false));
  }
  const controls: RuntimeControls = {
    advance,
    choose,
    submitName: (value) => playerRef.current?.submitName(value) ?? false,
    setAutoPlay: (on) => playerRef.current?.setAutoPlay(on),
    setSkipMode: (mode) => playerRef.current?.setSkipMode(mode),
    rollbackTo: (point) => playerRef.current?.jumpToStoryPoint(point) ?? { warnings: [] },
    restart: () => {
      if (replayPlayerRef.current) exitPreviewReplay();
      else primaryPlayerRef.current?.restart();
    },
  };
  runtimeRef.current ??= createProjectPreviewRuntimeServices({
    meta,
    applyPlaybackTiming: (timing) => {
      primaryPlayerRef.current?.setPlaybackTiming(timing);
      replayPlayerRef.current?.setPlaybackTiming(timing);
      setState({ ...stateRef.current });
    },
    onSettingsChanged: (settings) => {
      const locale = settings.currentLocale ?? meta.locale?.default;
      primaryPlayerRef.current?.setCurrentLocale(locale);
      replayPlayerRef.current?.setCurrentLocale(locale);
    },
    getState: () => playerRef.current?.getState() ?? stateRef.current,
    manifest: project.content.manifest ?? EMPTY_MANIFEST,
    graph: project.graph ? ProjectGraphSchema.parse(project.graph) : undefined,
    variables: project.content.variables,
    createSnapshot: () => primaryPlayerRef.current?.createSnapshot() ?? createInitialRuntimeSnapshot(stateRef.current),
    restoreFromSave: (record) => {
      if (replayPlayerRef.current) exitPreviewReplay();
      return primaryPlayerRef.current?.restoreFromSave(record) ?? { warnings: [] };
    },
    decisionLog: () => primaryPlayerRef.current?.getDecisionLog() ?? [],
    currentStoryPoint: () => playerRef.current?.getCurrentStoryPoint() ?? null,
    currentNodeId: () => playerRef.current?.getCurrentNodeId() ?? "preview",
    getBacklog: () => playerRef.current?.getBacklog() ?? [],
    rollbackTo: (point) => playerRef.current?.jumpToStoryPoint(point) ?? { warnings: [] },
    rollbackHistoryEntry: (entryId) => playerRef.current?.rollbackToHistoryEntry(entryId) ?? { warnings: [] },
    replayVoice: (entryId) => playerRef.current?.replayVoice(entryId),
    startChapter: (checkpoint) => {
      if (replayPlayerRef.current) exitPreviewReplay();
      return primaryPlayerRef.current?.startChapter(checkpoint) ?? { warnings: [] };
    },
    startReplay: (nodeId) => {
      exitPreviewReplay();
      const primary = primaryPlayerRef.current;
      if (!primary || !project.graph) return { warnings: [{ code: "node_not_found", message: `Replay node "${nodeId}" no longer exists.`, nodeId }] };
      let replay: GraphNovelPlayer;
      replay = new GraphNovelPlayer({
        meta,
        manifest: project.content.manifest ?? EMPTY_MANIFEST,
        locales: Object.fromEntries((project.locales ?? []).map((entry) => [entry.locale, entry.value])),
        currentLocale: runtimeRef.current?.settings.getSettings().currentLocale ?? meta.locale?.default,
        variables: project.content.variables,
        globalState: () => ({
          vars: runtimeRef.current?.persistent.getGlobalVars() ?? {},
          playthroughCount: runtimeRef.current?.progress.getSummary().playthroughCount ?? 0,
          lastEndingId: runtimeRef.current?.progress.getSummary().lastEndingId ?? null,
        }),
        replayVoice: (voiceId) => audioRef.current?.replayVoice(voiceId),
        onRuntimeEffect: (effect) => {
          if (effect.type !== "unlock" && effect.type !== "completeEnding" && effect.type !== "globalSet") {
            setMedia(runtimeMediaFromEffect(effect, project.content.manifest ?? EMPTY_MANIFEST, contentBase));
          }
          return undefined;
        },
        onPlaybackEnded: exitPreviewReplay,
      });
      const activeSettings = runtimeRef.current?.settings.getSettings();
      replay.setPlaybackTiming({
        textSpeedCps: activeSettings?.textSpeedCps ?? meta.typingSpeedCps,
        autoAdvanceMs: activeSettings?.autoAdvanceMs ?? meta.autoAdvanceMs,
      });
      const content = buildProjectPreviewContent(project);
      const validated = validateContent(content);
      replay.loadGraph(
        ProjectGraphSchema.parse(project.graph),
        content.nodeIds.map((id, index) => ({ id, instructions: validated.chapters[index] as Instruction[] ?? [] })),
      );
      replayPlayerRef.current = replay;
      playerRef.current = replay;
      replayUnsubscribeRef.current = replay.subscribe((next) => {
        setState({ ...next });
        audioRef.current?.sync(next);
      });
      const result = replay.startReplay(nodeId);
      if (result.warnings.length > 0) {
        exitPreviewReplay();
        return result;
      }
      if (replayPlayerRef.current === replay) {
        replayListenersRef.current.forEach((listener) => listener(true));
      }
      return result;
    },
    isReplayActive: () => replayPlayerRef.current != null,
    exitReplay: exitPreviewReplay,
    subscribeReplay: (listener) => {
      replayListenersRef.current.add(listener);
      listener(replayPlayerRef.current != null);
      return () => replayListenersRef.current.delete(listener);
    },
    persistenceEnabled: () => replayPlayerRef.current == null,
    audio: {
      replayVoice: (voiceId) => audioRef.current?.replayVoice(voiceId),
      playMusic: (audioId, options) => audioRef.current?.playMusic(audioId, options),
      stopMusic: (fadeMs) => audioRef.current?.stopMusic(fadeMs),
      stopBgm: (fadeMs) => audioRef.current?.stopBgm(fadeMs),
      pauseBgm: () => audioRef.current?.pauseBgm(),
      resumeBgm: () => audioRef.current?.resumeBgm(),
      stopVoice: () => audioRef.current?.stopVoice(),
      stopAllSfx: () => audioRef.current?.stopAllSfx(),
      setVolumes: (volumes) => audioRef.current?.setVolumes(volumes),
    },
    media: { closeCg: closeMedia, skipVideo },
    inspectState: () => playerRef.current?.getState() ?? stateRef.current,
  });

  const rendererProps = createProjectRendererProps({
    state,
    manifest: project.content.manifest ?? EMPTY_MANIFEST,
    contentBase,
    meta,
    controls,
    runtime: runtimeRef.current,
    // Spec 34：预览工作台是预览环境
    preview: true,
  });

  return {
    state, error, advance, restart, toggleAuto, setSkipMode, toggleRecording, seekBy, stepOnce, prevChapter, nextChapter,
    rendererProps, media, closeMedia, skipVideo, startDebugSession,
    setDebugVariable: (name, value) => playerRef.current?.setDebugVariable(name, value),
    resetDebugVariables: () => playerRef.current?.resetDebugVariables(),
    stateWrites,
    currentNodeId: playerRef.current?.getCurrentNodeId() ?? null,
  };
}
