import { useCallback, useEffect, useRef, useState } from "react";
import {
  AudioEngine,
  NovelPlayer,
  createInitialState,
  validateContent,
  type Instruction,
  type Manifest,
  type Meta,
  type NovelState,
  type RuntimeControls,
  type RuntimeServices,
  RuntimeServiceUnavailableError,
  createInMemoryRuntimeServices,
} from "@galstudio/engine";
import type { GraphNode, ProjectData } from "../../lib/types";
import { EMPTY_MANIFEST } from "../../lib/types";
import { readStageResolution } from "../../lib/projectMeta";
import { createProjectRendererProps, type ProjectPlayerResult } from "../preview/useProjectPlayer";

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
  const stateRef = useRef(state);
  const runtimeRef = useRef<RuntimeServices | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    let player: NovelPlayer | null = null;
    let audio: AudioEngine | null = null;
    playerRef.current = null;
    audioRef.current = null;

    try {
      const content = buildNodePreviewContent(project, node, nodeData);
      const validated = validateContent(content);

      const chapters = validated.chapters as Instruction[][];
      player = new NovelPlayer({
        meta: validated.meta as Meta,
        manifest: validated.manifest as Manifest,
        onRuntimeEffect: (effect) => {
          if (effect.type === "unlock") {
            void runtimeRef.current?.persistent.unlock(effect.kind, effect.id);
          }
        },
      });
      player.load(chapters);
      playerRef.current = player;

      const contentDirAbs = `${project.path}/content`;
      audio = new AudioEngine(validated.manifest as Manifest, contentDirAbs);
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
  const contentBase = `${project.path}/content`;
  const stage = readStageResolution(project.content.meta);

  const controls: RuntimeControls = {
    advance,
    choose: () => {
      throw new RuntimeServiceUnavailableError("controls", "choose");
    },
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
    manifest: manifest ?? EMPTY_MANIFEST,
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
    manifest: manifest ?? EMPTY_MANIFEST,
    contentBase,
    stage,
    controls,
    runtime: runtimeRef.current,
  });

  return { state, error, advance, restart, toggleAuto, toggleRecording, seekBy, stepOnce, prevChapter, nextChapter, rendererProps };
}
