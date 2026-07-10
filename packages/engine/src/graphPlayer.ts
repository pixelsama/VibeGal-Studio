import type { Meta, Manifest, Instruction, ProjectGraphData, GraphEdgeData } from "./types";
import type { NovelState } from "./state";
import { createInitialState } from "./state";
import { applyInstruction, advanceTyping, revealFully, buildInitialState, type InterpreterDeps } from "./interpreter";
import { decideGraphRoute } from "./graphRouting";
import { runtimeEffectFromInstruction, type RuntimeEffectHandler } from "./runtimeEffect";
import {
  RuntimeSnapshotSchema,
  createReadTextKey,
  createRuntimeSnapshot,
  migrateSaveSlotRecord,
  replayDecisionLogToNodeId,
  type DecisionLogEvent,
  type ReadTextKey,
  type RuntimeLoadWarning,
  type RuntimeRestoreResult,
  type RuntimeSnapshot,
  type SaveSlotRecord,
  type StoryPointId,
} from "./runtimeContract";
import type { BacklogEntry, SkipMode } from "./renderer";

export interface GraphPlayerPersistentBridge {
  getReadStatus(key: ReadTextKey): boolean;
  markRead(key: ReadTextKey): void | Promise<void>;
}

export interface GraphPlayerDeps extends InterpreterDeps {
  meta: Meta;
  persistent?: GraphPlayerPersistentBridge;
  replayVoice?: (voiceId: string) => void;
  onRuntimeEffect?: RuntimeEffectHandler;
}

export interface GraphPlayerNode {
  id: string;
  instructions: Instruction[];
}

type Listener = (state: NovelState) => void;
type StableInstruction = Extract<Instruction, { t: "say" | "narrate" | "wait" | "pause" }>;

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
  private ip = 0;
  private state: NovelState;
  private listeners = new Set<Listener>();
  private backlog: BacklogEntry[] = [];
  private backlogOrder = 0;
  private pendingVoiceId: string | undefined;
  private markedReadKeys = new Set<string>();
  private skipMode: SkipMode = "off";
  private skipTimer: ReturnType<typeof setTimeout> | null = null;
  private skipBudget = 0;
  private routeError: string | null = null;

  private typingTimer: ReturnType<typeof setTimeout> | null = null;
  private waitTimer: ReturnType<typeof setTimeout> | null = null;
  private autoTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: GraphPlayerDeps) {
    this.deps = deps;
    this.state = createInitialState();
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
    this.backlog = [];
    this.backlogOrder = 0;
    this.pendingVoiceId = undefined;
    this.markedReadKeys.clear();
    this.skipMode = "off";
    this.skipBudget = 0;
    this.routeError = null;
    this.ip = 0;
    const total = this.currentInstructions().length;
    this.state = buildInitialState(0, total);
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

  getDecisionLog(): DecisionLogEvent[] {
    return this.decisions.map(cloneDecisionEvent);
  }

  createSnapshot(): RuntimeSnapshot {
    return createRuntimeSnapshot(this.state, {
      currentNodeId: this.currentNodeId ?? "entry",
      currentStoryPoint: this.getCurrentStoryPoint(),
    });
  }

  restoreSnapshot(snapshot: RuntimeSnapshot): RuntimeRestoreResult {
    this.clearTimers();
    const parsed = RuntimeSnapshotSchema.parse(snapshot);
    const result = this.applySnapshot(parsed);
    this.emit();
    return result;
  }

  restoreFromSave(record: SaveSlotRecord): RuntimeRestoreResult {
    const slot = migrateSaveSlotRecord(record);
    this.decisions = slot.decisions.map(cloneDecisionEvent);
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
    const result = this.applyStoryPoint(point, createInitialState());
    this.emit();
    return result;
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
    this.skipMode = mode;
    this.skipBudget = 10_000;
    this.queueSkipTick();
  }

  setAutoPlay(on: boolean) {
    this.state = { ...this.state, flags: { ...this.state.flags, isAutoPlay: on } };
    this.emit();
    if (on) this.kickAuto();
  }

  setRecording(on: boolean) {
    this.state = { ...this.state, flags: { ...this.state.flags, isRecording: on } };
    this.emit();
    if (on) this.setAutoPlay(true);
  }

  advance() {
    if (this.state.flags.isWaiting) return;
    if (this.state.choice) return;
    if (!this.isCurrentTextDone()) {
      this.clearTyping();
      this.state = revealFully(this.state);
      this.markCurrentReadIfRevealed();
      this.emit();
      return;
    }
    this.stepNext(0);
  }

  choose(toNodeId: string) {
    if (!this.state.choice?.choices.some((choice) => choice.to === toNodeId)) return;
    this.clearAuto();
    const fromNodeId = this.currentNodeId;
    const edge = fromNodeId
      ? this.graph?.edges.find((candidate) => candidate.from === fromNodeId && candidate.to === toNodeId && candidate.mode === "choice")
      : null;
    if (fromNodeId && edge) {
      this.decisions.push({ type: "choice", fromNodeId, toNodeId, edgeId: edge.id });
    }
    this.jumpToNode(toNodeId);
    this.stepNext(0);
  }

  restart() {
    if (!this.graph) return;
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
    let lastStable: { instruction: StableInstruction; index: number } | null = null;

    for (let index = 0; index < clamped; index += 1) {
      const instruction = instructions[index];
      nextState = applyInstruction(nextState, instruction, this.deps);
      if (isStableInstruction(instruction)) lastStable = { instruction, index };
    }

    if (clamped > 0) {
      const last = instructions[clamped - 1];
      if (last.t === "say" || last.t === "narrate") nextState = revealFully(nextState);
    }
    nextState.flags.isWaiting = false;
    nextState.flags.progress.current = clamped;

    this.ip = clamped;
    this.state = nextState;
    this.currentStoryPoint = null;
    this.lastStableStoryPoint = null;
    this.currentReadKey = null;
    this.currentStableKind = null;
    this.pendingVoiceId = undefined;
    this.routeError = null;

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
    this.state = applyInstruction(this.state, instr, this.deps);
    this.trackInstructionSideEffects(instr);
    this.emitRuntimeEffect(instr);
    this.updateCurrentStoryPoint(instr, index);
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
    if (!this.currentNodeId) return [];
    return this.instructionsByNodeId.get(this.currentNodeId) ?? [];
  }

  private jumpToNode(nodeId: string) {
    this.currentNodeId = nodeId;
    this.currentStoryPoint = null;
    this.currentReadKey = null;
    this.currentStableKind = null;
    this.ip = 0;
    this.state = {
      ...this.state,
      speaker: null,
      dialogue: null,
      narration: null,
      choice: null,
      flags: {
        ...this.state.flags,
        chapterIndex: 0,
        progress: { current: 0, total: this.currentInstructions().length },
      },
    };
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
    this.ip = 0;
    this.state = buildInitialState(0, this.currentInstructions().length);
    this.emit();
  }

  private stepNext(routeDepth: number) {
    this.clearTyping();
    this.clearAuto();

    if (this.state.sprites.some((sprite) => sprite.leaving)) {
      this.state = { ...this.state, sprites: this.state.sprites.filter((sprite) => !sprite.leaving) };
    }

    const instructions = this.currentInstructions();
    while (this.ip < instructions.length) {
      const index = this.ip;
      const instr = instructions[index];
      this.ip += 1;
      this.state = applyInstruction(this.state, instr, this.deps);
      this.trackInstructionSideEffects(instr);
      this.emitRuntimeEffect(instr);
      this.state.flags.progress.current = this.ip;
      this.emit();

      if (this.afterStep(instr, index)) return;
    }

    this.resolveRoute(routeDepth);
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
        return;
      case "error":
        console.warn(`[graph-player] ${decision.message}`);
        this.routeError = decision.message;
        this.clearAuto();
        this.stopSkip();
        return;
      case "choice":
        this.state = {
          ...this.state,
          speaker: null,
          dialogue: null,
          narration: null,
          choice: { choices: decision.choices },
          currentCueMs: null,
        };
        this.clearAuto();
        this.stopSkip();
        this.emit();
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
    if (edge.mode === "auto") {
      this.decisions.push({ type: "auto", fromNodeId: edge.from, toNodeId: edge.to, edgeId: edge.id });
    }
    this.jumpToNode(edge.to);
    this.stepNext(routeDepth + 1);
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
    const baseInterval = Math.max(8, Math.round(1000 / this.deps.meta.typingSpeedCps));

    const tick = () => {
      const next = this.peekNextChar();
      const delay = next && next in GraphNovelPlayer.PUNCT_DELAY
        ? GraphNovelPlayer.PUNCT_DELAY[next]
        : baseInterval;

      this.state = advanceTyping(this.state);
      this.markCurrentReadIfRevealed();
      this.emit();

      if (this.isCurrentTextDone()) {
        this.clearTyping();
        this.kickAuto();
        return;
      }
      this.typingTimer = setTimeout(tick, delay);
    };
    this.typingTimer = setTimeout(tick, baseInterval);
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
    if (this.state.flags.isWaiting || this.state.choice) return;
    const cueMs = this.state.currentCueMs ?? this.deps.meta.autoAdvanceMs;
    const delay = this.state.flags.isRecording ? cueMs + 400 : cueMs;
    this.autoTimer = setTimeout(() => this.advance(), delay);
  }

  private emit() {
    for (const listener of this.listeners) listener(this.state);
  }

  private emitRuntimeEffect(instr: Instruction) {
    const effect = runtimeEffectFromInstruction(instr);
    if (!effect) return;
    void this.deps.onRuntimeEffect?.(effect);
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

    const baseState = this.stateFromSnapshot(snapshot);
    if (snapshot.currentStoryPoint) {
      const result = this.applyStoryPoint(snapshot.currentStoryPoint, baseState);
      warnings.push(...result.warnings);
      if (result.warnings.length === 0) return { warnings };
    } else {
      this.currentNodeId = snapshot.currentNodeId;
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

    const index = instructions.findIndex((instr) => getInstructionStoryPointId(instr, -1) === point.instructionId);
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
    this.currentStoryPoint = { ...point };
    this.lastStableStoryPoint = { ...point };
    this.currentStableKind = isStableInstruction(instr) ? instr.t : null;
    this.currentReadKey = instr.t === "say" || instr.t === "narrate"
      ? createReadTextKey({ ...point, text: instr.text })
      : null;
    this.ip = index + 1;
    this.state = applyInstruction(baseState, instr, this.deps);
    if (instr.t === "say" || instr.t === "narrate") this.state = revealFully(this.state);
    if (instr.t === "wait") this.state = { ...this.state, flags: { ...this.state.flags, isWaiting: false } };
    this.state = this.withRestoredProgress(this.state, index + 1, instructions.length);
    return { warnings: [] };
  }

  private stateFromSnapshot(snapshot: RuntimeSnapshot): NovelState {
    return {
      ...createInitialState(),
      vars: { ...snapshot.vars },
      background: snapshot.background,
      sprites: snapshot.sprites.map((sprite, index) => ({
        id: sprite.id,
        pos: sprite.pos,
        expr: sprite.expr,
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

  private withRestoredProgress(state: NovelState, current: number, total: number): NovelState {
    return {
      ...state,
      effects: [],
      transitions: [],
      audio: { ...state.audio, sfx: [], voice: null },
      flags: {
        ...state.flags,
        isWaiting: false,
        progress: { current, total },
      },
    };
  }

  private updateCurrentStoryPoint(instr: Instruction, index: number) {
    const instructionId = getInstructionStoryPointId(instr, index);
    if (!instructionId || !this.currentNodeId) return;
    this.currentStoryPoint = { nodeId: this.currentNodeId, instructionId };
    this.lastStableStoryPoint = { ...this.currentStoryPoint };
    this.currentStableKind = instr.t as StableInstruction["t"];
    this.currentReadKey = instr.t === "say" || instr.t === "narrate"
      ? createReadTextKey({ ...this.currentStoryPoint, text: instr.text })
      : null;
  }

  private addBacklogEntry(instr: Extract<Instruction, { t: "say" | "narrate" }>, index: number) {
    if (!this.currentStoryPoint) this.updateCurrentStoryPoint(instr, index);
    if (!this.currentStoryPoint || !this.currentReadKey) return;
    const createdOrder = ++this.backlogOrder;
    const entry: BacklogEntry = {
      id: `history:${createdOrder}`,
      storyPoint: { ...this.currentStoryPoint },
      speakerName: instr.t === "say" ? this.state.speaker?.name ?? instr.who : undefined,
      text: instr.text,
      voiceId: this.pendingVoiceId,
      readKey: { ...this.currentReadKey },
      createdOrder,
    };
    this.pendingVoiceId = undefined;
    this.backlog.push(entry);
  }

  private markCurrentReadIfRevealed() {
    if (!this.currentReadKey || !this.isCurrentTextDone()) return;
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
    if (this.state.choice) return true;
    if (this.currentStableKind === "pause") return true;
    if (this.skipMode === "read" && this.currentReadKey && !this.isRead(this.currentReadKey)) return true;
    return false;
  }

  private isStoppedAtUnreadText(): boolean {
    return this.skipMode === "read" && Boolean(this.currentReadKey && !this.isRead(this.currentReadKey));
  }

  private stopSkip() {
    if (this.skipTimer) clearTimeout(this.skipTimer);
    this.skipTimer = null;
    this.skipMode = "off";
    this.skipBudget = 0;
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
    this.stopSkip();
  }
}

function getInstructionStoryPointId(instr: Instruction, index: number): string | null {
  switch (instr.t) {
    case "say":
    case "narrate":
    case "wait":
    case "pause":
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
  return instr.t === "say" || instr.t === "narrate" || instr.t === "wait" || instr.t === "pause";
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
