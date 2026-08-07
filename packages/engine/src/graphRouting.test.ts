import { describe, expect, it } from "vitest";
import type { GraphEdgeData } from "./types";
import type { NovelState } from "./state";
import {
  decideGraphRoute,
  evaluateGraphCondition,
  evaluateGraphConditionResult,
} from "./graphRouting";

const baseState = (): NovelState => ({
  vars: {},
  background: null,
  backgroundTrans: "fade",
  backgroundMs: 0,
  sprites: [],
  speaker: null,
  dialogue: null,
  narration: null,
  choice: null,
  effects: [],
  transitions: [],
  audio: { bgm: null, sfx: [], voice: null },
  nameInput: null,
  flags: {
    isWaiting: false,
    isAutoPlay: false,
    skipMode: "off",
    isRecording: false,
    chapterIndex: 0,
    progress: { current: 0, total: 0 },
  },
  currentCueMs: null,
}) as unknown as NovelState;

const edge = (over: Partial<GraphEdgeData> & Pick<GraphEdgeData, "id" | "from" | "to">): GraphEdgeData =>
  ({ condition: null, ...over } as GraphEdgeData);

describe("decideGraphRoute — Spec 35 simplified routing", () => {
  it("returns end when there are no outgoing edges", () => {
    expect(decideGraphRoute([], baseState())).toEqual({ kind: "end" });
  });

  it("takes the sole edge directly (linear-compatible)", () => {
    const e = edge({ id: "a-b", from: "a", to: "b" });
    expect(decideGraphRoute([e], baseState())).toEqual({ kind: "target", edge: e });
  });

  it("follows the first condition that evaluates truthy", () => {
    const first = edge({ id: "a-hi", from: "a", to: "hi", condition: "resolve >= 3" });
    const second = edge({ id: "a-lo", from: "a", to: "lo", condition: "resolve < 3" });
    const state = baseState();
    state.vars.resolve = 5;
    expect(decideGraphRoute([first, second], state)).toEqual({ kind: "target", edge: first });
  });

  it("uses the empty-condition edge as fallback (last)", () => {
    const cond = edge({ id: "a-hi", from: "a", to: "hi", condition: "resolve >= 99" });
    const fallback = edge({ id: "a-def", from: "a", to: "def" }); // 无 condition
    const state = baseState();
    state.vars.resolve = 1; // 不满足条件
    expect(decideGraphRoute([cond, fallback], state)).toEqual({ kind: "target", edge: fallback });
  });

  it("takes the fallback even if it is declared first (re-ordered last)", () => {
    const fallback = edge({ id: "a-def", from: "a", to: "def" }); // 声明在前
    const cond = edge({ id: "a-hi", from: "a", to: "hi", condition: "resolve >= 99" });
    const state = baseState();
    state.vars.resolve = 1;
    expect(decideGraphRoute([fallback, cond], state)).toEqual({ kind: "target", edge: fallback });
  });

  it("errors when no condition matches and there is no fallback", () => {
    const first = edge({ id: "a-hi", from: "a", to: "hi", condition: "resolve >= 99" });
    const second = edge({ id: "a-mid", from: "a", to: "mid", condition: "resolve >= 50" });
    const state = baseState();
    state.vars.resolve = 1;
    const decision = decideGraphRoute([first, second], state);
    expect(decision.kind).toBe("error");
  });

  it("errors on an invalid condition expression", () => {
    const bad = edge({ id: "a-x", from: "a", to: "x", condition: "resolve >=>= 1" });
    const decision = decideGraphRoute([bad], baseState());
    // 单条边直接走，不会求值条件 —— 多条边才会求值。这里加第二条来触发求值。
    const other = edge({ id: "a-y", from: "a", to: "y", condition: "true" });
    const multi = decideGraphRoute([bad, other], baseState());
    expect(multi.kind).toBe("error");
    expect(decision).toEqual({ kind: "target", edge: bad });
  });

  it("preserves declaration order among same-kind edges", () => {
    // 两条都命中，第一条声明在前应胜出。
    const first = edge({ id: "a-1", from: "a", to: "t1", condition: "flag" });
    const second = edge({ id: "a-2", from: "a", to: "t2", condition: "flag" });
    const state = baseState();
    state.vars.flag = true;
    expect(decideGraphRoute([first, second], state)).toEqual({ kind: "target", edge: first });
  });
});

describe("evaluateGraphCondition helpers", () => {
  it("treats empty/whitespace condition as truthy", () => {
    expect(evaluateGraphCondition(null, {})).toBe(true);
    expect(evaluateGraphCondition("   ", {})).toBe(true);
  });

  it("evaluates a numeric comparison", () => {
    expect(evaluateGraphCondition("resolve >= 3", { resolve: 5 })).toBe(true);
    expect(evaluateGraphCondition("resolve >= 3", { resolve: 1 })).toBe(false);
  });

  it("returns invalid_condition result for a bad expression", () => {
    const result = evaluateGraphConditionResult("resolve >=>=", {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_condition");
  });
});
