import { describe, expect, it, vi } from "vitest";
import { NovelPlayer } from "../player";
import { GraphNovelPlayer } from "../graphPlayer";
import type { Manifest, Meta, ProjectGraphData } from "../types";
import { createSaveSlotRecord } from "../runtimeContract";

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
  it("preserves global seek and chapter navigation for the linear compatibility API", () => {
    const player = new NovelPlayer({ manifest, meta });
    player.load([
      [{ t: "narrate", text: "第一章" }],
      [{ t: "narrate", text: "第二章" }],
    ]);

    expect(player.totalInstructions).toBe(2);
    expect(player.currentIndex).toBe(0);

    player.nextChapter();
    expect(player.currentIndex).toBe(1);
    expect(player.getState().flags.chapterIndex).toBe(1);
    expect(player.getState().narration?.text).toBe("第一章");

    player.stepOnce();
    expect(player.currentIndex).toBe(2);
    expect(player.getState().narration?.text).toBe("第二章");

    player.prevChapter();
    expect(player.currentIndex).toBe(0);
    expect(player.getState().flags.chapterIndex).toBe(0);
    player.dispose();
  });

  it("preserves the recording-mode pacing buffer", () => {
    vi.useFakeTimers();
    try {
      const player = new NovelPlayer({ manifest, meta });
      player.load([[{ t: "narrate", text: "录制开始" }]]);

      player.setRecording(true);
      vi.advanceTimersByTime(meta.autoAdvanceMs + 399);
      expect(player.getState().narration).toBeNull();

      vi.advanceTimersByTime(1);
      expect(player.getState().narration?.text).toBe("录制开始");
      player.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

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

  it("graphPlayerStopsOnInvalidAutoCondition", () => {
    const player = new GraphNovelPlayer({ manifest, meta });
    player.loadGraph(
      { ...baseGraph, edges: [
        { id: "bad", from: "start", to: "stay", mode: "auto", label: null, condition: "affection >" },
        { id: "fallback", from: "start", to: "leave", mode: "auto", label: null, condition: null },
      ] },
      [{ id: "start", instructions: [] }],
    );
    player.advance();
    expect(player.getRouteError()).toContain("自动分支条件无效");
    expect(player.getCurrentNodeId()).toBe("start");
    player.dispose();
  });

  it("graphPlayerRestoresCheckpointSnapshot", () => {
    const player = new GraphNovelPlayer({ manifest, meta });
    player.loadGraph(
      {
        ...baseGraph,
        edges: [{ id: "start__stay", from: "start", to: "stay", mode: "linear", label: null, condition: null }],
      },
      [
        { id: "start", instructions: [
          { t: "bg", id: "school", trans: "cut", ms: 0 },
          { t: "set", key: "route", value: "saved" },
          { t: "narrate", id: "line_01", text: "保存点。" },
        ] },
        { id: "stay", instructions: [{ t: "narrate", id: "line_02", text: "之后。" }] },
      ],
    );

    player.advance();
    const snapshot = player.createSnapshot();
    player.advance();
    player.advance();
    expect(player.getState().narration?.text).toBe("之后。");

    expect(player.restoreSnapshot(snapshot)).toEqual({ warnings: [] });

    expect(player.getState().background).toBe("school");
    expect(player.getState().vars.route).toBe("saved");
    expect(player.getState().narration?.text).toBe("保存点。");
    player.dispose();
  });

  it("graphPlayerRestoreFromSaveReturnsStructuredWarnings", () => {
    const player = new GraphNovelPlayer({ manifest, meta });
    player.loadGraph(baseGraph, [
      { id: "start", instructions: [{ t: "narrate", id: "line_01", text: "开始。" }] },
    ]);
    player.advance();
    const slot = createSaveSlotRecord({
      projectId: "project-a",
      now: "2026-07-08T00:00:00.000Z",
      checkpoint: {
        ...player.createSnapshot(),
        currentStoryPoint: { nodeId: "start", instructionId: "missing_line" },
      },
    });

    expect(player.restoreFromSave(slot)).toEqual({
      warnings: [
        expect.objectContaining({
          code: "story_point_not_found",
          storyPoint: { nodeId: "start", instructionId: "missing_line" },
        }),
      ],
    });
    player.dispose();
  });

  it("graphPlayerRestoreFromSaveFallsBackToDecisionLogWhenCheckpointIsStale", () => {
    const player = new GraphNovelPlayer({ manifest, meta });
    player.loadGraph(
      {
        ...baseGraph,
        edges: [
          { id: "start__stay", from: "start", to: "stay", mode: "auto", label: null, condition: null },
        ],
      },
      [
        { id: "start", instructions: [{ t: "set", key: "route", value: "saved" }] },
        { id: "stay", instructions: [{ t: "narrate", id: "line_02", text: "可恢复节点。" }] },
      ],
    );
    player.advance();
    const slot = createSaveSlotRecord({
      projectId: "project-a",
      now: "2026-07-08T00:00:00.000Z",
      checkpoint: {
        ...player.createSnapshot(),
        currentNodeId: "removed",
        currentStoryPoint: { nodeId: "removed", instructionId: "old_line" },
      },
      decisions: [
        { type: "start", nodeId: "start" },
        { type: "auto", fromNodeId: "start", toNodeId: "stay", edgeId: "start__stay" },
      ],
    });

    expect(player.restoreFromSave(slot).warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "node_not_found", nodeId: "removed" }),
      expect.objectContaining({ code: "decision_log_replayed", nodeId: "stay" }),
    ]));
    expect(player.getCurrentNodeId()).toBe("stay");
    expect(player.getCurrentStoryPoint()).toBeNull();
    expect(player.getState().flags.progress).toEqual({ current: 0, total: 1 });
    player.dispose();
  });

  it("unlockInstructionWritesRuntimeEffect", () => {
    const onRuntimeEffect = vi.fn();
    const player = new GraphNovelPlayer({ manifest, meta, onRuntimeEffect });
    player.loadGraph(
      { ...baseGraph, edges: [] },
      [{ id: "start", instructions: [
        { t: "unlock", kind: "cg", id: "cg_rooftop" },
        { t: "showCg", id: "cg_001" },
        { t: "playVideo", id: "op", skippable: true },
      ] }],
    );

    player.advance();

    expect(onRuntimeEffect).toHaveBeenCalledWith({ type: "unlock", kind: "cg", id: "cg_rooftop" });
    expect(onRuntimeEffect).toHaveBeenCalledWith({ type: "showCg", id: "cg_001" });
    expect(onRuntimeEffect).toHaveBeenCalledWith({ type: "playVideo", id: "op", skippable: true });
    player.dispose();
  });

  it("debugSessionInjectsVariablesAndSuppressesPersistentEffects", () => {
    const onRuntimeEffect = vi.fn();
    const player = new GraphNovelPlayer({ manifest, meta, onRuntimeEffect });
    player.loadGraph(baseGraph, [{ id: "start", instructions: [{ t: "completeEnding", id: "finish", endingId: "true_end" }] }]);
    expect(player.startDebugSession({ nodeId: "start", variableOverrides: { affection: 9 }, suppressPersistentEffects: true })).toEqual({ warnings: [] });
    player.advance();
    expect(player.getState().vars.affection).toBe(9);
    expect(onRuntimeEffect).not.toHaveBeenCalled();
  });

  it("rejects assignment values that violate a declared variable type", () => {
    const player = new GraphNovelPlayer({
      manifest,
      meta,
      variables: {
        version: 1,
        variables: { affection: { type: "number", default: 0, scope: "run" } },
      },
    });
    player.loadGraph(baseGraph, [{
      id: "start",
      instructions: [{ t: "set", key: "affection", value: "high" }],
    }]);

    expect(() => player.advance()).not.toThrow();
    expect(player.getState().vars.affection).toBe(0);
    expect(player.getRouteError()).toContain("runtime_assignment_failed");
    player.dispose();
  });

  it("initializes legacy variables with write sites to null before their first write", () => {
    const player = new GraphNovelPlayer({ manifest, meta });
    player.loadGraph(baseGraph, [{
      id: "start",
      instructions: [{ t: "set", key: "legacy_flag", value: true }],
    }]);

    expect(player.getState().vars.legacy_flag).toBeNull();
    player.dispose();
  });

  it("graphPlayerInitializesDeclaredRunVariables", () => {
    const player = new GraphNovelPlayer({
      manifest, meta,
      variables: { version: 1, variables: { affection: { type: "number", default: 3, scope: "run" } } },
    });
    player.loadGraph(baseGraph, [{ id: "start", instructions: [] }]);
    expect(player.getState().vars.affection).toBe(3);
    player.dispose();
  });

  it("falls back to declared defaults when saved values no longer match the registry", () => {
    const player = new GraphNovelPlayer({
      manifest,
      meta,
      variables: {
        version: 1,
        variables: { affection: { type: "number", default: 2, scope: "run" } },
      },
    });
    player.loadGraph(baseGraph, [{ id: "start", instructions: [] }]);
    const snapshot = { ...player.createSnapshot(), vars: { affection: "old", legacy: true } };

    expect(player.restoreSnapshot(snapshot).warnings).toEqual([
      expect.objectContaining({ code: "variable_value_incompatible", variableName: "affection" }),
    ]);
    expect(player.getState().vars).toMatchObject({ affection: 2, legacy: true });
    player.dispose();
  });
});
