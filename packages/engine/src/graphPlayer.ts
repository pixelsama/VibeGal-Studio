import type { ChapterCheckpoint, Meta, Manifest, Instruction, LocaleTable, ProjectGraphData, GraphEdgeData, SetInstr, VariableRegistry } from "./types";
import { localizeInstruction } from "./localization";
import { formatRuntimeText, runtimeTextPauseAt } from "./runtimeText";
import type { GraphRouteValue } from "./graphRouting";
import type { NovelState } from "./state";
import { createInitialState } from "./state";
import { applyInstruction, advanceTyping, revealFully, buildInitialState, evaluateAssignmentExpression, RuntimeAssignmentError, type InterpreterDeps } from "./interpreter";
import { decideGraphRoute, evaluateGraphConditionResult } from "./graphRouting";
import { runtimeEffectFromInstruction, type RuntimeEffectHandler } from "./runtimeEffect";
import {
  RuntimeSnapshotSchema,
  createReadTextKey,
  createRuntimeSnapshot,
  migrateSaveSlotRecord,
  replayDecisionLogToNodeId,
  truncateDecisionLogToNode,
  type DecisionLogEvent,
  type ReadTextKey,
  type RuntimeLoadWarning,
  type RuntimeRestoreResult,
  type RuntimeSnapshot,
  type SaveSlotRecord,
  type StoryPointId,
  createPlaythroughId,
} from "./runtimeContract";
import { assertVariableValue, clampVariableValue, effectiveVariables, isReadonlyVariableName, storyExperienceVariables, variableDefaults, variableKind, type StateWriteEvent } from "./variables";
import type { BacklogEntry, SkipMode } from "./renderer";

export interface GraphPlayerPersistentBridge {
  getReadStatus(key: ReadTextKey): boolean;
  markRead(key: ReadTextKey): void | Promise<void>;
}

export interface GraphPlayerDeps extends InterpreterDeps {
  meta: Meta;
  locales?: Readonly<Record<string, LocaleTable>>;
  currentLocale?: string;
  persistent?: GraphPlayerPersistentBridge;
  replayVoice?: (voiceId: string) => void;
  onRuntimeEffect?: RuntimeEffectHandler;
  onRuntimeTextDiagnostic?: (diagnostic: RuntimeTextDiagnosticEvent) => void;
  onStableCheckpoint?: (event: GraphPlayerStableCheckpointEvent) => void;
  onChapterReached?: (chapterId: string) => void | Promise<void>;
  onPlaybackEnded?: () => void;
  onEndingCommitted?: () => void | Promise<void>;
  variables?: VariableRegistry;
  globalState?: () => { vars: Record<string, string | number | boolean | null>; playthroughCount: number; lastEndingId: string | null };
}

export interface PlaybackTiming {
  textSpeedCps: number;
  autoAdvanceMs: number;
}

export interface GraphPlayerStableCheckpointEvent {
  reason: "node" | "choice";
  storyPoint: StoryPointId;
}

export interface RuntimeTextDiagnosticEvent {
  storyPoint: StoryPointId;
  diagnostic: {
    code: string;
    message: string;
    offset: number;
  };
}

export interface GraphPlayerNode {
  id: string;
  instructions: Instruction[];
}

export interface DebugSessionOptions {
  nodeId: string;
  instructionId?: string;
  variableOverrides?: Record<string, string | number | boolean | null>;
  suppressPersistentEffects: true;
}

type Listener = (state: NovelState) => void;
type StableInstruction = Extract<Instruction, { t: "say" | "narrate" | "wait" | "pause" | "inputName" | "choice" }>;

/**
 * Spec 35：嵌套指令执行帧。
 *
 * 节点的顶层指令序列是根帧（隐式，不在 frameStack 里，由 currentNodeId +
 * instructionsByNodeId 提供 this.ip 指向它）。遇到 `if` 的 then/else 或
 * `choice` 选项的 body 时压一个子帧，跑完弹回父帧续跑。
 *
 * 根帧的语义保持不变：this.ip 仍是节点级进度，seekToInstruction / 进度条 /
 * checkpoint 只看根帧。嵌套在 if/choice body 里的指令可正常演出，但 Phase 1
 * 不支持把 checkpoint 停点设在嵌套帧内。
 */
interface InstructionFrame {
  instructions: readonly Instruction[];
  /** 压帧时父帧（this.ip）停在哪：弹帧时恢复 this.ip = resumeIp。 */
  resumeIp: number;
  /**
   * 该帧的来源描述，用于 trace 归因（StateWriteEvent 里记的是根帧 index；
   * choice 选项 effect 还会带 choiceInstructionId / optionIndex）。
   */
  origin: { kind: "if-then" } | { kind: "if-else" } | { kind: "choice-body"; choiceInstructionId?: string; optionIndex: number };
}

/**
 * Spec 35：玩家面对 choice 指令时挂起的待选上下文。
 *
 * choose() 在 resume 时按 kind 分流：
 * - instruction：选项来自节点内 choice 指令，resume 后跑 option.effects/body。
 * - node：选项来自图出口（旧路径，Phase 1 后图路由不再产生 choice，保留兼容）。
 */
interface PendingChoiceContext {
  kind: "instruction";
  choiceInstructionId?: string;
  options: Array<{ optionIndex: number; text: string; to?: string }>;
}

export class GraphNovelPlayer {
  private deps: GraphPlayerDeps;
  private graph: ProjectGraphData | null = null;
  private instructionsByNodeId = new Map<string, Instruction[]>();
  private currentNodeId: string | null = null;
  private currentStoryPoint: StoryPointId | null = null;
  private lastStableStoryPoint: StoryPointId | null = null;
  private currentReadKey: ReadTextKey | null = null;
  private currentStableKind: StableInstruction["t"] | null = null;
  private decisions: DecisionLogEvent[] = [];
  /** 状态写入 trace：只存内存，不进存档。见 variables.ts 的 StateWriteEvent。 */
  private stateWrites: StateWriteEvent[] = [];
  /**
   * 进入当前节点时的变量快照。seekToInstruction 在节点内重放指令时以此为起点：
   * 从空 vars 起步会让 `affection + 1` 这类自引用赋值抛「未知变量」，
   * 而从「当前」vars 起步会把增量重复叠加。
   */
  private varsAtNodeEntry: Record<string, GraphRouteValue> = {};
  private ip = 0;
  /**
   * Spec 35：嵌套帧栈。空 = 当前在节点根帧（this.ip 指向根帧）；
   * 非空 = 顶层帧是当前执行位，跑完弹回栈顶父帧。
   */
  private frames: InstructionFrame[] = [];
  /** Spec 35：choice 指令挂起时的待选上下文，choose() resume 时消费。 */
  private pendingChoice: PendingChoiceContext | null = null;
  /** Spec 35：嵌套深度保护，独立于图路由深度。 */
  private static readonly MAX_INSTRUCTION_DEPTH = 32;
  private state: NovelState;
  private listeners = new Set<Listener>();
  private backlog: BacklogEntry[] = [];
  private backlogOrder = 0;
  private pendingVoiceId: string | undefined;
  private nameInputOrigins = new Map<string, GraphRouteValue | undefined>();
  private reportedRuntimeTextDiagnostics = new Set<string>();
  private markedReadKeys = new Set<string>();
  private reachedChapterIds = new Set<string>();
  private playbackEnded = false;
  private skipMode: SkipMode = "off";
  private skipTimer: ReturnType<typeof setTimeout> | null = null;
  private skipBudget = 0;
  private routeError: string | null = null;
  private currentLocale: string | undefined;
  private playthroughId = createPlaythroughId();

  getRouteError(): string | null {
    return this.routeError;
  }
  private playbackTiming: PlaybackTiming;
  private lastNodeCheckpointId: string | null = null;
  private pendingChoiceCheckpoint = false;
  private suppressStableCheckpoints = false;
  private persistentBarrier = false;

  private typingTimer: ReturnType<typeof setTimeout> | null = null;
  private waitTimer: ReturnType<typeof setTimeout> | null = null;
  private autoTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: GraphPlayerDeps) {
    this.deps = deps;
    this.currentLocale = deps.currentLocale ?? deps.meta.locale?.default;
    this.state = createInitialState();
    this.playbackTiming = {
      textSpeedCps: deps.meta.typingSpeedCps,
      autoAdvanceMs: deps.meta.autoAdvanceMs,
    };
  }

  loadGraph(graph: ProjectGraphData, nodes: GraphPlayerNode[]) {
    this.clearTimers();
    this.graph = graph;
    this.instructionsByNodeId = new Map(nodes.map((node) => [node.id, node.instructions]));
    this.currentNodeId = graph.entryNodeId || null;
    this.currentStoryPoint = null;
    this.lastStableStoryPoint = null;
    this.currentReadKey = null;
    this.currentStableKind = null;
    this.decisions = this.currentNodeId ? [{ type: "start", nodeId: this.currentNodeId }] : [];
    this.stateWrites = [];
    this.backlog = [];
    this.backlogOrder = 0;
    this.pendingVoiceId = undefined;
    this.nameInputOrigins.clear();
    this.reportedRuntimeTextDiagnostics.clear();
    this.markedReadKeys.clear();
    this.reachedChapterIds.clear();
    this.playbackEnded = false;
    this.skipMode = "off";
    this.skipBudget = 0;
    this.routeError = null;
    this.lastNodeCheckpointId = null;
    this.pendingChoiceCheckpoint = false;
    this.suppressStableCheckpoints = false;
    this.ip = 0;
    this.frames = [];
    this.pendingChoice = null;
    const total = this.currentInstructions().length;
    this.state = buildInitialState(0, total);
    this.state.vars = this.initialEffectiveVariables();
    this.varsAtNodeEntry = { ...this.state.vars };
    this.markCurrentChapterReached();
    this.emit();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  getState(): NovelState {
    return this.state;
  }

  getCurrentNodeId(): string | null {
    return this.currentNodeId;
  }

  getCurrentStoryPoint(): StoryPointId | null {
    return this.currentStoryPoint ? { ...this.currentStoryPoint } : null;
  }

  getCurrentInstructionId(): string | null {
    return this.currentStoryPoint?.instructionId ?? null;
  }

  getLastStableStoryPoint(): StoryPointId | null {
    return this.lastStableStoryPoint ? { ...this.lastStableStoryPoint } : null;
  }

  getCurrentReadKey(): ReadTextKey | null {
    return this.currentReadKey ? { ...this.currentReadKey } : null;
  }

  getBacklog(): BacklogEntry[] {
    return this.backlog.map((entry) => cloneBacklogEntry(entry));
  }

  getSkipMode(): SkipMode {
    return this.skipMode;
  }

  getPlaybackTiming(): PlaybackTiming {
    return { ...this.playbackTiming };
  }

  getCurrentLocale(): string | undefined {
    return this.currentLocale;
  }

  setCurrentLocale(locale: string | undefined) {
    this.currentLocale = locale ?? this.deps.meta.locale?.default;
    if (!this.currentStoryPoint || !this.currentNodeId) return;
    const instructions = this.currentInstructions();
    const index = instructions.findIndex(
      (instruction, instructionIndex) => getInstructionStoryPointId(instruction, instructionIndex) === this.currentStoryPoint?.instructionId,
    );
    const instruction = instructions[index];
    if (!instruction || (instruction.t !== "say" && instruction.t !== "narrate")) return;
    const next = this.applyRuntimeInstruction(this.state, instruction);
    this.state = revealFully(next);
    this.emit();
  }

  setPlaybackTiming(timing: PlaybackTiming) {
    if (!Number.isFinite(timing.textSpeedCps) || timing.textSpeedCps <= 0) {
      throw new RangeError("textSpeedCps must be a positive number.");
    }
    if (!Number.isInteger(timing.autoAdvanceMs) || timing.autoAdvanceMs < 0) {
      throw new RangeError("autoAdvanceMs must be a non-negative integer.");
    }
    const wasTyping = this.typingTimer != null && !this.isCurrentTextDone();
    const wasWaitingForAuto = this.autoTimer != null;
    this.playbackTiming = { ...timing };
    if (wasTyping) this.startTyping();
    if (wasWaitingForAuto) this.kickAuto();
  }

  getDecisionLog(): DecisionLogEvent[] {
    return this.decisions.map(cloneDecisionEvent);
  }

  /**
   * 本次运行中改变过故事状态的位置，按发生顺序。
   * 供预览的「剧情检查」回答「这个值是哪来的」；不进存档。
   */
  getStateWrites(): StateWriteEvent[] {
    return this.stateWrites.map((event) => ({ ...event }));
  }

  createSnapshot(): RuntimeSnapshot {
    const runVars = Object.fromEntries(Object.entries(this.state.vars).filter(([name]) => {
      // 只读命名空间（system./chose./seen.）是派生值，存进档只会和实际路径漂移。
      if (isReadonlyVariableName(name)) return false;
      return (this.deps.variables?.variables[name]?.scope ?? "run") === "run";
    }));
    return createRuntimeSnapshot({ ...this.state, vars: runVars }, {
      currentNodeId: this.currentNodeId ?? "entry",
      currentStoryPoint: this.getCurrentStoryPoint(),
    }, this.playthroughId, this.currentNameInputOrigin());
  }

  restoreSnapshot(snapshot: RuntimeSnapshot): RuntimeRestoreResult {
    this.clearTimers();
    this.suppressStableCheckpoints = false;
    const parsed = RuntimeSnapshotSchema.parse(snapshot);
    const result = this.applySnapshot(parsed);
    this.emit();
    return result;
  }

  restoreFromSave(record: SaveSlotRecord): RuntimeRestoreResult {
    const slot = migrateSaveSlotRecord(record);
    this.playthroughId = slot.checkpoint.playthroughId;
    this.decisions = slot.decisions.map(cloneDecisionEvent);
    // trace 属于「本次运行」，读档换了一条时间线，旧记录不能留。
    this.stateWrites = [];
    const result = this.restoreSnapshot(slot.checkpoint);
    if (result.warnings.length === 0 || !this.graph || slot.decisions.length === 0) {
      return result;
    }

    const replay = replayDecisionLogToNodeId(this.graph, slot.decisions);
    const warnings: RuntimeLoadWarning[] = [
      ...result.warnings,
      ...replay.warnings.map((message) => ({
        code: "decision_log_replay_warning",
        message,
        nodeId: replay.nodeId ?? undefined,
      })),
    ];

    if (replay.nodeId && this.instructionsByNodeId.has(replay.nodeId)) {
      this.restoreToNodeStart(replay.nodeId);
      warnings.push({
        code: "decision_log_replayed",
        message: `Checkpoint could not be restored; replayed decision log to node "${replay.nodeId}".`,
        nodeId: replay.nodeId,
      });
      return { warnings };
    }

    warnings.push({
      code: "decision_log_replay_failed",
      message: "Checkpoint could not be restored and decision log did not resolve to an existing node.",
      nodeId: replay.nodeId ?? undefined,
    });
    return { warnings };
  }

  jumpToStoryPoint(point: StoryPointId): RuntimeRestoreResult {
    this.clearTimers();
    this.suppressStableCheckpoints = false;
    this.decisions = truncateDecisionLogToNode(this.decisions, point.nodeId);
    // 回滚撤销了之后走过的路，那段路上的状态改变也不该继续出现在剧情检查里。
    this.stateWrites = this.stateWrites.filter((event) => event.decisionIndex <= this.decisions.length);
    const result = this.applyStoryPoint(point, this.stateForRollback());
    this.emit();
    return result;
  }

  /**
   * 回滚的起始状态：保留已积累的变量，只把派生的经历变量按裁剪后的决策日志重算。
   * 早期实现从空状态起步，回滚会把好感度之类的累积值一并清空，后续 auto 分支
   * 条件也会因此求值失败。
   */
  private stateForRollback(): NovelState {
    const currentInput = this.state.nameInput;
    const inputOrigin = currentInput && this.currentNodeId
      ? this.nameInputOrigins.get(`${this.currentNodeId}\u0000${currentInput.instructionId}`)
      : undefined;
    const carried = Object.fromEntries(
      Object.entries(this.state.vars).filter(([name]) => !isReadonlyVariableName(name)),
    );
    if (currentInput && this.currentNodeId && this.nameInputOrigins.has(`${this.currentNodeId}\u0000${currentInput.instructionId}`)) {
      if (inputOrigin === undefined) delete carried[currentInput.key];
      else carried[currentInput.key] = inputOrigin;
    }
    const global = this.deps.globalState?.() ?? { vars: {}, playthroughCount: 0, lastEndingId: null };
    return {
      ...createInitialState(),
      vars: effectiveVariables({
        run: carried,
        global: {},
        playthroughCount: global.playthroughCount,
        lastEndingId: global.lastEndingId,
        experience: this.currentExperience(),
      }),
    };
  }

  startReplay(nodeId: string): RuntimeRestoreResult {
    this.clearTimers();
    if (!this.instructionsByNodeId.has(nodeId)) {
      return {
        warnings: [{
          code: "node_not_found",
          message: `Replay node "${nodeId}" no longer exists.`,
          nodeId,
        }],
      };
    }
    this.suppressStableCheckpoints = true;
    this.playthroughId = `replay:${createPlaythroughId()}`;
    this.decisions = [{ type: "start", nodeId }];
    this.playbackEnded = false;
    this.restoreToNodeStart(nodeId);
    this.stepNext(0);
    return { warnings: [] };
  }

  startChapter(checkpoint: ChapterCheckpoint): RuntimeRestoreResult {
    this.clearTimers();
    if (!this.instructionsByNodeId.has(checkpoint.nodeId)) {
      return {
        warnings: [{
          code: "node_not_found",
          message: `Chapter node "${checkpoint.nodeId}" no longer exists.`,
          nodeId: checkpoint.nodeId,
        }],
      };
    }
    this.playthroughId = createPlaythroughId();
    this.decisions = [{ type: "start", nodeId: checkpoint.nodeId }];
    this.stateWrites = [];
    this.backlog = [];
    this.backlogOrder = 0;
    this.markedReadKeys.clear();
    this.reachedChapterIds.clear();
    this.suppressStableCheckpoints = false;
    this.playbackEnded = false;
    const snapshot = RuntimeSnapshotSchema.parse({
      playthroughId: this.playthroughId,
      currentNodeId: checkpoint.nodeId,
      currentStoryPoint: checkpoint.instructionId
        ? { nodeId: checkpoint.nodeId, instructionId: checkpoint.instructionId }
        : null,
      vars: checkpoint.vars,
      background: checkpoint.background,
      sprites: checkpoint.sprites,
      bgm: checkpoint.bgm,
    });
    const result = this.applySnapshot(snapshot);
    if (result.warnings.length === 0 && snapshot.currentStoryPoint == null) {
      this.stepNext(0);
    } else {
      this.markCurrentChapterReached();
      this.emit();
    }
    return result;
  }

  startDebugSession(options: DebugSessionOptions): RuntimeRestoreResult {
    if (!this.instructionsByNodeId.has(options.nodeId)) {
      return { warnings: [{ code: "node_not_found", message: `Debug node "${options.nodeId}" no longer exists.`, nodeId: options.nodeId }] };
    }
    this.clearTimers();
    this.suppressStableCheckpoints = options.suppressPersistentEffects;
    this.playthroughId = `debug:${createPlaythroughId()}`;
    this.restoreToNodeStart(options.nodeId);
    this.suppressStableCheckpoints = true;
    this.state = { ...this.state, vars: { ...this.initialEffectiveVariables(), ...options.variableOverrides } };
    if (options.instructionId) {
      const result = this.applyStoryPoint({ nodeId: options.nodeId, instructionId: options.instructionId }, this.state);
      this.suppressStableCheckpoints = true;
      this.emit();
      return result;
    }
    this.emit();
    return { warnings: [] };
  }

  /**
   * 调试会话里可以覆盖任何变量，包括 system./chose./seen. —— 「假设玩家已经通关一周目
   * 并且选过这个选项」正是试算要问的问题。`startDebugSession` 的 variableOverrides
   * 一直就允许，这里保持一致。非调试会话仍然完全不可写。
   */
  setDebugVariable(name: string, value: string | number | boolean | null): void {
    if (!this.playthroughId.startsWith("debug:")) return;
    this.state = { ...this.state, vars: { ...this.state.vars, [name]: value } };
    this.emit();
  }

  resetDebugVariables(): void {
    if (!this.playthroughId.startsWith("debug:")) return;
    this.state = { ...this.state, vars: this.initialEffectiveVariables() };
    this.emit();
  }

  rollbackToHistoryEntry(entryId: string): RuntimeRestoreResult {
    const entry = this.backlog.find((item) => item.id === entryId);
    if (!entry) {
      return {
        warnings: [{
          code: "story_point_not_found",
          message: `Backlog entry "${entryId}" was not found.`,
        }],
      };
    }
    const result = this.jumpToStoryPoint(entry.storyPoint);
    const order = entry.createdOrder ?? Number.POSITIVE_INFINITY;
    this.backlog = this.backlog.filter((item) => (item.createdOrder ?? 0) <= order);
    return result;
  }

  replayVoice(entryId: string): void {
    const voiceId = this.backlog.find((entry) => entry.id === entryId)?.voiceId;
    if (voiceId) this.deps.replayVoice?.(voiceId);
  }

  setSkipMode(mode: SkipMode) {
    if (mode === "off") {
      this.stopSkip();
      return;
    }
    this.clearAuto();
    this.skipMode = mode;
    this.skipBudget = 10_000;
    this.state = {
      ...this.state,
      flags: { ...this.state.flags, isAutoPlay: false, skipMode: mode },
    };
    this.emit();
    this.queueSkipTick();
  }

  setAutoPlay(on: boolean) {
    if (on) this.stopSkip(false);
    else this.clearAuto();
    this.state = {
      ...this.state,
      flags: { ...this.state.flags, isAutoPlay: on, skipMode: on ? "off" : this.skipMode },
    };
    this.emit();
    if (on) this.kickAuto();
  }

  setRecording(on: boolean) {
    this.state = { ...this.state, flags: { ...this.state.flags, isRecording: on } };
    this.emit();
    if (on) this.setAutoPlay(true);
  }

  advance() {
    if (this.persistentBarrier) return;
    if (this.state.flags.isWaiting) return;
    if (this.state.choice || this.state.nameInput) return;
    if (!this.isCurrentTextDone()) {
      this.clearTyping();
      this.state = revealFully(this.state);
      this.markCurrentReadIfRevealed();
      this.emit();
      return;
    }
    this.stepNext(0);
  }

  /**
   * Spec 35：玩家选了一个选项。
   *
   * 优先按 `optionIndex` 解析（choice 指令来源）；若 `toNodeId` 命中某个选项的
   * `to`，也可解析。两种来源分流：
   * - instruction：选项来自节点内 choice 指令。跑 option.effects → 若有 body 压帧
   *   续跑；若 option.to 存在则跳目标节点；都没有则回到 choice 指令之后合流。
   * - node：选项来自图出口（Phase 1 后图路由不再产生 choice，保留兼容）。
   */
  choose(toNodeId?: string, optionIndex?: number) {
    const ctx = this.pendingChoice;
    const choices = this.state.choice?.choices ?? [];
    if (!choices.length) return;

    let resolved: { kind: "instruction"; optionIndex: number; to?: string } | { kind: "node"; to: string } | null = null;

    if (ctx?.kind === "instruction") {
      // 优先用 optionIndex，其次用 toNodeId 反查。
      const idx = optionIndex != null
        ? optionIndex
        : (toNodeId != null ? ctx.options.findIndex((opt) => opt.to === toNodeId) : -1);
      if (idx >= 0 && idx < ctx.options.length) {
        const opt = ctx.options[idx];
        resolved = { kind: "instruction", optionIndex: idx, to: opt.to };
      }
    } else {
      // 旧路径：图出口直连。按 toNodeId 匹配 state.choice.choices。
      if (toNodeId && choices.some((c) => c.to === toNodeId)) {
        resolved = { kind: "node", to: toNodeId };
      }
    }
    if (!resolved) return;

    this.clearAuto();
    this.pendingChoice = null;
    this.state = { ...this.state, choice: null };
    const fromNodeId = this.currentNodeId;

    if (resolved.kind === "instruction") {
      const choiceInstr = this.findChoiceInstructionById(ctx!.choiceInstructionId);
      const option = choiceInstr?.options[resolved.optionIndex];
      if (fromNodeId) {
        this.decisions.push({
          type: "choice",
          fromNodeId,
          toNodeId: resolved.to ?? fromNodeId,
          choiceInstructionId: ctx!.choiceInstructionId,
          optionIndex: resolved.optionIndex,
        });
        this.syncExperienceToState();
      }
      // option.effects 在 body 之前执行（body 能看到已更新的变量）。
      if (option && !this.applyChoiceOptionEffects(option, ctx!.choiceInstructionId, resolved.optionIndex)) return;

      // Spec 35：choice 的 checkpoint 已在 presentChoiceInstruction 时发出，
      // 这里不再重复标记 pendingChoiceCheckpoint（避免目标节点再发一次）。
      if (resolved.to) {
        this.jumpToNode(resolved.to);
        this.stepNext(0);
      } else if (option?.body && option.body.length > 0) {
        // 有 body 无 to：压帧跑反应演出，跑完回到 choice 指令之后。
        // this.ip 已是 choice 指令之后的位置（presentChoiceInstruction 前已 ip += 1）。
        this.frames.push({
          instructions: option.body,
          resumeIp: this.ip,
          origin: { kind: "choice-body", choiceInstructionId: ctx!.choiceInstructionId, optionIndex: resolved.optionIndex },
        });
        this.ip = 0;
        this.stepNext(0);
      } else {
        // 既无 body 也无 to：直接回到 choice 指令之后续跑指令序列（合流）。
        this.stepNext(0);
      }
      return;
    }

    // ── node 来源（图出口直连，兼容旧路径）──
    const edge = fromNodeId
      ? this.graph?.edges.find((candidate) => candidate.from === fromNodeId && candidate.to === resolved.to)
      : null;
    if (fromNodeId && edge) {
      this.decisions.push({ type: "choice", fromNodeId, toNodeId: resolved.to, edgeId: edge.id });
      this.syncExperienceToState();
      if (!this.applyEdgeEffects(edge)) return;
    }
    this.pendingChoiceCheckpoint = true;
    this.jumpToNode(resolved.to);
    this.stepNext(0);
  }

  /** 在当前节点的指令序列（含嵌套）里按 id 找回 choice 指令，用于读取选项 effects/body。 */
  private findChoiceInstructionById(choiceInstructionId?: string): Extract<Instruction, { t: "choice" }> | null {
    if (!choiceInstructionId || !this.currentNodeId) return null;
    const root = this.instructionsByNodeId.get(this.currentNodeId) ?? [];
    const search = (list: readonly Instruction[]): Extract<Instruction, { t: "choice" }> | null => {
      for (const instr of list) {
        if (instr.t === "choice") {
          if (instr.id === choiceInstructionId) return instr;
          for (const opt of instr.options) {
            if (opt.body) {
              const nested = search(opt.body);
              if (nested) return nested;
            }
          }
        } else if (instr.t === "if") {
          const inThen = search(instr.then);
          if (inThen) return inThen;
          if (instr.else) {
            const inElse = search(instr.else);
            if (inElse) return inElse;
          }
        }
      }
      return null;
    };
    return search(root);
  }

  /**
   * 应用 choice 选项的 effects（在 body 之前执行）。
   * 返回 false 表示赋值失败并已停在错误上。
   */
  private applyChoiceOptionEffects(
    option: Extract<Instruction, { t: "choice" }>["options"][number],
    choiceInstructionId: string | undefined,
    optionIndex: number,
  ): boolean {
    if (!this.currentNodeId) return true;
    for (const effect of option.effects ?? []) {
      try {
        this.state = this.applyRuntimeInstruction(this.state, effect, undefined, {
          nodeId: this.currentNodeId,
          choiceInstructionId,
          optionIndex,
        });
      } catch (error) {
        this.stopOnAssignmentError(error, this.ip);
        return false;
      }
    }
    if ((option.effects?.length ?? 0) > 0) this.emit();
    return true;
  }

  submitName(value: string): boolean {
    const input = this.state.nameInput;
    if (!input) return false;
    const normalized = value.trim() || input.default?.trim() || "";
    const length = Array.from(normalized).length;
    if (!normalized) {
      this.state = {
        ...this.state,
        nameInput: { ...input, error: "请输入名字。" },
      };
      this.emit();
      return false;
    }
    if (length > input.maxLength) {
      this.state = {
        ...this.state,
        nameInput: { ...input, error: `名字不能超过 ${input.maxLength} 个字符。` },
      };
      this.emit();
      return false;
    }

    const declaration = this.deps.variables?.variables[input.key];
    if (!declaration || variableKind(declaration) !== "text" || declaration.type !== "string") {
      this.state = {
        ...this.state,
        nameInput: { ...input, error: `故事状态 ${input.key} 不是可命名的文本状态。` },
      };
      this.emit();
      return false;
    }
    try {
      assertVariableValue(input.key, normalized, declaration);
    } catch (error) {
      this.state = {
        ...this.state,
        nameInput: { ...input, error: error instanceof Error ? error.message : String(error) },
      };
      this.emit();
      return false;
    }
    this.state = {
      ...this.state,
      vars: { ...this.state.vars, [input.key]: normalized },
      nameInput: null,
    };
    this.emit();
    this.stepNext(0);
    return true;
  }

  restart() {
    if (!this.graph) return;
    this.playthroughId = createPlaythroughId();
    this.loadGraph(this.graph, Array.from(this.instructionsByNodeId, ([id, instructions]) => ({ id, instructions })));
  }

  seekBy(delta: number) {
    if (delta < 0) {
      this.seekToInstruction(this.ip + delta);
    } else if (delta > 0) {
      this.stepOnce();
    }
  }

  /**
   * Rebuild the current node state through the first `target` instructions.
   * This is intentionally side-effect free: runtime effects, persistence writes,
   * and timers must not fire while a preview/debugger moves its playhead.
   */
  seekToInstruction(target: number) {
    this.clearTimers();
    const instructions = this.currentInstructions();
    const clamped = Math.max(0, Math.min(target, instructions.length));
    let nextState = buildInitialState(0, instructions.length);
    // 从进入本节点时的变量重放：空 vars 会让 `affection + 1` 抛「未知变量」，
    // 当前 vars 则会把已经算过的增量再叠一次。
    nextState.vars = { ...this.varsAtNodeEntry };
    let lastStable: { instruction: StableInstruction; index: number } | null = null;

    for (let index = 0; index < clamped; index += 1) {
      const instruction = instructions[index];
      nextState = this.applyRuntimeInstruction(nextState, instruction);
      if (isStableInstruction(instruction)) lastStable = { instruction, index };
    }

    if (clamped > 0) {
      const last = instructions[clamped - 1];
      if (last.t === "say" || last.t === "narrate") nextState = revealFully(nextState);
    }
    nextState.flags.isWaiting = false;
    nextState.flags.progress.current = clamped;
    if (lastStable?.instruction.t === "inputName" && this.currentNodeId) {
      const instructionId = getInstructionStoryPointId(lastStable.instruction, lastStable.index);
      if (instructionId) {
        nextState = this.restoreNameInputOrigin(
          { nodeId: this.currentNodeId, instructionId },
          lastStable.instruction,
          nextState,
        );
      }
    }
    nextState = this.withRestoredAudio(nextState);

    this.ip = clamped;
    this.state = nextState;
    this.currentStoryPoint = null;
    this.lastStableStoryPoint = null;
    this.currentReadKey = null;
    this.currentStableKind = null;
    this.pendingVoiceId = undefined;
    this.routeError = null;
    // Spec 35：seek 只在根帧定位，清掉嵌套帧与待选上下文。
    this.frames = [];
    this.pendingChoice = null;

    if (lastStable && this.currentNodeId) {
      const instructionId = getInstructionStoryPointId(lastStable.instruction, lastStable.index);
      if (instructionId) {
        this.currentStoryPoint = { nodeId: this.currentNodeId, instructionId };
        this.lastStableStoryPoint = { ...this.currentStoryPoint };
        this.currentStableKind = lastStable.instruction.t;
        if (lastStable.instruction.t === "say" || lastStable.instruction.t === "narrate") {
          this.currentReadKey = createReadTextKey({
            ...this.currentStoryPoint,
            text: lastStable.instruction.text,
          });
        }
      }
    }
    this.emit();
  }

  stepOnce() {
    this.clearTimers();
    if (this.ip >= this.currentInstructions().length) {
      this.resolveRoute(0);
      return;
    }
    const index = this.ip;
    const instr = this.currentInstructions()[index];
    this.ip += 1;
    if (instr.t === "inputName") {
      this.nameInputOrigins.set(this.storyPointKey(instr.id ?? `index:${index}`), this.state.vars[instr.key]);
    }
    try {
      this.state = this.applyRuntimeInstruction(this.state, instr, index);
    } catch (error) {
      if (instr.t === "inputName") this.nameInputOrigins.delete(this.storyPointKey(instr.id ?? `index:${index}`));
      this.stopOnAssignmentError(error, index);
      return;
    }
    this.trackInstructionSideEffects(instr);
    this.emitRuntimeEffect(instr);
    this.updateCurrentStoryPoint(instr, index, false);
    if (instr.t === "say" || instr.t === "narrate") {
      this.addBacklogEntry(instr, index);
      this.state = revealFully(this.state);
      this.markCurrentReadIfRevealed();
    }
    if (instr.t === "wait") this.state.flags.isWaiting = false;
    this.state.flags.progress.current = this.ip;
    this.emit();
  }

  prevChapter() {}
  nextChapter() {}

  get totalInstructions(): number { return this.currentInstructions().length; }
  get currentIndex(): number { return this.ip; }

  dispose() {
    this.clearTimers();
    this.listeners.clear();
  }

  private currentInstructions(): Instruction[] {
    // Spec 35：嵌套帧优先；没有帧时回到节点根帧。
    const top = this.frames.at(-1);
    if (top) return [...top.instructions];
    if (!this.currentNodeId) return [];
    return this.instructionsByNodeId.get(this.currentNodeId) ?? [];
  }

  private jumpToNode(nodeId: string) {
    this.currentNodeId = nodeId;
    this.playbackEnded = false;
    this.varsAtNodeEntry = { ...this.state.vars };
    this.currentStoryPoint = null;
    this.currentReadKey = null;
    this.currentStableKind = null;
    this.ip = 0;
    // Spec 35：进入新节点清空嵌套帧与待选上下文，从根帧重新开始。
    this.frames = [];
    this.pendingChoice = null;
    this.state = {
      ...this.state,
      speaker: null,
      dialogue: null,
      narration: null,
      nameInput: null,
      choice: null,
      flags: {
        ...this.state.flags,
        chapterIndex: 0,
        progress: { current: 0, total: this.currentInstructions().length },
      },
    };
    this.markCurrentChapterReached();
    this.emit();
  }

  private restoreToNodeStart(nodeId: string) {
    this.clearTimers();
    this.currentNodeId = nodeId;
    this.currentStoryPoint = null;
    this.lastStableStoryPoint = null;
    this.currentReadKey = null;
    this.currentStableKind = null;
    this.pendingVoiceId = undefined;
    this.routeError = null;
    this.playbackEnded = false;
    this.ip = 0;
    this.state = buildInitialState(0, this.currentInstructions().length);
    this.state.vars = this.initialEffectiveVariables();
    this.varsAtNodeEntry = { ...this.state.vars };
    this.markCurrentChapterReached();
    this.emit();
  }

  private stepNext(routeDepth: number) {
    this.clearTyping();
    this.clearAuto();

    if (this.state.sprites.some((sprite) => sprite.leaving)) {
      this.state = { ...this.state, sprites: this.state.sprites.filter((sprite) => !sprite.leaving) };
    }

    // Spec 35：循环到「当前帧」用完。帧用完时弹回父帧续跑；根帧用完才路由。
    while (true) {
      const instructions = this.currentInstructions();
      if (this.ip >= instructions.length) {
        // 当前帧跑完。如果嵌在子帧里，弹回父帧续跑（恢复父帧的 this.ip）；
        // 否则走图路由。
        if (this.frames.length > 0) {
          const frame = this.frames.pop()!;
          this.ip = frame.resumeIp;
          continue;
        }
        this.resolveRoute(routeDepth);
        return;
      }

      const index = this.ip;
      const instr = instructions[index];
      this.ip += 1;

      // ── Spec 35：if / choice 是控制流指令，不经过 applyRuntimeInstruction ──
      if (instr.t === "if") {
        if (!this.pushConditionalFrame(instr.then, instr.else, { kind: instr.condition ? "if-then" : "if-then" }, routeDepth, instr.condition)) {
          return; // 条件求值出错或超深，已停。
        }
        continue;
      }
      if (instr.t === "choice") {
        this.presentChoiceInstruction(instr, routeDepth);
        return; // choice 挂起等玩家，afterStep 已由 presentChoiceInstruction 处理。
      }

      if (instr.t === "inputName") {
        this.nameInputOrigins.set(this.storyPointKey(instr.id ?? `index:${index}`), this.state.vars[instr.key]);
      }
      try {
        this.state = this.applyRuntimeInstruction(this.state, instr, this.isRootFrame() ? index : undefined, this.currentFrameOrigin());
      } catch (error) {
        if (instr.t === "inputName") this.nameInputOrigins.delete(this.storyPointKey(instr.id ?? `index:${index}`));
        this.stopOnAssignmentError(error, index);
        return;
      }
      this.trackInstructionSideEffects(instr);
      if (this.emitRuntimeEffect(instr, this.isRootFrame() ? index : undefined, routeDepth)) return;
      if (this.isRootFrame()) this.state.flags.progress.current = this.ip;
      this.emit();

      if (this.afterStep(instr, index)) return;
    }
  }

  private isRootFrame(): boolean {
    return this.frames.length === 0;
  }

  private currentFrameOrigin(): { nodeId: string; edgeId: string } | { nodeId: string; choiceInstructionId?: string; optionIndex: number } | undefined {
    const top = this.frames.at(-1);
    if (!top) return undefined;
    if (top.origin.kind === "choice-body" && this.currentNodeId) {
      return { nodeId: this.currentNodeId, choiceInstructionId: top.origin.choiceInstructionId, optionIndex: top.origin.optionIndex };
    }
    // if-then / if-else 帧没有出口归因，用根帧 index 即可（applyRuntimeInstruction 传 undefined）。
    return undefined;
  }

  /**
   * Spec 35：求 if 条件并把命中的分支压成子帧。
   * condition 为空字符串时也走 then（与 expression 引擎「空条件=真」一致）。
   * 返回 false 表示求值出错或超深，已停。
   */
  private pushConditionalFrame(
    thenBranch: readonly Instruction[],
    elseBranch: readonly Instruction[] | undefined,
    _origin: { kind: "if-then" },
    routeDepth: number,
    condition: string,
  ): boolean {
    if (this.frames.length >= GraphNovelPlayer.MAX_INSTRUCTION_DEPTH) {
      this.routeError = "instruction_depth_exceeded";
      this.clearAuto();
      this.stopSkip();
      return false;
    }
    const result = evaluateGraphConditionResult(condition, this.state.vars);
    if (!result.ok) {
      console.warn(`[graph-player] if 条件无效：${result.message}`);
      this.routeError = `if 条件无效：${result.message}`;
      this.clearAuto();
      this.stopSkip();
      return false;
    }
    const branch = result.value ? thenBranch : (elseBranch ?? []);
    if (branch.length === 0) return true; // 命中的分支为空 = 直接合流，不压帧
    // 压帧：当前 this.ip 已经是 if 之后的位置（调用前已 ip += 1），存为 resumeIp；
    // 子帧从 0 起步。
    this.frames.push({ instructions: branch, resumeIp: this.ip, origin: { kind: "if-then" } });
    this.ip = 0;
    void routeDepth;
    return true;
  }

  /**
   * Spec 35：呈现 choice 指令的选项，挂起等玩家选择。
   */
  private presentChoiceInstruction(instr: Extract<Instruction, { t: "choice" }>, _routeDepth: number) {
    this.pendingChoice = {
      kind: "instruction",
      choiceInstructionId: instr.id,
      options: instr.options.map((option, optionIndex) => ({
        optionIndex,
        text: option.text,
        to: option.to,
      })),
    };
    this.state = {
      ...this.state,
      speaker: null,
      dialogue: null,
      narration: null,
      choice: {
        choices: instr.options.map((option, optionIndex) => ({
          text: option.text,
          to: option.to,
          optionIndex,
        })),
      },
      currentCueMs: null,
    };
    // choice 是 storyPoint（带 id 时）—— 在中断处登记并发 choice checkpoint，
    // 便于 save/restore 在「玩家面对选项」这一刻停住。
    if (instr.id && this.currentNodeId) {
      this.pendingChoiceCheckpoint = true;
      this.updateCurrentStoryPoint(instr, this.ip - 1);
    }
    this.clearAuto();
    this.stopSkip();
    this.emit();
  }

  private resolveRoute(routeDepth: number) {
    if (!this.graph || !this.currentNodeId) return;
    if (routeDepth > Math.max(8, this.graph.nodes.length * 4)) {
      console.warn("[graph-player] 路由超过循环保护上限，已停止。");
      this.routeError = "route_depth_exceeded";
      this.stopSkip();
      return;
    }

    const outgoing = this.graph.edges.filter((edge) => edge.from === this.currentNodeId);
    const decision = decideGraphRoute(outgoing, this.state);
    switch (decision.kind) {
      case "end":
        this.clearAuto();
        if (!this.playbackEnded) {
          this.playbackEnded = true;
          this.deps.onPlaybackEnded?.();
        }
        return;
      case "error":
        console.warn(`[graph-player] ${decision.message}`);
        this.routeError = decision.message;
        this.clearAuto();
        this.stopSkip();
        return;
      case "target":
        this.followEdge(decision.edge, routeDepth);
        return;
    }
  }

  private followEdge(edge: GraphEdgeData, routeDepth: number) {
    if (!this.instructionsByNodeId.has(edge.to)) {
      console.warn(`[graph-player] 目标节点不存在或没有内容：${edge.to}`);
      this.routeError = `Target node ${edge.to} does not exist.`;
      this.clearAuto();
      this.stopSkip();
      return;
    }
    // Spec 35：所有多出口都是条件路由（旧 auto 语义）；linear/单出口直接走。
    // 一律记一条 auto 决策（条件路由），让 seen.* 更新；线性单出口也记，保持
    // 「离开节点即记账」的语义。
    this.decisions.push({ type: "auto", fromNodeId: edge.from, toNodeId: edge.to, edgeId: edge.id });
    this.syncExperienceToState();
    if (!this.applyEdgeEffects(edge)) return;
    this.jumpToNode(edge.to);
    this.stepNext(routeDepth + 1);
  }

  /**
   * 应用「走这条出口之后」的状态改变。
   *
   * 在离开来源节点、进入目标节点之前生效，因此目标节点的条件与指令看到的已经是
   * 新值。返回 false 表示赋值失败并已停在错误上，调用方不应继续推进。
   */
  private applyEdgeEffects(edge: GraphEdgeData): boolean {
    for (const effect of edge.effects ?? []) {
      try {
        this.state = this.applyRuntimeInstruction(this.state, effect, undefined, {
          nodeId: edge.from,
          edgeId: edge.id,
        });
      } catch (error) {
        this.stopOnAssignmentError(error, this.ip);
        return false;
      }
    }
    if ((edge.effects?.length ?? 0) > 0) this.emit();
    return true;
  }

  /**
   * 把当前决策日志派生的经历变量合并进 state.vars。
   *
   * `chose.*` / `seen.*` 在玩家做出决策那一刻起就应该对后续条件可见，
   * 不能等到下一次完整重建状态才生效。此方法在每次追加决策后调用。
   */
  private syncExperienceToState() {
    const experience = this.currentExperience();
    this.state = { ...this.state, vars: { ...this.state.vars, ...experience } };
  }

  private afterStep(instr: Instruction, index: number): boolean {
    this.updateCurrentStoryPoint(instr, index);
    switch (instr.t) {
      case "say":
      case "narrate":
        this.addBacklogEntry(instr, index);
        this.startTyping();
        return true;
      case "wait":
        this.startWait(instr.ms);
        return true;
      case "pause":
      case "inputName":
        this.clearAuto();
        return true;
      default:
        return false;
    }
  }

  private isCurrentTextDone(): boolean {
    const dialogue = this.state.dialogue;
    const narration = this.state.narration;
    if (dialogue) return dialogue.fullyRevealed;
    if (narration) return narration.fullyRevealed;
    return true;
  }

  private static PUNCT_DELAY: Record<string, number> = {
    "，": 180, "。": 320, "！": 320, "？": 320, "…": 240,
    ",": 140, ".": 260, "!": 260, "?": 260, "——": 200,
    "、": 180, "；": 260, "：": 220,
  };

  private startTyping() {
    this.clearTyping();
    const baseInterval = Math.max(8, Math.round(1000 / this.playbackTiming.textSpeedCps));

    const tick = () => {
      this.state = advanceTyping(this.state);
      this.markCurrentReadIfRevealed();
      this.emit();

      if (this.isCurrentTextDone()) {
        this.clearTyping();
        this.kickAuto();
        return;
      }
      this.typingTimer = setTimeout(tick, this.nextRuntimeTextDelay(baseInterval));
    };
    this.typingTimer = setTimeout(tick, this.nextRuntimeTextDelay(baseInterval));
  }

  private nextRuntimeTextDelay(baseInterval: number): number {
    const next = this.peekNextChar();
    const punctuationDelay = next && next in GraphNovelPlayer.PUNCT_DELAY
      ? GraphNovelPlayer.PUNCT_DELAY[next]
      : 0;
    return baseInterval + punctuationDelay + this.currentRuntimeTextPause();
  }

  private currentRuntimeTextPause(): number {
    const text = this.state.dialogue ?? this.state.narration;
    if (!text?.tokens) return 0;
    return runtimeTextPauseAt({
      source: text.sourceText ?? text.text,
      plainText: text.text,
      tokens: text.tokens,
      diagnostics: text.diagnostics ?? [],
    }, text.typedLen);
  }

  private peekNextChar(): string | null {
    const dialogue = this.state.dialogue;
    const narration = this.state.narration;
    const text = dialogue?.text ?? narration?.text ?? null;
    const len = dialogue?.typedLen ?? narration?.typedLen ?? 0;
    if (!text || len >= text.length) return null;
    if (text.slice(len, len + 2) === "——") return "——";
    if (text.slice(len, len + 1) === "…") return "…";
    return text[len];
  }

  private startWait(ms: number) {
    this.clearWait();
    this.state = { ...this.state, flags: { ...this.state.flags, isWaiting: true } };
    this.emit();
    this.waitTimer = setTimeout(() => {
      this.state = { ...this.state, flags: { ...this.state.flags, isWaiting: false } };
      this.emit();
      this.stepNext(0);
    }, ms);
  }

  private kickAuto() {
    this.clearAuto();
    if (!this.state.flags.isAutoPlay && !this.state.flags.isRecording) return;
    if (this.state.flags.isWaiting || this.state.choice || this.state.nameInput) return;
    const cueMs = this.state.currentCueMs ?? this.playbackTiming.autoAdvanceMs;
    const delay = this.state.flags.isRecording ? cueMs + 400 : cueMs;
    this.autoTimer = setTimeout(() => this.advance(), delay);
  }

  private emit() {
    for (const listener of this.listeners) listener(this.state);
  }

  private emitRuntimeEffect(instr: Instruction, index?: number, routeDepth = 0): boolean {
    if (this.suppressStableCheckpoints) return false;
    const effect = instr.t === "set" && (this.deps.variables?.variables[instr.key]?.scope ?? "run") === "global"
      ? {
          type: "globalSet" as const,
          id: instr.id ?? "",
          key: instr.key,
          value: this.resolveSetValue(instr, this.state.vars),
          nodeId: this.currentNodeId ?? undefined,
          playthroughId: this.playthroughId,
        }
      : runtimeEffectFromInstruction(instr);
    if (!effect) return false;
    const enriched = effect.type === "completeEnding"
      ? { ...effect, nodeId: this.currentNodeId ?? undefined, playthroughId: this.playthroughId }
      : effect;
    const result = this.deps.onRuntimeEffect?.(enriched);
    if ((effect.type === "completeEnding" || effect.type === "globalSet") && result instanceof Promise) {
      this.persistentBarrier = true;
      void result.then(() => {
        this.persistentBarrier = false;
        this.refreshPersistentVariableView();
        if (index != null) this.updateCurrentStoryPoint(instr, index);
        if (instr.t === "completeEnding") {
          void Promise.resolve(this.deps.onEndingCommitted?.()).catch(() => undefined);
        }
        this.stepNext(routeDepth);
      }).catch((error) => {
        this.persistentBarrier = false;
        this.routeError = `runtime_persistent_effect_failed: ${error instanceof Error ? error.message : String(error)}`;
        this.emit();
      });
      return true;
    }
    return false;
  }

  /**
   * @param instructionIndex 当前指令在节点根帧里的下标；给状态写入 trace 用。
   *   重放（seekToInstruction）传 undefined，此时不记 trace —— 重放会把同一批
   *   指令再跑一遍，记下来会让「发生过的状态变化」出现重复条目。
   *   Spec 35：嵌套在 if/choice body 里的指令也传 undefined（trace 只在根帧记账）。
   * @param origin 出口效果 / choice 选项效果的归因；普通节点内指令不传。
   */
  private applyRuntimeInstruction(
    state: NovelState,
    instr: Instruction,
    instructionIndex?: number,
    origin?: { nodeId: string; edgeId: string } | { nodeId: string; choiceInstructionId?: string; optionIndex: number },
  ): NovelState {
    if (instr.t === "say" || instr.t === "narrate") {
      const localized = this.localizedInstruction(instr);
      const formatted = formatRuntimeText(
        localized.text,
        state.vars,
        this.deps.variables,
        this.runtimeThemeColors(),
      );
      if (instructionIndex != null) {
        this.reportRuntimeTextDiagnostics(instr, instructionIndex, formatted.diagnostics);
      }
      const next = applyInstruction(state, { ...localized, text: formatted.plainText }, this.deps);
      const runtimeText = {
        text: formatted.plainText,
        sourceText: localized.text,
        tokens: formatted.tokens,
        diagnostics: formatted.diagnostics,
        typedLen: 0,
        fullyRevealed: false,
      };
      return instr.t === "say"
        ? { ...next, dialogue: runtimeText }
        : { ...next, narration: runtimeText };
    }
    if (instr.t !== "set") return applyInstruction(state, instr, this.deps);
    const declaration = this.deps.variables?.variables[instr.key];
    const value = this.resolveSetValue(instr, state.vars);
    try {
      assertVariableValue(instr.key, value, declaration);
    } catch (error) {
      throw new RuntimeAssignmentError(error instanceof Error ? error.message : String(error));
    }
    if (origin) this.recordExitOrChoiceStateWrite(instr.key, state.vars[instr.key] ?? null, value, origin);
    else if (instructionIndex != null) this.recordStateWrite(instr.key, state.vars[instr.key] ?? null, value, instructionIndex);
    if ((declaration?.scope ?? "run") === "global") {
      if (!instr.id) throw new Error(`global set ${instr.key} 缺少稳定 id`);
      return state;
    }
    return { ...state, vars: { ...state.vars, [instr.key]: value } };
  }

  /** 出口效果 / choice 选项效果的写入：归属到出口或选项，检查面板才能说「因为选了这个选项」。 */
  private recordExitOrChoiceStateWrite(
    variable: string,
    from: GraphRouteValue,
    to: GraphRouteValue,
    origin: { nodeId: string; edgeId: string } | { nodeId: string; choiceInstructionId?: string; optionIndex: number },
  ) {
    if (from === to) return;
    if ("edgeId" in origin) {
      this.stateWrites.push({
        variable,
        from,
        to,
        nodeId: origin.nodeId,
        edgeId: origin.edgeId,
        decisionIndex: this.decisions.length,
      });
    } else {
      this.stateWrites.push({
        variable,
        from,
        to,
        nodeId: origin.nodeId,
        choiceInstructionId: origin.choiceInstructionId,
        optionIndex: origin.optionIndex,
        decisionIndex: this.decisions.length,
      });
    }
  }

  /** 值没变就不记：作者关心的是「哪里改了它」，不是「哪里碰过它」。 */
  private recordStateWrite(
    variable: string,
    from: GraphRouteValue,
    to: GraphRouteValue,
    instructionIndex: number,
  ) {
    if (from === to || !this.currentNodeId) return;
    this.stateWrites.push({
      variable,
      from,
      to,
      nodeId: this.currentNodeId,
      instructionIndex,
      decisionIndex: this.decisions.length,
    });
  }

  /**
   * `set` 的最终写入值：先算表达式或字面量，再按声明范围钳制。
   * run 与 global 两条写入路径共用，避免只有一边遵守范围。
   */
  private resolveSetValue(instr: SetInstr, vars: Record<string, GraphRouteValue>): GraphRouteValue {
    const raw = "expr" in instr && instr.expr != null
      ? evaluateAssignmentExpression(instr.expr, vars)
      : instr.value ?? null;
    return clampVariableValue(raw, this.deps.variables?.variables[instr.key]);
  }

  private stopOnAssignmentError(error: unknown, instructionIndex: number) {
    this.ip = instructionIndex;
    this.routeError = `${error instanceof RuntimeAssignmentError ? error.code : "runtime_assignment_failed"}: ${error instanceof Error ? error.message : String(error)}`;
    this.clearAuto();
    this.stopSkip();
    this.emit();
  }

  private initialEffectiveVariables() {
    const global = this.deps.globalState?.() ?? { vars: {}, playthroughCount: 0, lastEndingId: null };
    return effectiveVariables({
      run: { ...this.legacyVariableDefaults(), ...variableDefaults(this.deps.variables, "run") },
      global: { ...variableDefaults(this.deps.variables, "global"), ...global.vars },
      playthroughCount: global.playthroughCount,
      lastEndingId: global.lastEndingId,
      experience: this.currentExperience(),
    });
  }

  /** chose./seen. 由决策日志实时派生，不落盘，因此回滚与读档天然一致。 */
  private currentExperience() {
    // Spec 35：chose.* 从节点内 choice 指令派生，需要节点内容。
    const nodeEntries = this.graph
      ? this.graph.nodes.map((node) => ({
          id: node.id,
          instructions: this.instructionsByNodeId.get(node.id) ?? [],
        }))
      : [];
    return storyExperienceVariables(this.graph, nodeEntries, this.decisions);
  }

  private refreshPersistentVariableView() {
    const global = this.deps.globalState?.();
    if (!global) return;
    const run = Object.fromEntries(Object.entries(this.state.vars).filter(([name]) => {
      if (isReadonlyVariableName(name)) return false;
      return (this.deps.variables?.variables[name]?.scope ?? "run") === "run";
    }));
    this.state = { ...this.state, vars: effectiveVariables({ run, global: global.vars, playthroughCount: global.playthroughCount, lastEndingId: global.lastEndingId, experience: this.currentExperience() }) };
    this.emit();
  }

  private trackInstructionSideEffects(instr: Instruction) {
    if (instr.t === "voice") this.pendingVoiceId = instr.id;
  }

  private applySnapshot(snapshot: RuntimeSnapshot): RuntimeRestoreResult {
    const warnings: RuntimeLoadWarning[] = [];
    if (!this.instructionsByNodeId.has(snapshot.currentNodeId)) {
      warnings.push({
        code: "node_not_found",
        message: `Saved node "${snapshot.currentNodeId}" no longer exists.`,
        nodeId: snapshot.currentNodeId,
      });
      return { warnings };
    }

    const normalized = this.normalizeSavedRunVariables(snapshot.vars);
    warnings.push(...normalized.warnings);
    this.restoreSavedNameInputOrigin(snapshot);
    const baseState = this.stateFromSnapshot(snapshot, normalized.vars);
    if (snapshot.currentStoryPoint) {
      const result = this.applyStoryPoint(snapshot.currentStoryPoint, baseState);
      warnings.push(...result.warnings);
      if (result.warnings.length === 0) return { warnings };
    } else {
      this.currentNodeId = snapshot.currentNodeId;
      this.playbackEnded = false;
      this.currentStoryPoint = null;
      this.ip = 0;
      this.state = baseState;
    }
    return { warnings };
  }

  private applyStoryPoint(point: StoryPointId, baseState: NovelState): RuntimeRestoreResult {
    const instructions = this.instructionsByNodeId.get(point.nodeId);
    if (!instructions) {
      this.currentNodeId = point.nodeId;
      this.currentStoryPoint = null;
      this.ip = 0;
      this.state = baseState;
      return {
        warnings: [{
          code: "node_not_found",
          message: `Story point node "${point.nodeId}" no longer exists.`,
          storyPoint: { ...point },
          nodeId: point.nodeId,
        }],
      };
    }

    const index = instructions.findIndex((instr, instructionIndex) => (
      getInstructionStoryPointId(instr, instructionIndex) === point.instructionId
    ));
    if (index < 0) {
      this.currentNodeId = point.nodeId;
      this.currentStoryPoint = null;
      this.ip = 0;
      this.state = baseState;
      return {
        warnings: [{
          code: "story_point_not_found",
          message: `Story point "${point.instructionId}" no longer exists in node "${point.nodeId}".`,
          storyPoint: { ...point },
          nodeId: point.nodeId,
        }],
      };
    }

    const instr = instructions[index];
    this.currentNodeId = point.nodeId;
    this.playbackEnded = false;
    this.currentStoryPoint = { ...point };
    this.lastStableStoryPoint = { ...point };
    this.currentStableKind = isStableInstruction(instr) ? instr.t : null;
    this.currentReadKey = instr.t === "say" || instr.t === "narrate"
      ? createReadTextKey({ ...point, text: instr.text })
      : null;
    this.ip = index + 1;
    // 落到节点中间（读档/回滚/调试起点）时，把 baseState 当作本节点的入口状态，
    // 后续 seekToInstruction 才有正确的重放起点。
    this.varsAtNodeEntry = { ...baseState.vars };
    const restoredBase = instr.t === "inputName"
      ? this.restoreNameInputOrigin(point, instr, baseState)
      : baseState;
    this.varsAtNodeEntry = { ...restoredBase.vars };
    if (instr.t === "inputName") {
      const key = `${point.nodeId}\u0000${point.instructionId}`;
      if (!this.nameInputOrigins.has(key)) {
        this.nameInputOrigins.set(key, restoredBase.vars[instr.key]);
      }
    }
    this.state = this.applyRuntimeInstruction(restoredBase, instr);
    if (instr.t === "say" || instr.t === "narrate") this.state = revealFully(this.state);
    if (instr.t === "wait") this.state = { ...this.state, flags: { ...this.state.flags, isWaiting: false } };
    this.state = this.withRestoredProgress(this.state, index + 1, instructions.length);
    return { warnings: [] };
  }

  private stateFromSnapshot(
    snapshot: RuntimeSnapshot,
    runVars: Record<string, string | number | boolean | null>,
  ): NovelState {
    const global = this.deps.globalState?.() ?? { vars: {}, playthroughCount: 0, lastEndingId: null };
    return {
      ...createInitialState(),
      vars: effectiveVariables({
        run: runVars,
        global: { ...variableDefaults(this.deps.variables, "global"), ...global.vars },
        playthroughCount: global.playthroughCount,
        lastEndingId: global.lastEndingId,
        experience: this.currentExperience(),
      }),
      background: snapshot.background,
      sprites: snapshot.sprites.map((sprite, index) => ({
        id: sprite.id,
        pos: sprite.pos,
        expr: sprite.expr,
        scale: sprite.scale,
        flip: sprite.flip,
        exprMs: 0,
        ms: 0,
        changeId: index + 1,
        justEntered: false,
        prevExpr: null,
        prevPos: null,
        trans: "cut",
        leaving: false,
      })),
      audio: {
        bgm: snapshot.bgm ? { id: snapshot.bgm.id, loop: snapshot.bgm.loop, fade: 0 } : null,
        sfx: [],
        voice: null,
      },
      flags: {
        ...createInitialState().flags,
        progress: { current: 0, total: this.instructionsByNodeId.get(snapshot.currentNodeId)?.length ?? 0 },
      },
    };
  }

  private legacyVariableDefaults(): Record<string, null> {
    const declarations = this.deps.variables?.variables ?? {};
    const names = new Set<string>();
    for (const instructions of this.instructionsByNodeId.values()) {
      for (const instruction of instructions) {
        if (instruction.t === "set" && !declarations[instruction.key] && !isReadonlyVariableName(instruction.key)) {
          names.add(instruction.key);
        }
      }
    }
    return Object.fromEntries([...names].map((name) => [name, null]));
  }

  private normalizeSavedRunVariables(
    saved: Record<string, string | number | boolean | null>,
  ): { vars: Record<string, string | number | boolean | null>; warnings: RuntimeLoadWarning[] } {
    const vars = { ...this.legacyVariableDefaults(), ...variableDefaults(this.deps.variables, "run") };
    const warnings: RuntimeLoadWarning[] = [];
    for (const [name, value] of Object.entries(saved)) {
      const declaration = this.deps.variables?.variables[name];
      if (!declaration) {
        vars[name] = value;
        continue;
      }
      if ((declaration.scope ?? "run") !== "run") continue;
      try {
        assertVariableValue(name, value, declaration);
        vars[name] = value;
      } catch {
        warnings.push({
          code: "variable_value_incompatible",
          message: `Saved value for variable "${name}" no longer matches its declaration; the default was restored.`,
          variableName: name,
        });
      }
    }
    return { vars, warnings };
  }

  private withRestoredAudio(state: NovelState): NovelState {
    return {
      ...state,
      effects: [],
      transitions: [],
      audio: { ...state.audio, sfx: [], voice: null },
    };
  }

  private withRestoredProgress(state: NovelState, current: number, total: number): NovelState {
    const restored = this.withRestoredAudio(state);
    return {
      ...restored,
      flags: {
        ...restored.flags,
        isWaiting: false,
        progress: { current, total },
      },
    };
  }

  private updateCurrentStoryPoint(instr: Instruction, index: number, emitCheckpoint = true) {
    const instructionId = getInstructionStoryPointId(instr, index);
    if (!instructionId || !this.currentNodeId) return;
    this.currentStoryPoint = { nodeId: this.currentNodeId, instructionId };
    this.lastStableStoryPoint = { ...this.currentStoryPoint };
    this.currentStableKind = instr.t as StableInstruction["t"];
    this.currentReadKey = instr.t === "say" || instr.t === "narrate"
      ? createReadTextKey({ ...this.currentStoryPoint, text: instr.text })
      : null;
    if (emitCheckpoint) this.emitStableCheckpoint();
  }

  private emitStableCheckpoint() {
    if (this.suppressStableCheckpoints) return;
    if (!this.currentStoryPoint || !this.currentNodeId) return;
    if (this.lastNodeCheckpointId !== this.currentNodeId) {
      this.lastNodeCheckpointId = this.currentNodeId;
      this.deps.onStableCheckpoint?.({ reason: "node", storyPoint: { ...this.currentStoryPoint } });
    }
    if (this.pendingChoiceCheckpoint) {
      this.pendingChoiceCheckpoint = false;
      this.deps.onStableCheckpoint?.({ reason: "choice", storyPoint: { ...this.currentStoryPoint } });
    }
  }

  private addBacklogEntry(instr: Extract<Instruction, { t: "say" | "narrate" }>, index: number) {
    if (!this.currentStoryPoint) this.updateCurrentStoryPoint(instr, index);
    if (!this.currentStoryPoint || !this.currentReadKey) return;
    const localized = this.localizedInstruction(instr);
    const formatted = formatRuntimeText(
      localized.text,
      this.state.vars,
      this.deps.variables,
      this.runtimeThemeColors(),
    );
    const createdOrder = ++this.backlogOrder;
    const entry: BacklogEntry = {
      id: `history:${createdOrder}`,
      storyPoint: { ...this.currentStoryPoint },
      speakerName: instr.t === "say" ? this.state.speaker?.name ?? instr.who : undefined,
      text: formatted.plainText,
      tokens: formatted.tokens,
      voiceId: instr.t === "say" ? instr.voice ?? this.pendingVoiceId : this.pendingVoiceId,
      readKey: { ...this.currentReadKey },
      createdOrder,
    };
    this.pendingVoiceId = undefined;
    this.backlog.push(entry);
  }

  private localizedInstruction(
    instruction: Extract<Instruction, { t: "say" | "narrate" }>,
  ): Extract<Instruction, { t: "say" | "narrate" }> {
    return localizeInstruction(instruction, {
      currentLocale: this.currentLocale,
      defaultLocale: this.deps.meta.locale?.default,
      tables: this.deps.locales,
    });
  }

  private runtimeThemeColors(): Readonly<Record<string, string | number>> | undefined {
    const skins = this.deps.manifest.uiSkins ?? {};
    return (skins.default ?? skins[Object.keys(skins)[0] ?? ""])?.tokens;
  }

  private reportRuntimeTextDiagnostics(
    instruction: Extract<Instruction, { t: "say" | "narrate" }>,
    instructionIndex: number,
    diagnostics: readonly { code: string; message: string; offset: number }[],
  ) {
    const instructionId = getInstructionStoryPointId(instruction, instructionIndex);
    if (!instructionId || !this.currentNodeId) return;
    const storyPoint = { nodeId: this.currentNodeId, instructionId };
    for (const diagnostic of diagnostics) {
      const id = `${storyPoint.nodeId}\u0000${storyPoint.instructionId}\u0000${diagnostic.code}\u0000${diagnostic.offset}`;
      if (this.reportedRuntimeTextDiagnostics.has(id)) continue;
      this.reportedRuntimeTextDiagnostics.add(id);
      this.deps.onRuntimeTextDiagnostic?.({
        storyPoint: { ...storyPoint },
        diagnostic: { ...diagnostic },
      });
    }
  }

  private currentNameInputOrigin(): RuntimeSnapshot["nameInputOrigin"] {
    const point = this.currentStoryPoint;
    if (!point) return undefined;
    const instructions = this.instructionsByNodeId.get(point.nodeId) ?? [];
    const instructionIndex = instructions.findIndex((candidate, index) => (
      candidate.t === "inputName"
      && getInstructionStoryPointId(candidate, index) === point.instructionId
    ));
    const instruction = instructions[instructionIndex];
    if (!instruction || instruction.t !== "inputName") return undefined;
    const id = `${point.nodeId}\u0000${point.instructionId}`;
    if (!this.nameInputOrigins.has(id)) return undefined;
    const value = this.nameInputOrigins.get(id);
    return {
      instructionId: point.instructionId,
      key: instruction.key,
      ...(value === undefined ? {} : { value }),
    };
  }

  private restoreSavedNameInputOrigin(snapshot: RuntimeSnapshot) {
    const origin = snapshot.nameInputOrigin;
    if (!origin || !snapshot.currentStoryPoint) return;
    if (origin.instructionId !== snapshot.currentStoryPoint.instructionId) return;
    const id = `${snapshot.currentNodeId}\u0000${origin.instructionId}`;
    this.nameInputOrigins.set(id, origin.value);
  }

  private storyPointKey(instructionId: string): string {
    return `${this.currentNodeId ?? ""}\u0000${instructionId}`;
  }

  private restoreNameInputOrigin(
    point: StoryPointId,
    instruction: Extract<Instruction, { t: "inputName" }>,
    state: NovelState,
  ): NovelState {
    const key = `${point.nodeId}\u0000${point.instructionId}`;
    if (!this.nameInputOrigins.has(key)) return state;
    const previous = this.nameInputOrigins.get(key);
    const vars = { ...state.vars };
    if (previous === undefined) delete vars[instruction.key];
    else vars[instruction.key] = previous;
    return { ...state, vars };
  }

  private markCurrentChapterReached() {
    if (this.suppressStableCheckpoints || !this.graph || !this.currentNodeId) return;
    const chapterId = this.graph.nodes.find((node) => node.id === this.currentNodeId)?.chapterId;
    if (!chapterId || this.reachedChapterIds.has(chapterId)) return;
    this.reachedChapterIds.add(chapterId);
    void this.deps.onChapterReached?.(chapterId);
  }

  private markCurrentReadIfRevealed() {
    if (this.suppressStableCheckpoints || !this.currentReadKey || !this.isCurrentTextDone()) return;
    const id = readKeyId(this.currentReadKey);
    if (this.markedReadKeys.has(id)) return;
    this.markedReadKeys.add(id);
    void this.deps.persistent?.markRead({ ...this.currentReadKey });
  }

  private isRead(key: ReadTextKey): boolean {
    return this.deps.persistent?.getReadStatus(key) ?? false;
  }

  private queueSkipTick() {
    if (this.skipTimer) return;
    this.skipTimer = setTimeout(() => this.runSkipTick(), 0);
  }

  private runSkipTick() {
    this.skipTimer = null;
    if ((this.skipMode as SkipMode) === "off") return;
    if (this.skipBudget-- <= 0 || this.shouldStopSkip()) {
      if (this.isStoppedAtUnreadText()) this.clearTyping();
      this.stopSkip();
      return;
    }

    const before = this.progressToken();
    if (this.state.flags.isWaiting) {
      this.clearWait();
      this.state = { ...this.state, flags: { ...this.state.flags, isWaiting: false } };
      this.emit();
      this.stepNext(0);
    } else if (!this.isCurrentTextDone()) {
      this.clearTyping();
      this.state = revealFully(this.state);
      this.markCurrentReadIfRevealed();
      this.emit();
      if (!this.shouldStopSkip()) {
        this.stepNext(0);
      }
    } else {
      this.stepNext(0);
    }

    if (this.getSkipMode() === "off") return;
    if (this.shouldStopSkip()) {
      if (this.isStoppedAtUnreadText()) this.clearTyping();
      this.stopSkip();
      return;
    }
    if (before === this.progressToken() && this.isCurrentTextDone() && !this.state.flags.isWaiting) {
      this.stopSkip();
      return;
    }
    this.queueSkipTick();
  }

  private shouldStopSkip(): boolean {
    if (this.routeError) return true;
    if (this.state.choice || this.state.nameInput) return true;
    if (this.currentStableKind === "pause") return true;
    if (this.skipMode === "read" && this.currentReadKey && !this.isRead(this.currentReadKey)) return true;
    return false;
  }

  private isStoppedAtUnreadText(): boolean {
    return this.skipMode === "read" && Boolean(this.currentReadKey && !this.isRead(this.currentReadKey));
  }

  private stopSkip(emit = true) {
    const changed = this.skipMode !== "off" || this.state.flags.skipMode !== "off";
    if (this.skipTimer) clearTimeout(this.skipTimer);
    this.skipTimer = null;
    this.skipMode = "off";
    this.skipBudget = 0;
    if (changed) {
      this.state = { ...this.state, flags: { ...this.state.flags, skipMode: "off" } };
      if (emit) this.emit();
    }
  }

  private progressToken(): string {
    return JSON.stringify({
      nodeId: this.currentNodeId,
      ip: this.ip,
      point: this.currentStoryPoint,
      waiting: this.state.flags.isWaiting,
      choice: Boolean(this.state.choice),
      textDone: this.isCurrentTextDone(),
    });
  }

  private clearTyping() {
    if (this.typingTimer) clearTimeout(this.typingTimer);
    this.typingTimer = null;
  }

  private clearWait() {
    if (this.waitTimer) clearTimeout(this.waitTimer);
    this.waitTimer = null;
  }

  private clearAuto() {
    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.autoTimer = null;
  }

  private clearTimers() {
    this.clearTyping();
    this.clearWait();
    this.clearAuto();
    this.stopSkip(false);
  }
}

function getInstructionStoryPointId(instr: Instruction, index: number): string | null {
  switch (instr.t) {
    case "say":
    case "narrate":
    case "wait":
    case "pause":
    case "inputName":
    case "completeEnding":
    case "choice": // Spec 35：choice 是玩家中断点，带 id 时作为 story-point。
      return instr.id ?? (index >= 0 ? `index:${index}` : null);
    default:
      return null;
  }
}

function cloneDecisionEvent(event: DecisionLogEvent): DecisionLogEvent {
  if (event.type === "checkpoint") return { type: "checkpoint", snapshot: RuntimeSnapshotSchema.parse(event.snapshot) };
  return { ...event };
}

function isStableInstruction(instr: Instruction): instr is StableInstruction {
  return instr.t === "say"
    || instr.t === "narrate"
    || instr.t === "wait"
    || instr.t === "pause"
    || instr.t === "inputName"
    || instr.t === "choice";
}

function readKeyId(key: ReadTextKey): string {
  return `${key.nodeId}\u0000${key.instructionId}\u0000${key.textHash}`;
}

function cloneBacklogEntry(entry: BacklogEntry): BacklogEntry {
  return {
    ...entry,
    storyPoint: { ...entry.storyPoint },
    readKey: entry.readKey ? { ...entry.readKey } : undefined,
  };
}

export type { Manifest, Meta };
