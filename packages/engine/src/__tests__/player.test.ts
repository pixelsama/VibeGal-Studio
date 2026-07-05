import { describe, expect, it, vi } from "vitest";
import { NovelPlayer } from "../player";
import { GraphNovelPlayer } from "../graphPlayer";
import type { Manifest, Meta, ProjectGraphData } from "../types";

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

describe("GraphNovelPlayer routing", () => {
  const baseGraph: ProjectGraphData = {
    version: 1,
    entryNodeId: "start",
    nodes: [
      { id: "start", title: "Start", file: "nodes/start.json", position: { x: 0, y: 0 } },
      { id: "stay", title: "Stay", file: "nodes/stay.json", position: { x: 200, y: 0 } },
      { id: "leave", title: "Leave", file: "nodes/leave.json", position: { x: 200, y: 120 } },
    ],
    edges: [],
  };

  it("linear_edge_enters_target_node", () => {
    const player = new GraphNovelPlayer({ manifest, meta });
    player.loadGraph(
      { ...baseGraph, edges: [{ id: "start__stay", from: "start", to: "stay", mode: "linear", label: null, condition: null }] },
      [
        { id: "start", instructions: [] },
        { id: "stay", instructions: [{ t: "narrate", text: "留下。" }] },
      ],
    );

    player.advance();

    expect(player.getState().narration?.text).toBe("留下。");
    player.dispose();
  });

  it("choice_edges_set_choice_state_and_choose_enters_target", () => {
    const player = new GraphNovelPlayer({ manifest, meta });
    player.loadGraph(
      {
        ...baseGraph,
        edges: [
          { id: "start__stay", from: "start", to: "stay", mode: "choice", label: "留下", condition: null },
          { id: "start__leave", from: "start", to: "leave", mode: "choice", label: "离开", condition: null },
        ],
      },
      [
        { id: "start", instructions: [] },
        { id: "stay", instructions: [{ t: "narrate", text: "留下。" }] },
        { id: "leave", instructions: [{ t: "narrate", text: "离开。" }] },
      ],
    );

    player.advance();
    expect(player.getState().choice?.choices).toEqual([
      { text: "留下", to: "stay" },
      { text: "离开", to: "leave" },
    ]);

    player.choose("leave");

    expect(player.getState().choice).toBeNull();
    expect(player.getState().narration?.text).toBe("离开。");
    player.dispose();
  });

  it("auto_edges_use_runtime_vars_and_first_matching_edge", () => {
    const player = new GraphNovelPlayer({ manifest, meta });
    player.loadGraph(
      {
        ...baseGraph,
        edges: [
          { id: "start__stay", from: "start", to: "stay", mode: "auto", label: null, condition: "has_key == true" },
          { id: "start__leave", from: "start", to: "leave", mode: "auto", label: null, condition: null },
        ],
      },
      [
        { id: "start", instructions: [{ t: "set", key: "has_key", value: true }] },
        { id: "stay", instructions: [{ t: "narrate", text: "开门。" }] },
        { id: "leave", instructions: [{ t: "narrate", text: "离开。" }] },
      ],
    );

    player.advance();

    expect(player.getState().vars.has_key).toBe(true);
    expect(player.getState().narration?.text).toBe("开门。");
    player.dispose();
  });
});
