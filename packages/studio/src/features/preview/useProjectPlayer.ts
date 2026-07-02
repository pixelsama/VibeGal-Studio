/**
 * useProjectPlayer —— 在 studio 内用引擎跑一个项目（数据来自 Tauri 后端，而非 fetch）。
 *
 * 这是原 useNovel 的变体：把「fetch public/content」替换成「直接拿 openProject 返回的数据」。
 * 引擎核心（player/interpreter/AudioEngine）零改写复用。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
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

      // contentBase 必须是 webview 可访问的 URL：用 convertFileSrc 把磁盘路径转成
      // Tauri asset 协议 URL。engine 的 resolveAsset 会做 contentBase + "/" + rel 拼接，
      // 所以这里传 content 目录转换后的 URL（无尾部斜杠）。
      const contentDirAbs = `${project.path}/content`;
      const contentBase = convertFileSrc(contentDirAbs);
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

  // 渲染层需要的资源根：convertFileSrc 转成 webview 可访问 URL（img/audio 才能加载）
  const contentBase = convertFileSrc(`${project.path}/content`);

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
