import { describe, expect, it } from "vitest";
import { FixtureFileSchema, FIXTURE_UI_PANELS } from "./fixtures";

/** 与 engine createInitialState 同形的最小合法 NovelState 快照。 */
function minimalState() {
  return {
    vars: {},
    background: null,
    backgroundTrans: "fade",
    backgroundMs: 1000,
    sprites: [],
    speaker: null,
    dialogue: null,
    narration: null,
    choice: null,
    effects: [],
    transitions: [],
    audio: { bgm: null, sfx: [], voice: null },
    flags: {
      isWaiting: false,
      isAutoPlay: false,
      skipMode: "off",
      isRecording: false,
      chapterIndex: 0,
      progress: { current: 0, total: 0 },
    },
    currentCueMs: null,
  };
}

describe("FixtureFileSchema", () => {
  it("接受只含 state 的最小 fixture", () => {
    const parsed = FixtureFileSchema.parse({ state: minimalState() });
    expect(parsed.title).toBeUndefined();
    expect(parsed.persistent).toBeUndefined();
    expect(parsed.uiHint).toBeUndefined();
  });

  it("接受完整 fixture 并给 unlock 缺省数组补默认值", () => {
    const parsed = FixtureFileSchema.parse({
      title: "第一章高潮对话",
      state: minimalState(),
      persistent: { unlock: { cg: ["smoke_ocean"] } },
      uiHint: { panel: "gallery-cg" },
    });
    expect(parsed.title).toBe("第一章高潮对话");
    expect(parsed.persistent?.unlock).toEqual({
      cg: ["smoke_ocean"],
      music: [],
      replay: [],
      endings: [],
    });
    expect(parsed.uiHint?.panel).toBe("gallery-cg");
  });

  it("缺少 state 时拒绝", () => {
    expect(FixtureFileSchema.safeParse({ title: "无状态" }).success).toBe(false);
  });

  it("state 缺字段时拒绝", () => {
    const broken = { ...minimalState() } as Record<string, unknown>;
    delete broken.audio;
    expect(FixtureFileSchema.safeParse({ state: broken }).success).toBe(false);
  });

  it("uiHint.panel 必须是合法枚举值", () => {
    for (const panel of FIXTURE_UI_PANELS) {
      expect(
        FixtureFileSchema.safeParse({ state: minimalState(), uiHint: { panel } }).success,
      ).toBe(true);
    }
    expect(
      FixtureFileSchema.safeParse({ state: minimalState(), uiHint: { panel: "gallery" } })
        .success,
    ).toBe(false);
  });
});
