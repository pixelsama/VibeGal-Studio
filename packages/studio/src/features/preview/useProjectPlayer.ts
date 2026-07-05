/**
 * useProjectPlayer —— 在 studio 内用引擎跑一个项目（数据来自 Tauri 后端，而非 fetch）。
 *
 * 这是原 useNovel 的变体：把「fetch public/content」替换成「直接拿 openProject 返回的数据」。
 * 引擎核心（player/interpreter/AudioEngine）零改写复用。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  NovelPlayer,
  AudioEngine,
  validateContent,
  createInitialState,
  type Manifest,
  type Meta,
  type Instruction,
  type NovelState,
  type RendererProps,
} from "@galstudio/engine";
import type { GraphNode, NodeEntry, ProjectData, ProjectGraph } from "../../lib/types";
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

export function buildProjectPreviewContent(project: ProjectData) {
  return {
    meta: project.content.meta,
    manifest: project.content.manifest,
    chapters: graphPreviewChapters(project.graph, project.nodes),
  };
}

function graphPreviewChapters(graph: ProjectGraph | undefined, nodeEntries: NodeEntry[] | undefined) {
  if (!graph || !nodeEntries) return [];
  const entryByPath = new Map(nodeEntries.map((entry) => [entry.relPath, entry]));
  return orderGraphNodesForPreview(graph).flatMap((node) => {
    const data = entryByPath.get(node.file)?.data;
    return data == null ? [] : [{ file: node.file, data }];
  });
}

function orderGraphNodesForPreview(graph: ProjectGraph): GraphNode[] {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const ordered: GraphNode[] = [];
  const visited = new Set<string>();
  let current = nodeById.get(graph.entryNodeId);

  while (current && !visited.has(current.id)) {
    ordered.push(current);
    visited.add(current.id);
    const nextEdge = graph.edges.find((edge) => edge.from === current?.id && nodeById.has(edge.to) && !visited.has(edge.to));
    current = nextEdge ? nodeById.get(nextEdge.to) : undefined;
  }

  for (const node of graph.nodes) {
    if (!visited.has(node.id)) ordered.push(node);
  }

  return ordered;
}

export function useProjectPlayer(project: ProjectData): ProjectPlayerResult {
  const [state, setState] = useState<NovelState>(createInitialState);
  const [error, setError] = useState<string | null>(null);
  const playerRef = useRef<NovelPlayer | null>(null);
  const audioRef = useRef<AudioEngine | null>(null);

  useEffect(() => {
    let player: NovelPlayer | null = null;
    let audio: AudioEngine | null = null;
    try {
      // 用引擎的校验器解析项目数据（应用 Zod 默认值 + 引用检查）
      const validated = validateContent(buildProjectPreviewContent(project));

      const chapters = validated.chapters as Instruction[][];
      player = new NovelPlayer({ meta: validated.meta as Meta, manifest: validated.manifest as Manifest });
      player.load(chapters);
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

  const manifest = (playerRef.current?.deps_.manifest ?? null) as Manifest | null;

  const contentBase = `${project.path}/content`;
  const stage = readStageResolution(project.content.meta);

  const rendererProps: RendererProps = {
    state,
    manifest: manifest ?? EMPTY_MANIFEST,
    contentBase,
    stage,
    onAdvance: advance,
    onToggleAuto: toggleAuto,
    onToggleRecording: toggleRecording,
    onSeekBy: seekBy,
    onStepOnce: stepOnce,
    onPrevChapter: prevChapter,
    onNextChapter: nextChapter,
  };

  return { state, error, advance, restart, toggleAuto, toggleRecording, seekBy, stepOnce, prevChapter, nextChapter, rendererProps };
}
