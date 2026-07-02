import { describe, it, expect } from "vitest";
import {
  applyInstruction,
  advanceTyping,
  revealFully,
  buildInitialState,
} from "../interpreter";
import type { Manifest } from "../types";

const manifest: Manifest = {
  characters: {
    protagonist: {
      name: "野生舰娘",
      color: "#9fc8e3",
      sprites: { default: "a.svg", hurt: "b.svg" },
    },
    other: {
      name: "其他",
      color: "#ffffff",
      sprites: { default: "c.svg" },
    },
  },
  backgrounds: { ocean: "o.svg", night: "n.svg" },
  audio: { bgm1: "bgm1.mp3", sfx1: "sfx.mp3" },
};

const deps = { manifest };

describe("applyInstruction: say", () => {
  it("设置说话人、对话文本，且打字机从 0 开始", () => {
    const state = applyInstruction(buildInitialState(), { t: "say", who: "protagonist", expr: "default", text: "你好" }, deps);
    expect(state.speaker).not.toBeNull();
    expect(state.speaker?.name).toBe("野生舰娘");
    expect(state.speaker?.color).toBe("#9fc8e3");
    expect(state.dialogue).toEqual({ text: "你好", typedLen: 0, fullyRevealed: false });
    // say 时旁白应被清空
    expect(state.narration).toBeNull();
  });

  it("未知角色 id 也能照常推进（用 id 兜底当名字）", () => {
    const state = applyInstruction(buildInitialState(), { t: "say", who: "ghost", expr: "default", text: "…" }, deps);
    expect(state.speaker?.name).toBe("ghost");
    expect(state.speaker?.color).toBe("#ffffff");
  });
});

// char 指令测试 fixture（补全 remove 字段）
const charCmd = (over: Partial<{ id: string; pos: string; expr: string; trans: "fade" | "cut" | "slide"; ms: number; clear: boolean; remove: boolean }> = {}) => ({
  t: "char" as const,
  id: "protagonist",
  pos: "center",
  expr: "default",
  trans: "fade" as const,
  ms: 600,
  clear: false,
  remove: false,
  ...over,
});

describe("applyInstruction: char", () => {
  it("立绘登场：加入 sprites，且 justEntered=true", () => {
    const state = applyInstruction(buildInitialState(), charCmd(), deps);
    expect(state.sprites).toHaveLength(1);
    expect(state.sprites[0].id).toBe("protagonist");
    expect(state.sprites[0].justEntered).toBe(true);
    expect(state.sprites[0].prevExpr).toBeNull();
  });

  it("同一角色再发 char：识别为换表情，justEntered=false，prevExpr 记录", () => {
    let state = applyInstruction(buildInitialState(), charCmd({ pos: "left", expr: "default" }), deps);
    state = applyInstruction(state, charCmd({ pos: "right", expr: "hurt" }), deps);
    expect(state.sprites).toHaveLength(1);
    expect(state.sprites[0].justEntered).toBe(false);
    expect(state.sprites[0].expr).toBe("hurt");
    expect(state.sprites[0].prevExpr).toBe("default");
    expect(state.sprites[0].pos).toBe("right");
    expect(state.sprites[0].prevPos).toBe("left");
  });

  it("多个不同角色可同台", () => {
    let state = applyInstruction(buildInitialState(), charCmd({ id: "protagonist", pos: "left" }), deps);
    state = applyInstruction(state, charCmd({ id: "other", pos: "right" }), deps);
    expect(state.sprites.map((s) => s.id).sort()).toEqual(["other", "protagonist"]);
  });

  it("clear=true：其他立绘标记 leaving，新 sprite justEntered", () => {
    let state = applyInstruction(buildInitialState(), charCmd({ id: "protagonist", pos: "left" }), deps);
    state = applyInstruction(state, charCmd({ id: "other", pos: "center", clear: true }), deps);
    // 一条 leaving(protagonist) + 一条新登场(other)
    expect(state.sprites).toHaveLength(2);
    const prot = state.sprites.find((s) => s.id === "protagonist");
    const other = state.sprites.find((s) => s.id === "other");
    expect(prot?.leaving).toBe(true);
    expect(other?.leaving).toBe(false);
    expect(other?.justEntered).toBe(true);
  });

  it("remove=true：标记 leaving，渲染层据此播退场动画", () => {
    let state = applyInstruction(buildInitialState(), charCmd(), deps);
    expect(state.sprites[0].leaving).toBe(false);
    state = applyInstruction(state, charCmd({ remove: true }), deps);
    expect(state.sprites[0].leaving).toBe(true);
  });
});

describe("applyInstruction: narrate", () => {
  it("设置旁白并清空对话与说话人", () => {
    let state = applyInstruction(buildInitialState(), { t: "say", who: "protagonist", expr: "default", text: "x" }, deps);
    state = applyInstruction(state, { t: "narrate", text: "海面没有风。" }, deps);
    expect(state.narration?.text).toBe("海面没有风。");
    expect(state.narration?.typedLen).toBe(0);
    expect(state.dialogue).toBeNull();
    expect(state.speaker).toBeNull();
  });
});

describe("applyInstruction: wait / effect / bg / bgm / sfx", () => {
  it("wait 只置标记，不改其他状态（实际计时由 player 负责）", () => {
    const before = buildInitialState();
    const state = applyInstruction(before, { t: "wait", ms: 500 }, deps);
    expect(state.flags.isWaiting).toBe(true);
    // 其余字段不变（结构性相等，除 flags）
    expect(state.background).toBe(before.background);
    expect(state.sprites).toBe(before.sprites);
  });

  it("effect 推入待播放列表", () => {
    const state = applyInstruction(buildInitialState(), { t: "effect", type: "shake", intensity: 5, ms: 300 }, deps);
    expect(state.effects).toHaveLength(1);
    expect(state.effects[0].type).toBe("shake");
    expect(state.effects[0].intensity).toBe(5);
  });

  it("bg 更新背景与过渡参数", () => {
    const state = applyInstruction(buildInitialState(), { t: "bg", id: "ocean", trans: "fade", ms: 1000 }, deps);
    expect(state.background).toBe("ocean");
    expect(state.backgroundTrans).toBe("fade");
    expect(state.backgroundMs).toBe(1000);
  });

  it("bgm / sfx 更新音频线索", () => {
    let state = applyInstruction(buildInitialState(), { t: "bgm", id: "bgm1", fade: 2000, loop: true }, deps);
    expect(state.audio.bgm).toEqual({ id: "bgm1", fade: 2000, loop: true });
    state = applyInstruction(state, { t: "sfx", id: "sfx1" }, deps);
    expect(state.audio.sfx).toHaveLength(1);
    expect(state.audio.sfx[0].id).toBe("sfx1");
  });
});

describe("打字机推进", () => {
  it("advanceTyping 逐字增加 typedLen", () => {
    let state = applyInstruction(buildInitialState(), { t: "say", who: "protagonist", expr: "default", text: "abc" }, deps);
    expect(state.dialogue?.typedLen).toBe(0);
    state = advanceTyping(state);
    expect(state.dialogue?.typedLen).toBe(1);
    state = advanceTyping(state);
    expect(state.dialogue?.typedLen).toBe(2);
    state = advanceTyping(state);
    expect(state.dialogue?.typedLen).toBe(3);
    expect(state.dialogue?.fullyRevealed).toBe(true);
    // 已打满后再推进不变
    state = advanceTyping(state);
    expect(state.dialogue?.typedLen).toBe(3);
  });

  it("revealFully 立即显示全句", () => {
    let state = applyInstruction(buildInitialState(), { t: "narrate", text: "海面没有风。" }, deps);
    state = revealFully(state);
    expect(state.narration?.typedLen).toBe(state.narration?.text.length);
    expect(state.narration?.fullyRevealed).toBe(true);
  });
});
