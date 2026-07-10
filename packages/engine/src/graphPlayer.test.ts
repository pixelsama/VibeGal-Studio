import { describe, expect, it, vi } from "vitest";
import { GraphNovelPlayer } from "./graphPlayer";
import { createReadTextKey, type ReadTextKey } from "./runtimeContract";
import type { Manifest, Meta, ProjectGraphData } from "./types";

const manifest: Manifest = {
  characters: {
    hero: { name: "Akari", color: "#ff99aa", sprites: { default: "hero.png" } },
  },
  backgrounds: {},
  audio: { bgm: {}, sfx: {}, voice: { lineVoice: "voice/line.ogg" } },
};

const meta: Meta = {
  title: "Spec 07",
  typingSpeedCps: 60,
  autoAdvanceMs: 10,
  chapterGapMs: 0,
  stage: { width: 1280, height: 720 },
};

const baseGraph: ProjectGraphData = {
  version: 1,
  entryNodeId: "start",
  nodes: [
    { id: "start", title: "Start", file: "nodes/start.json", position: { x: 0, y: 0 } },
    { id: "left", title: "Left", file: "nodes/left.json", position: { x: 200, y: 0 } },
    { id: "right", title: "Right", file: "nodes/right.json", position: { x: 200, y: 100 } },
  ],
  edges: [],
};

function readKey(instructionId: string, text: string): ReadTextKey {
  return createReadTextKey({ nodeId: "start", instructionId, text });
}

describe("GraphNovelPlayer playback history and skip", () => {
  it("seekBy replays backward within the current node without repeating runtime effects", () => {
    const onRuntimeEffect = vi.fn();
    const player = new GraphNovelPlayer({ manifest, meta, onRuntimeEffect });
    player.loadGraph(baseGraph, [
      {
        id: "start",
        instructions: [
          { t: "unlock", kind: "cg", id: "cg_rooftop" },
          { t: "bg", id: "school", trans: "cut", ms: 0 },
          { t: "narrate", id: "line_01", text: "抵达停点。" },
        ],
      },
    ]);

    player.advance();
    expect(player.getState().flags.progress.current).toBe(3);

    player.seekBy(-1);

    expect(player.getState().flags.progress).toEqual({ current: 2, total: 3 });
    expect(player.getState().background).toBe("school");
    expect(player.getState().narration).toBeNull();
    expect(onRuntimeEffect).toHaveBeenCalledTimes(1);
    player.dispose();
  });

  it("historyAddsBacklogForSayAndNarrate", () => {
    const player = new GraphNovelPlayer({ manifest, meta });
    player.loadGraph(baseGraph, [
      {
        id: "start",
        instructions: [
          { t: "voice", id: "lineVoice" },
          { t: "say", id: "line_01", who: "hero", expr: "default", text: "你好。" },
          { t: "narrate", id: "line_02", text: "风停了。" },
          { t: "pause", id: "pause_01" },
        ],
      },
    ]);

    player.advance();
    player.advance();
    player.advance();

    expect(player.getBacklog()).toEqual([
      expect.objectContaining({
        id: "history:1",
        createdOrder: 1,
        storyPoint: { nodeId: "start", instructionId: "line_01" },
        speakerName: "Akari",
        text: "你好。",
        voiceId: "lineVoice",
        readKey: readKey("line_01", "你好。"),
      }),
      expect.objectContaining({
        id: "history:2",
        createdOrder: 2,
        storyPoint: { nodeId: "start", instructionId: "line_02" },
        speakerName: undefined,
        text: "风停了。",
        readKey: readKey("line_02", "风停了。"),
      }),
    ]);
    expect(player.getCurrentStoryPoint()).toEqual({ nodeId: "start", instructionId: "line_02" });
    expect(player.getLastStableStoryPoint()).toEqual({ nodeId: "start", instructionId: "line_02" });
    expect(player.getCurrentReadKey()).toEqual(readKey("line_02", "风停了。"));
    player.dispose();
  });

  it("historyDoesNotAddPauseOnlyEntry", () => {
    const player = new GraphNovelPlayer({ manifest, meta });
    player.loadGraph(baseGraph, [
      { id: "start", instructions: [{ t: "pause", id: "pause_01" }] },
    ]);

    player.advance();

    expect(player.getBacklog()).toEqual([]);
    expect(player.getCurrentStoryPoint()).toEqual({ nodeId: "start", instructionId: "pause_01" });
    expect(player.getLastStableStoryPoint()).toEqual({ nodeId: "start", instructionId: "pause_01" });
    player.dispose();
  });

  it("readStatusMarksAfterTextRevealed", () => {
    const marked: ReadTextKey[] = [];
    const player = new GraphNovelPlayer({
      manifest,
      meta,
      persistent: {
        getReadStatus: () => false,
        markRead: (key) => marked.push(key),
      },
    });
    player.loadGraph(baseGraph, [
      { id: "start", instructions: [{ t: "say", id: "line_01", who: "hero", expr: "default", text: "还没读完。" }] },
    ]);

    player.advance();
    expect(marked).toEqual([]);

    player.advance();

    expect(marked).toEqual([readKey("line_01", "还没读完。")]);
    player.dispose();
  });

  it("readSkipStopsAtUnreadLine", async () => {
    vi.useFakeTimers();
    try {
      const read = new Set([JSON.stringify(readKey("line_01", "读过。"))]);
      const player = new GraphNovelPlayer({
        manifest,
        meta,
        persistent: {
          getReadStatus: (key) => read.has(JSON.stringify(key)),
          markRead: (key) => read.add(JSON.stringify(key)),
        },
      });
      player.loadGraph(baseGraph, [
        {
          id: "start",
          instructions: [
            { t: "say", id: "line_01", who: "hero", expr: "default", text: "读过。" },
            { t: "say", id: "line_02", who: "hero", expr: "default", text: "第一次见。" },
          ],
        },
      ]);

      player.advance();
      player.setSkipMode("read");
      await vi.runAllTimersAsync();

      expect(player.getSkipMode()).toBe("off");
      expect(player.getCurrentStoryPoint()).toEqual({ nodeId: "start", instructionId: "line_02" });
      expect(player.getState().dialogue?.text).toBe("第一次见。");
      expect(player.getState().dialogue?.fullyRevealed).toBe(false);
      player.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("allSkipStopsAtChoice", async () => {
    vi.useFakeTimers();
    try {
      const player = new GraphNovelPlayer({ manifest, meta });
      player.loadGraph(
        {
          ...baseGraph,
          edges: [
            { id: "start__left", from: "start", to: "left", mode: "choice", label: "左", condition: null },
            { id: "start__right", from: "start", to: "right", mode: "choice", label: "右", condition: null },
          ],
        },
        [
          { id: "start", instructions: [{ t: "say", id: "line_01", who: "hero", expr: "default", text: "选吧。" }] },
          { id: "left", instructions: [{ t: "narrate", id: "left_01", text: "左。" }] },
          { id: "right", instructions: [{ t: "narrate", id: "right_01", text: "右。" }] },
        ],
      );

      player.advance();
      player.setSkipMode("all");
      await vi.runAllTimersAsync();

      expect(player.getSkipMode()).toBe("off");
      expect(player.getState().choice?.choices).toEqual([
        { text: "左", to: "left" },
        { text: "右", to: "right" },
      ]);
      player.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("allSkipStopsAtExplicitPause", async () => {
    vi.useFakeTimers();
    try {
      const player = new GraphNovelPlayer({ manifest, meta });
      player.loadGraph(baseGraph, [
        {
          id: "start",
          instructions: [
            { t: "say", id: "line_01", who: "hero", expr: "default", text: "先走。" },
            { t: "pause", id: "pause_01" },
            { t: "narrate", id: "line_02", text: "不应跳到这里。" },
          ],
        },
      ]);

      player.advance();
      player.setSkipMode("all");
      await vi.runAllTimersAsync();

      expect(player.getSkipMode()).toBe("off");
      expect(player.getCurrentStoryPoint()).toEqual({ nodeId: "start", instructionId: "pause_01" });
      expect(player.getState().narration).toBeNull();
      player.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rollbackRestoresPreviousStoryPoint", () => {
    const player = new GraphNovelPlayer({ manifest, meta });
    player.loadGraph(baseGraph, [
      {
        id: "start",
        instructions: [
          { t: "say", id: "line_01", who: "hero", expr: "default", text: "第一句。" },
          { t: "narrate", id: "line_02", text: "第二句。" },
        ],
      },
    ]);

    player.advance();
    player.advance();
    player.advance();
    const firstEntry = player.getBacklog()[0];

    player.rollbackToHistoryEntry(firstEntry.id);

    expect(player.getCurrentStoryPoint()).toEqual({ nodeId: "start", instructionId: "line_01" });
    expect(player.getState().dialogue?.text).toBe("第一句。");
    expect(player.getState().dialogue?.fullyRevealed).toBe(true);
    expect(player.getState().narration).toBeNull();
    player.dispose();
  });

  it("voiceReplayDoesNotAdvanceStory", () => {
    const replayVoice = vi.fn();
    const player = new GraphNovelPlayer({ manifest, meta, replayVoice });
    player.loadGraph(baseGraph, [
      {
        id: "start",
        instructions: [
          { t: "voice", id: "lineVoice" },
          { t: "say", id: "line_01", who: "hero", expr: "default", text: "有语音。" },
          { t: "narrate", id: "line_02", text: "下一句。" },
        ],
      },
    ]);
    player.advance();
    const entry = player.getBacklog()[0];
    const before = {
      state: player.getState(),
      storyPoint: player.getCurrentStoryPoint(),
      progress: player.getState().flags.progress.current,
    };

    player.replayVoice(entry.id);

    expect(replayVoice).toHaveBeenCalledWith("lineVoice");
    expect(player.getCurrentStoryPoint()).toEqual(before.storyPoint);
    expect(player.getState()).toBe(before.state);
    expect(player.getState().flags.progress.current).toBe(before.progress);
    player.dispose();
  });
});
