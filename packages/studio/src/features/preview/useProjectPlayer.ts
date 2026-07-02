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
import type { ProjectData } from "../../lib/types";

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
      const validated = validateContent({
        meta: project.content.meta,
        manifest: project.content.manifest,
        chapters: project.content.chapters.map((c) => ({ file: c.relPath, data: c.data })),
      });

      const chapters = validated.chapters as Instruction[][];
      player = new NovelPlayer({ meta: validated.meta as Meta, manifest: validated.manifest as Manifest });
      player.load(chapters);
      playerRef.current = player;

      // 资源路径：项目磁盘路径下，前端用 tauri:// 协议或 convertFileSrc 访问
      // 这里 contentBase 指向项目根的 content 目录（相对），渲染层用 resolveAsset 拼接
      const contentBase = `${project.path}/content`;
      audio = new AudioEngine(validated.manifest as Manifest, contentBase);
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

  // 渲染层需要的资源根：用 convertFileSrc 把磁盘路径转成 webview 可访问的 URL
  const contentBase = `${project.path}/content`;

  const rendererProps: RendererProps = {
    state,
    manifest: manifest ?? { characters: {}, backgrounds: {}, audio: {} },
    contentBase,
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
