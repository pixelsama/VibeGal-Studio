/**
 * Interpreter —— 纯函数状态机。
 *
 * 硬契约：
 *   - 绝不碰 DOM、计时器、音频实例。这些副作用属于 player.ts。
 *   - 同输入必同输出，可被单元测试与未来小工具直接调用。
 *
 * 它只做一件事：把一条指令应用到 NovelState 上，返回新 state。
 * 「播放节奏」「打字机推进」「等待」这类时序逻辑不在 interpreter 里，
 * interpreter 只决定「应用这条指令后，视图状态应该变成什么样」。
 */
import type { Instruction, Manifest } from "./types";
// Manifest 仅作为 InterpreterDeps 的类型来源使用
import type { NovelState, ActiveSprite, Speaker, PendingEffect, PendingTransition } from "./state";
import { createInitialState } from "./state";

/** 自增序号，给特效/转场/音效一个唯一 id，组件用它判断「是不是新的，要不要播」。 */
let seqCounter = 0;
const nextSeq = () => ++seqCounter;

export interface InterpreterDeps {
  manifest: Manifest;
}

/**
 * 应用一条指令，返回【新的】NovelState（不可变更新）。
 * @param state 当前状态
 * @param instr 待应用指令
 * @param deps  依赖（manifest，用于查角色名/色）
 * @returns 新状态
 */
export function applyInstruction(
  state: NovelState,
  instr: Instruction,
  deps: InterpreterDeps,
): NovelState {
  if (state.choice) {
    state = { ...state, choice: null };
  }

  switch (instr.t) {
    // ── 视觉：背景 ──────────────────────────────
    case "bg":
      return {
        ...state,
        background: instr.id,
        backgroundTrans: instr.trans,
        backgroundMs: instr.ms,
      };

    // ── 视觉：立绘 ──────────────────────────────
    case "char": {
      // 退场：标记 leaving，渲染层播退场动画；player 在下次推进前真正移除
      if (instr.remove) {
        return {
          ...state,
          sprites: state.sprites.map((s) =>
            s.id === instr.id && !s.leaving
              ? { ...s, leaving: true, changeId: nextSeq(), justEntered: false }
              : s,
          ),
        };
      }

      const existing = state.sprites.find((s) => s.id === instr.id && !s.leaving);
      if (existing) {
        // 已在场 → 这是「换表情/移位」语义，不是登场
        const changed = existing.expr !== instr.expr || existing.pos !== instr.pos;
        if (!changed) return state;
        const updated: ActiveSprite = {
          ...existing,
          prevExpr: existing.expr,
          prevPos: existing.pos,
          expr: instr.expr,
          pos: instr.pos,
          trans: instr.trans,
          changeId: nextSeq(),
          justEntered: false,
        };
        return {
          ...state,
          sprites: state.sprites.map((s) => (s.id === existing.id && !s.leaving ? updated : s)),
        };
      }

      // 新登场
      const sprite: ActiveSprite = {
        id: instr.id,
        pos: instr.pos,
        expr: instr.expr,
        changeId: nextSeq(),
        justEntered: true,
        prevExpr: null,
        prevPos: null,
        trans: instr.trans,
        leaving: false,
      };
      // clear=true：其余立绘标记 leaving 保留一帧（让它们播退场而非瞬间消失）
      if (instr.clear) {
        const othersLeaving = state.sprites
          .filter((s) => s.id !== instr.id)
          .map((s) => ({ ...s, leaving: true, changeId: nextSeq() }));
        return { ...state, sprites: [...othersLeaving, sprite] };
      }
      // 普通：保留其余（含仍在 leaving 的）+ 新 sprite
      return { ...state, sprites: [...state.sprites, sprite] };
    }

    // ── 文本：对话 ──────────────────────────────
    case "say": {
      const char = deps.manifest.characters[instr.who];
      const speaker: Speaker | null = char
        ? { id: instr.who, name: char.name, color: char.color, expr: instr.expr }
        : { id: instr.who, name: instr.who, color: "#ffffff", expr: instr.expr };
      return {
        ...state,
        speaker,
        // say 时若有旁白则清掉，二者不并显
        narration: null,
        choice: null,
        dialogue: { text: instr.text, typedLen: 0, fullyRevealed: false },
        currentCueMs: instr.ms ?? null, // null = 跟随全局 autoAdvanceMs
      };
    }

    // ── 文本：旁白 ──────────────────────────────
    case "narrate":
      return {
        ...state,
        speaker: null,
        dialogue: null,
        choice: null,
        narration: { text: instr.text, typedLen: 0, fullyRevealed: false },
        currentCueMs: instr.ms ?? null,
      };

    // ── 变量：线性写入，供 graph 自动出口条件读取 ───────────
    case "set":
      return {
        ...state,
        vars: { ...state.vars, [instr.key]: instr.value },
      };

    // ── 音频线索（不在这里播放，只改状态；播放由 player/组件负责） ──
    case "bgm":
      return { ...state, audio: { ...state.audio, bgm: { id: instr.id, fade: instr.fade, loop: instr.loop } } };

    case "sfx": {
      const seq = nextSeq();
      return {
        ...state,
        audio: { ...state.audio, sfx: [...state.audio.sfx, { id: instr.id, seq }] },
      };
    }

    case "voice":
      return { ...state, audio: { ...state.audio, voice: { id: instr.id, seq: nextSeq() } } };

    // ── 特效 / 转场（推入待播放列表，组件消费后 useNovel 会清空） ──
    case "effect": {
      const e: PendingEffect = {
        id: nextSeq(),
        type: instr.type,
        intensity: instr.intensity,
        ms: instr.ms,
      };
      return { ...state, effects: [...state.effects, e] };
    }

    case "transition": {
      const tr: PendingTransition = { id: nextSeq(), type: instr.type, ms: instr.ms };
      return { ...state, transitions: [...state.transitions, tr] };
    }

    // ── wait：只置标记，实际计时由 player 负责 ──
    case "wait":
      return { ...state, flags: { ...state.flags, isWaiting: true } };

    // ── pause：纯画面停点，等待玩家下一次推进 ───────────────
    case "pause":
      return {
        ...state,
        speaker: null,
        dialogue: null,
        narration: null,
        choice: null,
        currentCueMs: null,
      };

    case "unlock":
      return state;

    default: {
      // 穷尽性检查：如果新增指令类型忘了处理，编译期就会报错
      const _exhaustive: never = instr;
      void _exhaustive;
      return state;
    }
  }
}

/**
 * 构建初始状态（用于测试/小工具预览整段效果时不依赖播放器）。
 * 正常播放不走这里——player 会逐条 apply 以驱动打字机/等待。
 */
export function buildInitialState(chapterIndex = 0, totalInstructions = 0): NovelState {
  const s = createInitialState();
  s.flags.chapterIndex = chapterIndex;
  s.flags.progress.total = totalInstructions;
  return s;
}

/**
 * 把 speaker/narration/dialogue 的打字机推进一格。
 * 纯函数：player 定时器调用它来更新 typedLen。
 */
export function advanceTyping(state: NovelState): NovelState {
  if (state.dialogue && !state.dialogue.fullyRevealed) {
    const typedLen = Math.min(state.dialogue.typedLen + 1, state.dialogue.text.length);
    return {
      ...state,
      dialogue: { ...state.dialogue, typedLen, fullyRevealed: typedLen >= state.dialogue.text.length },
    };
  }
  if (state.narration && !state.narration.fullyRevealed) {
    const typedLen = Math.min(state.narration.typedLen + 1, state.narration.text.length);
    return {
      ...state,
      narration: { ...state.narration, typedLen, fullyRevealed: typedLen >= state.narration.text.length },
    };
  }
  return state;
}

/** 立即显示完整文本（玩家点击跳过打字） */
export function revealFully(state: NovelState): NovelState {
  if (state.dialogue && !state.dialogue.fullyRevealed) {
    return { ...state, dialogue: { ...state.dialogue, typedLen: state.dialogue.text.length, fullyRevealed: true } };
  }
  if (state.narration && !state.narration.fullyRevealed) {
    return { ...state, narration: { ...state.narration, typedLen: state.narration.text.length, fullyRevealed: true } };
  }
  return state;
}

/** 组件已消费完特效/转场/音效后，由 useNovel 调用以清空，避免重复触发 */
export function clearConsumedEffects(state: NovelState): NovelState {
  if (state.effects.length === 0 && state.transitions.length === 0) return state;
  return { ...state, effects: [], transitions: [] };
}
