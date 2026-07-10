/**
 * Backward-compatible linear player.
 *
 * GraphNovelPlayer is the single playback state machine. This adapter keeps the
 * former chapter-array API for external consumers and represents the flattened
 * instruction stream as one graph node.
 */
import type { Instruction, Meta, ProjectGraphData } from "./types";
import type { NovelState } from "./state";
import type { InterpreterDeps } from "./interpreter";
import { GraphNovelPlayer } from "./graphPlayer";
import type { RuntimeEffectHandler } from "./runtimeEffect";

export interface PlayerDeps extends InterpreterDeps {
  meta: Meta;
  onRuntimeEffect?: RuntimeEffectHandler;
}

type Listener = (state: NovelState) => void;

const LINEAR_NODE_ID = "__linear__";
const LINEAR_GRAPH: ProjectGraphData = {
  version: 1,
  entryNodeId: LINEAR_NODE_ID,
  nodes: [{
    id: LINEAR_NODE_ID,
    title: "Linear story",
    file: "nodes/__linear__.json",
    position: { x: 0, y: 0 },
  }],
  edges: [],
};

export class NovelPlayer {
  private readonly deps: PlayerDeps;
  private readonly graphPlayer: GraphNovelPlayer;
  private readonly listeners = new Set<Listener>();
  private readonly unsubscribeGraph: () => void;
  private chapters: Instruction[][] = [];
  private flat: Instruction[] = [];
  private chapterIndex = 0;

  constructor(deps: PlayerDeps) {
    this.deps = deps;
    this.graphPlayer = new GraphNovelPlayer(deps);
    this.unsubscribeGraph = this.graphPlayer.subscribe((state) => {
      state.flags.chapterIndex = this.chapterIndex;
      for (const listener of this.listeners) listener(state);
    });
  }

  /** Load chapters and reset the compatibility playhead to the beginning. */
  load(chapters: Instruction[][]) {
    this.chapters = chapters;
    this.flat = chapters.flat();
    this.chapterIndex = 0;
    this.graphPlayer.loadGraph(LINEAR_GRAPH, [{ id: LINEAR_NODE_ID, instructions: this.flat }]);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.getState());
    return () => this.listeners.delete(fn);
  }

  getState(): NovelState {
    const state = this.graphPlayer.getState();
    state.flags.chapterIndex = this.chapterIndex;
    return state;
  }

  setAutoPlay(on: boolean) {
    this.graphPlayer.setAutoPlay(on);
  }

  setRecording(on: boolean) {
    this.graphPlayer.setRecording(on);
  }

  advance() {
    this.graphPlayer.advance();
  }

  restart() {
    this.load(this.chapters);
  }

  seekTo(target: number) {
    const clamped = Math.max(0, Math.min(target, this.flat.length));
    this.chapterIndex = this.chapterIndexAt(clamped);
    this.graphPlayer.seekToInstruction(clamped);
  }

  seekBy(delta: number) {
    this.seekTo(this.currentIndex + delta);
  }

  stepOnce() {
    this.graphPlayer.stepOnce();
  }

  prevChapter() {
    this.seekTo(this.chapterStartIndex(this.chapterIndex - 1));
  }

  nextChapter() {
    this.seekTo(this.chapterStartIndex(this.chapterIndex + 1));
  }

  get totalInstructions(): number { return this.flat.length; }
  get currentIndex(): number { return this.graphPlayer.currentIndex; }

  dispose() {
    this.unsubscribeGraph();
    this.graphPlayer.dispose();
    this.listeners.clear();
  }

  private chapterStartIndex(chapterIndex: number): number {
    if (chapterIndex < 0) return 0;
    let start = 0;
    for (let index = 0; index < chapterIndex && index < this.chapters.length; index += 1) {
      start += this.chapters[index].length;
    }
    return Math.min(start, this.flat.length);
  }

  private chapterIndexAt(instructionIndex: number): number {
    if (this.chapters.length === 0) return 0;
    let current = 0;
    let start = 0;
    for (let index = 1; index < this.chapters.length; index += 1) {
      start += this.chapters[index - 1].length;
      if (start > instructionIndex) break;
      current = index;
    }
    return current;
  }

  /** Retained for the existing preview adapter. */
  get deps_(): PlayerDeps { return this.deps; }
}

export function createPlayer(deps: PlayerDeps): NovelPlayer {
  return new NovelPlayer(deps);
}
