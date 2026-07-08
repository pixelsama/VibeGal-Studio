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
  type RuntimeServices,
  createInMemoryRuntimeServices,
  RuntimeServiceUnavailableError,
} from "@galstudio/engine";
import type { NodeEntry, ProjectData, ProjectGraph } from "../../lib/types";
import { EMPTY_MANIFEST } from "../../lib/types";
import { readStageResolution } from "../../lib/projectMeta";

export interface ProjectPlayerResult {
  state: NovelState;
  error: string | null;
  advance: () => void;
  restart: () => void;
  toggleAuto: () => void;
  toggleRecording: () => void;
  seekBy: (delta: number) => void;
  stepOnce: () => void;
  prevChapter: () => void;
  nextChapter: () => void;
  /** 给渲染层的 props（展开后直接传给 renderer.Component） */
  rendererProps: RendererProps;
}

export interface ProjectRendererPropsInput {
  state: NovelState;
  manifest: Manifest;
  contentBase: string;
  stage: Meta["stage"];
  controls: RuntimeControls;
  runtime: RuntimeServices | null;
}

export function createProjectRendererProps(input: ProjectRendererPropsInput): RendererProps {
  return {
    state: input.state,
    manifest: input.manifest,
    contentBase: input.contentBase,
    stage: input.stage,
    controls: input.controls,
    runtime: input.runtime ?? createInMemoryRuntimeServices({ getState: () => input.state }),
  };
}

export function buildProjectPreviewContent(project: ProjectData) {
  const chapters = graphPreviewChapters(project.graph, project.nodes);
  return {
    meta: project.content.meta,
    manifest: project.content.manifest,
    chapters: chapters.map((chapter) => ({ file: chapter.file, data: chapter.data })),
    nodeIds: chapters.map((chapter) => chapter.nodeId),
  };
}

function graphPreviewChapters(graph: ProjectGraph | undefined, nodeEntries: NodeEntry[] | undefined) {
  if (!graph || !nodeEntries) return [];
  const entryByPath = new Map(nodeEntries.map((entry) => [entry.relPath, entry]));
  return graph.nodes.flatMap((node) => {
    const data = entryByPath.get(node.file)?.data;
    return data == null ? [] : [{ nodeId: node.id, file: node.file, data }];
  });
}

export function useProjectPlayer(project: ProjectData): ProjectPlayerResult {
  const [state, setState] = useState<NovelState>(createInitialState);
  const [error, setError] = useState<string | null>(null);
  const playerRef = useRef<GraphNovelPlayer | null>(null);
  const audioRef = useRef<AudioEngine | null>(null);
  const stateRef = useRef(state);
  const runtimeRef = useRef<RuntimeServices | null>(null);

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
      const graph = ProjectGraphSchema.parse(project.graph ?? { version: 1, entryNodeId: "", nodes: [], edges: [] });

      const chapters = validated.chapters as Instruction[][];
      player = new GraphNovelPlayer({ meta: validated.meta as Meta, manifest: validated.manifest as Manifest });
      player.loadGraph(
        graph,
        content.nodeIds.map((id, index) => ({ id, instructions: chapters[index] ?? [] })),
      );
      playerRef.current = player;

      // contentBase 传原始 content 目录。engine.resolveAsset 会在最终文件路径级别
      // 调用 Tauri convertFileSrc，避免把 asset 协议的目录 URL 当普通 URL 继续拼接。
      const contentDirAbs = `${project.path}/content`;
      audio = new AudioEngine(validated.manifest as Manifest, contentDirAbs);
      audioRef.current = audio;

      player.subscribe((s) => {
        setState({ ...s });
        audio?.sync(s);
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }

    return () => {
      player?.dispose();
      audio?.dispose();
    };
  }, [project]);

  const advance = useCallback(() => playerRef.current?.advance(), []);
  const choose = useCallback((toNodeId: string) => playerRef.current?.choose(toNodeId), []);
  const restart = useCallback(() => playerRef.current?.restart(), []);
  const toggleAuto = useCallback(() => {
    const p = playerRef.current;
    if (p) p.setAutoPlay(!p.getState().flags.isAutoPlay);
  }, []);
  const toggleRecording = useCallback(() => {
    const p = playerRef.current;
    if (p) p.setRecording(!p.getState().flags.isRecording);
  }, []);
  const seekBy = useCallback((d: number) => playerRef.current?.seekBy(d), []);
  const stepOnce = useCallback(() => playerRef.current?.stepOnce(), []);
  const prevChapter = useCallback(() => playerRef.current?.prevChapter(), []);
  const nextChapter = useCallback(() => playerRef.current?.nextChapter(), []);

  const contentBase = `${project.path}/content`;
  const stage = readStageResolution(project.content.meta);

  const controls: RuntimeControls = {
    advance,
    choose,
    setAutoPlay: (on) => playerRef.current?.setAutoPlay(on),
    setSkipMode: (mode) => {
      if (mode !== "off") throw new RuntimeServiceUnavailableError("controls", "setSkipMode");
    },
    rollbackTo: () => {
      throw new RuntimeServiceUnavailableError("controls", "rollbackTo");
    },
    restart,
  };
  runtimeRef.current ??= createInMemoryRuntimeServices({
    getState: () => playerRef.current?.getState() ?? stateRef.current,
    audio: {
      replayVoice: () => audioRef.current?.replayVoice(),
      stopBgm: (fadeMs) => audioRef.current?.stopBgm(fadeMs),
      pauseBgm: () => audioRef.current?.pauseBgm(),
      resumeBgm: () => audioRef.current?.resumeBgm(),
      stopVoice: () => audioRef.current?.stopVoice(),
      stopAllSfx: () => audioRef.current?.stopAllSfx(),
      setVolumes: (volumes) => audioRef.current?.setVolumes(volumes),
    },
    inspectState: () => playerRef.current?.getState() ?? stateRef.current,
  });

  const rendererProps = createProjectRendererProps({
    state,
    manifest: project.content.manifest ?? EMPTY_MANIFEST,
    contentBase,
    stage,
    controls,
    runtime: runtimeRef.current,
  });

  return { state, error, advance, restart, toggleAuto, toggleRecording, seekBy, stepOnce, prevChapter, nextChapter, rendererProps };
}
