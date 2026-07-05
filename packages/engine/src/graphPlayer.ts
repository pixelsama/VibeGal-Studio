import type { Meta, Manifest, Instruction, ProjectGraphData, GraphEdgeData } from "./types";
import type { NovelState } from "./state";
import { createInitialState } from "./state";
import { applyInstruction, advanceTyping, revealFully, buildInitialState, type InterpreterDeps } from "./interpreter";
import { decideGraphRoute } from "./graphRouting";

export interface GraphPlayerDeps extends InterpreterDeps {
  meta: Meta;
}

export interface GraphPlayerNode {
  id: string;
  instructions: Instruction[];
}

type Listener = (state: NovelState) => void;

export class GraphNovelPlayer {
  private deps: GraphPlayerDeps;
  private graph: ProjectGraphData | null = null;
  private instructionsByNodeId = new Map<string, Instruction[]>();
  private currentNodeId: string | null = null;
  private ip = 0;
  private state: NovelState;
  private listeners = new Set<Listener>();

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
      this.state = revealFully(this.state);
      this.emit();
      return;
    }
    this.stepNext(0);
  }

  choose(toNodeId: string) {
    if (!this.state.choice?.choices.some((choice) => choice.to === toNodeId)) return;
    this.clearAuto();
    this.jumpToNode(toNodeId);
    this.stepNext(0);
  }

  restart() {
    if (!this.graph) return;
    this.loadGraph(this.graph, Array.from(this.instructionsByNodeId, ([id, instructions]) => ({ id, instructions })));
  }

  seekBy(delta: number) {
    if (delta > 0) this.stepOnce();
  }

  stepOnce() {
    this.clearTimers();
    if (this.ip >= this.currentInstructions().length) {
      this.resolveRoute(0);
      return;
    }
    const instr = this.currentInstructions()[this.ip];
    this.ip += 1;
    this.state = applyInstruction(this.state, instr, this.deps);
    if (instr.t === "say" || instr.t === "narrate") this.state = revealFully(this.state);
    if (instr.t === "wait") this.state.flags.isWaiting = false;
    this.state.flags.progress.current = this.ip;
    this.emit();
  }

  prevChapter() {}
  nextChapter() {}

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

  private stepNext(routeDepth: number) {
    this.clearTyping();
    this.clearAuto();

    if (this.state.sprites.some((sprite) => sprite.leaving)) {
      this.state = { ...this.state, sprites: this.state.sprites.filter((sprite) => !sprite.leaving) };
    }

    const instructions = this.currentInstructions();
    while (this.ip < instructions.length) {
      const instr = instructions[this.ip];
      this.ip += 1;
      this.state = applyInstruction(this.state, instr, this.deps);
      this.state.flags.progress.current = this.ip;
      this.emit();

      if (this.afterStep(instr)) return;
    }

    this.resolveRoute(routeDepth);
  }

  private resolveRoute(routeDepth: number) {
    if (!this.graph || !this.currentNodeId) return;
    if (routeDepth > Math.max(8, this.graph.nodes.length * 4)) {
      console.warn("[graph-player] 路由超过循环保护上限，已停止。");
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
        this.clearAuto();
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
      this.clearAuto();
      return;
    }
    this.jumpToNode(edge.to);
    this.stepNext(routeDepth + 1);
  }

  private afterStep(instr: Instruction): boolean {
    switch (instr.t) {
      case "say":
      case "narrate":
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
    const delay = this.state.currentCueMs ?? this.deps.meta.autoAdvanceMs;
    this.autoTimer = setTimeout(() => this.advance(), delay);
  }

  private emit() {
    for (const listener of this.listeners) listener(this.state);
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
  }
}

export type { Manifest, Meta };
