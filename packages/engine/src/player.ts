/**
 * Player —— 播放循环引擎（拥有所有副作用）。
 *
 * 它围绕 interpreter 的纯函数构建，负责：
 *   - 按 meta 的节奏逐条推进指令
 *   - 打字机定时器
 *   - wait 指令的真实计时
 *   - 自动播放 / 录制模式
 *   - 把 NovelState 暴露给 useNovel（通过订阅回调）
 *
 * 它不碰 DOM，但【可以】持有计时器与音频实例——这是 player 与 interpreter
 * 的本质区别：interpreter 必须无副作用，player 是副作用的归属地。
 */
import type { Meta, Instruction } from "./types";
import type { NovelState } from "./state";
import { createInitialState } from "./state";
import {
  applyInstruction,
  advanceTyping,
  revealFully,
  buildInitialState,
  type InterpreterDeps,
} from "./interpreter";

export interface PlayerDeps extends InterpreterDeps {
  meta: Meta;
}

type Listener = (state: NovelState) => void;

export class NovelPlayer {
  private deps: PlayerDeps;
  private chapters: Instruction[][] = [];
  private state: NovelState;
  private listeners = new Set<Listener>();

  private ip = 0; // 当前指令指针（全局，跨章节累计）
  private flat: Instruction[] = []; // 所有章节拍平后的指令流
  private typingTimer: ReturnType<typeof setTimeout> | null = null;
  private waitTimer: ReturnType<typeof setTimeout> | null = null;
  private autoTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: PlayerDeps) {
    this.deps = deps;
    this.state = createInitialState();
  }

  /** 载入章节，重置到开头 */
  load(chapters: Instruction[][]) {
    this.clearTimers();
    this.chapters = chapters;
    this.flat = chapters.flat();
    this.ip = 0;
    this.state = createInitialState();
    this.state.flags.progress.total = this.flat.length;
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

  // ── 模式切换 ──────────────────────────────────
  setAutoPlay(on: boolean) {
    this.state = { ...this.state, flags: { ...this.state.flags, isAutoPlay: on } };
    this.emit();
    if (on) this.kickAuto();
  }

  setRecording(on: boolean) {
    // 录制 = 自动播放 + 隐藏控制层 + 固定节奏（对 OBS 友好）
    this.state = { ...this.state, flags: { ...this.state.flags, isRecording: on } };
    this.emit();
    if (on) this.setAutoPlay(true);
  }

  // ── 玩家操作 ──────────────────────────────────
  /**
   * 主交互：点击 / 空格。
   * 语义：若当前文本还没打完 → 补全；否则 → 推进到下一条指令。
   */
  advance() {
    if (this.state.flags.isWaiting) return; // wait 期间忽略
    if (this.state.choice) return; // choice 由 onChoose/整图播放器处理，普通推进不跨分支
    if (!this.isCurrentTextDone()) {
      this.state = revealFully(this.state);
      this.emit();
      return;
    }
    this.stepNext();
  }

  /** 跳到开头 */
  restart() {
    this.load(this.chapters);
  }

  /**
   * 跳转到指定指令序号（0-based，全局累计）。
   * 实现：清空计时器，从头重放前 target 条指令重建状态，
   * 然后停在 target 处等下一次 advance。
   * interpreter 是纯函数，重放很便宜且无副作用。
   */
  seekTo(target: number) {
    this.clearTimers();
    const clamped = Math.max(0, Math.min(target, this.flat.length));
    let s = buildInitialState(0, this.flat.length);
    // 重放时对 say/narrate 立即打满（跳转后看到的是该指令的完整状态）
    let chapIdx = 0;
    let chapEnd = this.chapters[0]?.length ?? 0;
    for (let i = 0; i < clamped; i++) {
      while (i >= chapEnd && chapIdx + 1 < this.chapters.length) {
        chapIdx++;
        chapEnd += this.chapters[chapIdx].length;
      }
      s = applyInstruction(s, this.flat[i], this.deps);
    }
    s.flags.chapterIndex = chapIdx;
    // 若停在一条文本指令上，将其打满，方便预览
    if (clamped > 0) {
      const last = this.flat[clamped - 1];
      if (last.t === "say" || last.t === "narrate") s = revealFully(s);
    }
    s.flags.isWaiting = false;
    this.ip = clamped;
    this.state = s;
    this.state.flags.progress.current = clamped;
    this.emit();
  }

  /** 前进/后退 N 条指令（用于调试 UI 的 ±按钮） */
  seekBy(delta: number) {
    this.seekTo(this.ip + delta);
  }

  /**
   * 单步执行一条指令（调试用）。
   * 与 advance 不同：它只走一条，且不启动打字机/自动推进，
   * 文本指令会被立即打满，方便逐条检视。
   */
  stepOnce() {
    this.clearTimers();
    if (this.ip >= this.flat.length) return;
    const instr = this.flat[this.ip];
    this.ip += 1;
    this.state = applyInstruction(this.state, instr, this.deps);
    if (instr.t === "say" || instr.t === "narrate") this.state = revealFully(this.state);
    if (instr.t === "wait") this.state.flags.isWaiting = false; // 单步模式下 wait 不阻塞
    this.state.flags.progress.current = this.ip;
    this.emit();
  }

  /** 跳到上一个章节开头 */
  prevChapter() {
    this.seekTo(this.chapterStartIndex(this.state.flags.chapterIndex - 1));
  }
  /** 跳到下一个章节开头 */
  nextChapter() {
    this.seekTo(this.chapterStartIndex(this.state.flags.chapterIndex + 1));
  }

  /** 某个章节序号在拍平指令流里的起始 index（越界则钳到首/尾） */
  private chapterStartIndex(chapterIdx: number): number {
    if (chapterIdx < 0) return 0;
    let acc = 0;
    for (let c = 0; c < chapterIdx && c < this.chapters.length; c++) acc += this.chapters[c].length;
    return Math.min(acc, this.flat.length);
  }

  get totalInstructions(): number { return this.flat.length; }
  get currentIndex(): number { return this.ip; }

  // ── 核心：推进一条指令 ────────────────────────
  private stepNext() {
    this.clearTyping();
    this.clearAuto();

    // 推进一帧前清掉上一帧标记 leaving 的立绘（渲染层已播完退场动画）
    if (this.state.sprites.some((s) => s.leaving)) {
      this.state = { ...this.state, sprites: this.state.sprites.filter((s) => !s.leaving) };
    }

    while (this.ip < this.flat.length) {
      const instr = this.flat[this.ip];
      this.ip += 1;
      this.state = applyInstruction(this.state, instr, this.deps);
      this.state.flags.progress.current = this.ip;
      this.emit();

      // 根据指令类型决定这一帧是否到达玩家停点
      if (this.afterStep(instr)) return;
    }
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
      case "choice":
        this.clearAuto();
        return true;
      case "pause":
        this.clearAuto();
        return true;
      default:
        // 无文本、无等待的舞台指令属于当前剧情帧，继续消费直到停点。
        return false;
    }
  }

  private isCurrentTextDone(): boolean {
    const d = this.state.dialogue;
    const n = this.state.narration;
    if (d) return d.fullyRevealed;
    if (n) return n.fullyRevealed;
    return true; // 无文本时视为「已可推进」
  }

  // ── 打字机 ────────────────────────────────────
  // 标点处自动延长停顿（纯播放节奏，不写进数据，换组件/换模式都不影响语义）
  private static PUNCT_DELAY: Record<string, number> = {
    "，": 180, "。": 320, "！": 320, "？": 320, "…": 240,
    ",": 140, ".": 260, "!": 260, "?": 260, "——": 200,
    "、": 180, "；": 260, "：": 220,
  };

  private startTyping() {
    this.clearTyping();
    const baseInterval = Math.max(8, Math.round(1000 / this.deps.meta.typingSpeedCps));

    const tick = () => {
      // 打字前先看下「即将打出的那个字符」是否是标点，决定下次间隔
      const next = this.peekNextChar();
      const delay = next && next in NovelPlayer.PUNCT_DELAY
        ? NovelPlayer.PUNCT_DELAY[next]
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

  /** 当前文本里「下一个要打出的字符」（已打 typedLen 个，下一个是 index typedLen） */
  private peekNextChar(): string | null {
    const d = this.state.dialogue;
    const n = this.state.narration;
    const text = d?.text ?? n?.text ?? null;
    const len = d?.typedLen ?? n?.typedLen ?? 0;
    if (!text || len >= text.length) return null;
    // 省略号/破折号按整串匹配
    if (text.slice(len, len + 2) === "——") return "——";
    if (text.slice(len, len + 1) === "…" ) return "…";
    return text[len];
  }

  private startWait(ms: number) {
    this.clearWait();
    this.state = { ...this.state, flags: { ...this.state.flags, isWaiting: true } };
    this.emit();
    this.waitTimer = setTimeout(() => {
      this.state = { ...this.state, flags: { ...this.state.flags, isWaiting: false } };
      this.emit();
      this.stepNext();
    }, ms);
  }

  /** 文本打完 / wait 结束后，如果是自动/录制模式，延迟后推进 */
  private kickAuto() {
    if (!this.state.flags.isAutoPlay && !this.state.flags.isRecording) return;
    this.clearAuto();
    // 优先用本条指令的 ms 覆盖；否则用全局 autoAdvanceMs
    const cueMs = this.state.currentCueMs ?? this.deps.meta.autoAdvanceMs;
    // 录制模式额外加一点缓冲，保证 OBS 录屏观感稳定
    const delay = this.state.flags.isRecording ? cueMs + 400 : cueMs;
    this.autoTimer = setTimeout(() => this.stepNext(), delay);
  }

  // ── 计时器清理 ────────────────────────────────
  private clearTyping() {
    if (this.typingTimer) { clearTimeout(this.typingTimer); this.typingTimer = null; }
  }
  private clearWait() {
    if (this.waitTimer) { clearTimeout(this.waitTimer); this.waitTimer = null; }
  }
  private clearAuto() {
    if (this.autoTimer) { clearTimeout(this.autoTimer); this.autoTimer = null; }
  }
  private clearTimers() {
    this.clearTyping();
    this.clearWait();
    this.clearAuto();
  }

  dispose() {
    this.clearTimers();
    this.listeners.clear();
  }

  private emit() {
    for (const l of this.listeners) l(this.state);
  }

  get deps_(): PlayerDeps { return this.deps; } // 仅供测试用
}

export function createPlayer(deps: PlayerDeps): NovelPlayer {
  return new NovelPlayer(deps);
}
