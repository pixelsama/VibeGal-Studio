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
  createRuntimeSnapshot,
} from "@galstudio/engine";
import type { NodeEntry, ProjectData, ProjectGraph } from "../../lib/types";
import { EMPTY_MANIFEST } from "../../lib/types";
import { readStageResolution } from "../../lib/projectMeta";
import { parseGraphCondition, type GraphConditionAst } from "../script/graphCondition";

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
  const source = condition?.trim();
  if (!source) return true;
  const parsed = parseGraphCondition(source);
  if (!parsed.ok) return false;
  return truthy(evaluatePreviewAst(parsed.ast, vars));
}

function evaluatePreviewAst(ast: GraphConditionAst, vars: PreviewInitialVars): string | number | boolean | null {
  switch (ast.kind) {
    case "identifier":
      return vars[ast.name] ?? null;
    case "literal":
      return ast.value;
    case "unary":
      return !truthy(evaluatePreviewAst(ast.expr, vars));
    case "logical":
      return ast.op === "&&"
        ? truthy(evaluatePreviewAst(ast.left, vars)) && truthy(evaluatePreviewAst(ast.right, vars))
        : truthy(evaluatePreviewAst(ast.left, vars)) || truthy(evaluatePreviewAst(ast.right, vars));
    case "comparison": {
      const left = evaluatePreviewAst(ast.left, vars);
      const right = evaluatePreviewAst(ast.right, vars);
      return evaluatePreviewComparison(ast.op, left, right);
    }
  }
}

function evaluatePreviewComparison(
  op: "==" | "!=" | ">" | "<" | ">=" | "<=",
  left: string | number | boolean | null,
  right: string | number | boolean | null,
): boolean {
  switch (op) {
    case "==":
      return left === right;
    case "!=":
      return left !== right;
    case ">":
      return typeof left === "number" && typeof right === "number" && left > right;
    case "<":
      return typeof left === "number" && typeof right === "number" && left < right;
    case ">=":
      return typeof left === "number" && typeof right === "number" && left >= right;
    case "<=":
      return typeof left === "number" && typeof right === "number" && left <= right;
  }
}

function truthy(value: string | number | boolean | null): boolean {
  return value === true || (typeof value === "number" && value !== 0) || (typeof value === "string" && value.length > 0);
}

function createInitialRuntimeSnapshot(state: NovelState) {
  return createRuntimeSnapshot(state, {
    currentNodeId: "preview",
    currentStoryPoint: null,
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
      player = new GraphNovelPlayer({
        meta: validated.meta as Meta,
        manifest: validated.manifest as Manifest,
        onRuntimeEffect: (effect) => {
          if (effect.type === "unlock") {
            void runtimeRef.current?.persistent.unlock(effect.kind, effect.id);
          }
        },
        persistent: {
          getReadStatus: (key) => runtimeRef.current?.persistent.getReadStatus(key) ?? false,
          markRead: (key) => runtimeRef.current?.persistent.markRead(key),
        },
        replayVoice: (voiceId) => audioRef.current?.replayVoice(voiceId),
      });
      const previewContent = buildProjectPreviewContent(project);
      player.loadGraph(
        { ...graph, entryNodeId: previewContent.entryNodeId || graph.entryNodeId },
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
    setSkipMode: (mode) => playerRef.current?.setSkipMode(mode),
    rollbackTo: (point) => playerRef.current?.jumpToStoryPoint(point),
    restart,
  };
  runtimeRef.current ??= createInMemoryRuntimeServices({
    getState: () => playerRef.current?.getState() ?? stateRef.current,
    manifest: project.content.manifest ?? EMPTY_MANIFEST,
    createSnapshot: () => playerRef.current?.createSnapshot() ?? createInitialRuntimeSnapshot(stateRef.current),
    restoreFromSave: (record) => playerRef.current?.restoreFromSave(record) ?? { warnings: [] },
    decisionLog: () => playerRef.current?.getDecisionLog() ?? [],
    currentStoryPoint: () => playerRef.current?.getCurrentStoryPoint() ?? null,
    currentNodeId: () => playerRef.current?.getCurrentNodeId() ?? "preview",
    getBacklog: () => playerRef.current?.getBacklog() ?? [],
    rollbackTo: (point) => playerRef.current?.jumpToStoryPoint(point),
    replayVoice: (entryId) => playerRef.current?.replayVoice(entryId),
    audio: {
      replayVoice: (voiceId) => audioRef.current?.replayVoice(voiceId),
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
