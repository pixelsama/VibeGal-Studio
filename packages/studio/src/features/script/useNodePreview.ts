import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  AudioEngine,
  NovelPlayer,
  createInitialState,
  validateContent,
  type Instruction,
  type Manifest,
  type Meta,
  type NovelState,
  type RendererProps,
} from "@galstudio/engine";
import type { GraphNode, ProjectData } from "../../lib/types";
import type { ProjectPlayerResult } from "../preview/useProjectPlayer";

export function buildNodePreviewContent(project: ProjectData, node: GraphNode | null, nodeData: unknown | null) {
  return {
    meta: project.content.meta,
    manifest: project.content.manifest,
    chapters: node && nodeData != null ? [{ file: node.file, data: nodeData }] : [],
  };
}

export function useNodePreview(
  project: ProjectData,
  node: GraphNode | null,
  nodeData: unknown | null,
): ProjectPlayerResult {
  const [state, setState] = useState<NovelState>(createInitialState);
  const [error, setError] = useState<string | null>(null);
  const playerRef = useRef<NovelPlayer | null>(null);
  const audioRef = useRef<AudioEngine | null>(null);

  useEffect(() => {
    let player: NovelPlayer | null = null;
    let audio: AudioEngine | null = null;
    playerRef.current = null;
    audioRef.current = null;

    try {
      const content = buildNodePreviewContent(project, node, nodeData);
      const validated = validateContent(content);

      const chapters = validated.chapters as Instruction[][];
      player = new NovelPlayer({ meta: validated.meta as Meta, manifest: validated.manifest as Manifest });
      player.load(chapters);
      playerRef.current = player;

      const contentDirAbs = `${project.path}/content`;
      const contentBase = convertFileSrc(contentDirAbs);
      audio = new AudioEngine(validated.manifest as Manifest, contentBase);
      audioRef.current = audio;

      player.subscribe((nextState) => {
        setState({ ...nextState });
        audio?.sync(nextState);
      });
      setError(null);
    } catch (nextError) {
      setState(createInitialState());
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }

    return () => {
      playerRef.current = null;
      audioRef.current = null;
      player?.dispose();
      audio?.dispose();
    };
  }, [project, node, nodeData]);

  const advance = useCallback(() => playerRef.current?.advance(), []);
  const restart = useCallback(() => playerRef.current?.restart(), []);
  const toggleAuto = useCallback(() => {
    const player = playerRef.current;
    if (player) player.setAutoPlay(!player.getState().flags.isAutoPlay);
  }, []);
  const toggleRecording = useCallback(() => {
    const player = playerRef.current;
    if (player) player.setRecording(!player.getState().flags.isRecording);
  }, []);
  const seekBy = useCallback((delta: number) => playerRef.current?.seekBy(delta), []);
  const stepOnce = useCallback(() => playerRef.current?.stepOnce(), []);
  const prevChapter = useCallback(() => playerRef.current?.prevChapter(), []);
  const nextChapter = useCallback(() => playerRef.current?.nextChapter(), []);

  const manifest = (playerRef.current?.deps_.manifest ?? null) as Manifest | null;
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
