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
