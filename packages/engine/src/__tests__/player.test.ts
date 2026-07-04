import { describe, expect, it, vi } from "vitest";
import { NovelPlayer } from "../player";
import type { Manifest, Meta } from "../types";

const manifest: Manifest = {
  characters: {},
  backgrounds: {},
  audio: { bgm: {}, sfx: {}, voice: {} },
};

const meta: Meta = {
  title: "Test",
  typingSpeedCps: 30,
  autoAdvanceMs: 10,
  chapterGapMs: 0,
  stage: { width: 1280, height: 720 },
};

describe("NovelPlayer choice pause", () => {
  it("player_does_not_auto_advance_past_choice", () => {
    vi.useFakeTimers();
    try {
      const player = new NovelPlayer({ manifest, meta });
      player.load([
        [
          { t: "choice", choices: [{ text: "留下", to: "stay" }] },
          { t: "narrate", text: "should not show" },
        ],
      ]);

      player.setAutoPlay(true);
      player.advance();
      vi.advanceTimersByTime(1000);

      const state = player.getState();
      expect(state.choice?.choices).toEqual([{ text: "留下", to: "stay" }]);
      expect(state.narration).toBeNull();
      expect(state.flags.progress.current).toBe(1);
      player.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("NovelPlayer frame advance", () => {
  it("advance_consumes_nonblocking_frame_until_text_stop", () => {
    const player = new NovelPlayer({ manifest, meta });
    player.load([
      [
        { t: "bg", id: "school", trans: "fade", ms: 1000 },
        { t: "char", id: "hero", expr: "default", pos: "left", trans: "fade", ms: 600, clear: false, remove: false },
        { t: "say", who: "hero", expr: "default", text: "你好。" },
        { t: "narrate", text: "下一帧" },
      ],
    ]);

    player.advance();

    const state = player.getState();
    expect(state.background).toBe("school");
    expect(state.sprites.map((sprite) => ({ id: sprite.id, pos: sprite.pos, expr: sprite.expr }))).toEqual([
      { id: "hero", pos: "left", expr: "default" },
    ]);
    expect(state.dialogue?.text).toBe("你好。");
    expect(state.narration).toBeNull();
    expect(state.flags.progress.current).toBe(3);
    player.dispose();
  });

  it("pause_stops_stage_only_frame_until_next_advance", () => {
    const player = new NovelPlayer({ manifest, meta });
    player.load([
      [
        { t: "bg", id: "school", trans: "fade", ms: 1000 },
        { t: "pause" },
        { t: "narrate", text: "继续。" },
      ],
    ]);

    player.advance();

    expect(player.getState().background).toBe("school");
    expect(player.getState().flags.progress.current).toBe(2);
    expect(player.getState().narration).toBeNull();

    player.advance();

    expect(player.getState().narration?.text).toBe("继续。");
    expect(player.getState().flags.progress.current).toBe(3);
    player.dispose();
  });

  it("wait_still_blocks_and_continues_after_timer", () => {
    vi.useFakeTimers();
    try {
      const player = new NovelPlayer({ manifest, meta });
      player.load([
        [
          { t: "bg", id: "school", trans: "fade", ms: 1000 },
          { t: "wait", ms: 800 },
          { t: "narrate", text: "等待后。" },
        ],
      ]);

      player.advance();

      expect(player.getState().background).toBe("school");
      expect(player.getState().flags.isWaiting).toBe(true);
      expect(player.getState().flags.progress.current).toBe(2);

      vi.advanceTimersByTime(800);

      expect(player.getState().flags.isWaiting).toBe(false);
      expect(player.getState().narration?.text).toBe("等待后。");
      expect(player.getState().flags.progress.current).toBe(3);
      player.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
