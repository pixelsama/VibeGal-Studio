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

const registry = {
  version: 1 as const,
  variables: {
    playerName: {
      kind: "text" as const,
      label: "玩家名字",
      type: "string" as const,
      default: "旅行者",
      nullable: false,
      scope: "run" as const,
    },
    affection: {
      kind: "meter" as const,
      label: "好感度",
      type: "number" as const,
      default: 0,
      nullable: false,
      scope: "run" as const,
    },
  },
};

const baseGraph: ProjectGraphData = {
  version: 1,
  entryNodeId: "start",
  chapters: [],
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
  it("playbackTimingUpdatesTheCurrentTypingTimerWithoutResettingStoryState", async () => {
    vi.useFakeTimers();
    try {
      const player = new GraphNovelPlayer({ manifest, meta: { ...meta, typingSpeedCps: 1 } });
      player.loadGraph(baseGraph, [
        { id: "start", instructions: [{ t: "narrate", id: "line_01", text: "abcd" }] },
      ]);
      player.advance();
      const before = {
        nodeId: player.getCurrentNodeId(),
        storyPoint: player.getCurrentStoryPoint(),
        backlog: player.getBacklog(),
      };

      player.setPlaybackTiming({ textSpeedCps: 10, autoAdvanceMs: 25 });
      await vi.advanceTimersByTimeAsync(100);

      expect(player.getState().narration?.typedLen).toBe(1);
      expect({
        nodeId: player.getCurrentNodeId(),
        storyPoint: player.getCurrentStoryPoint(),
        backlog: player.getBacklog(),
      }).toEqual(before);
      player.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("playbackTimingReschedulesAnOutstandingAutoTimer", async () => {
    vi.useFakeTimers();
    try {
      const player = new GraphNovelPlayer({ manifest, meta: { ...meta, autoAdvanceMs: 1_000 } });
      player.loadGraph(baseGraph, [
        {
          id: "start",
          instructions: [
            { t: "narrate", id: "line_01", text: "first" },
            { t: "narrate", id: "line_02", text: "second" },
          ],
        },
      ]);
      player.advance();
      player.advance();
      player.setAutoPlay(true);

      await vi.advanceTimersByTimeAsync(100);
      player.setPlaybackTiming({ textSpeedCps: 60, autoAdvanceMs: 200 });
      await vi.advanceTimersByTimeAsync(199);
      expect(player.getCurrentStoryPoint()).toEqual({ nodeId: "start", instructionId: "line_01" });

      await vi.advanceTimersByTimeAsync(1);
      expect(player.getCurrentStoryPoint()).toEqual({ nodeId: "start", instructionId: "line_02" });
      player.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("skipAndAutoExposeTheRealMutuallyExclusivePlaybackState", () => {
    const player = new GraphNovelPlayer({ manifest, meta });
    player.loadGraph(baseGraph, [
      { id: "start", instructions: [{ t: "narrate", id: "line_01", text: "line" }] },
    ]);

    player.setAutoPlay(true);
    expect(player.getState().flags).toEqual(expect.objectContaining({ isAutoPlay: true, skipMode: "off" }));

    player.setSkipMode("read");
    expect(player.getState().flags).toEqual(expect.objectContaining({ isAutoPlay: false, skipMode: "read" }));

    player.setAutoPlay(true);
    expect(player.getState().flags).toEqual(expect.objectContaining({ isAutoPlay: true, skipMode: "off" }));
    player.dispose();
  });

  it("turningAutoOffCancelsTheOutstandingAdvanceTimer", async () => {
    vi.useFakeTimers();
    try {
      const player = new GraphNovelPlayer({ manifest, meta: { ...meta, autoAdvanceMs: 100 } });
      player.loadGraph(baseGraph, [
        {
          id: "start",
          instructions: [
            { t: "narrate", id: "line_01", text: "first" },
            { t: "narrate", id: "line_02", text: "second" },
          ],
        },
      ]);
      player.advance();
      player.advance();
      player.setAutoPlay(true);
      player.setAutoPlay(false);

      await vi.advanceTimersByTimeAsync(100);

      expect(player.getCurrentStoryPoint()).toEqual({ nodeId: "start", instructionId: "line_01" });
      expect(player.getState().flags.isAutoPlay).toBe(false);
      player.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("emitsAutoSaveCheckpointsOnlyForStableForwardPlayback", () => {
    const checkpoints: Array<{ reason: "node" | "choice"; nodeId: string; instructionId: string }> = [];
    const player = new GraphNovelPlayer({
      manifest,
      meta,
      onStableCheckpoint: (event) => checkpoints.push({
        reason: event.reason,
        nodeId: event.storyPoint.nodeId,
        instructionId: event.storyPoint.instructionId,
      }),
    });
    player.loadGraph(
      {
        ...baseGraph,
        edges: [
          { id: "start__left", from: "start", to: "left", mode: "choice", label: "Left", condition: null },
          { id: "start__right", from: "start", to: "right", mode: "choice", label: "Right", condition: null },
        ],
      },
      [
        { id: "start", instructions: [{ t: "narrate", id: "start_01", text: "start" }] },
        { id: "left", instructions: [{ t: "narrate", id: "left_01", text: "left" }] },
        { id: "right", instructions: [{ t: "narrate", id: "right_01", text: "right" }] },
      ],
    );

    player.advance();
    expect(checkpoints).toEqual([{ reason: "node", nodeId: "start", instructionId: "start_01" }]);
    player.advance();
    player.advance();
    player.choose("right");
    expect(checkpoints).toEqual([
      { reason: "node", nodeId: "start", instructionId: "start_01" },
      { reason: "node", nodeId: "right", instructionId: "right_01" },
      { reason: "choice", nodeId: "right", instructionId: "right_01" },
    ]);

    const snapshot = player.createSnapshot();
    player.restoreSnapshot(snapshot);
    player.jumpToStoryPoint({ nodeId: "start", instructionId: "start_01" });
    player.seekToInstruction(1);
    expect(checkpoints).toHaveLength(3);
    player.dispose();
  });

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

  it("interpolatesAndFormatsRuntimeTextAcrossDisplayAndBacklog", () => {
    const player = new GraphNovelPlayer({
      manifest: {
        ...manifest,
        uiSkins: { default: { assets: {}, tokens: { accent: "#123abc" } } },
      },
      meta,
      variables: registry,
    });
    player.loadGraph(baseGraph, [{
      id: "start",
      instructions: [{
        t: "say",
        id: "line_01",
        who: "hero",
        expr: "default",
        text: "你好，[b]{玩家名字}[/b][pause=250][color=accent]！[/color]",
      }],
    }]);
    player.startDebugSession({
      nodeId: "start",
      variableOverrides: { playerName: "小满" },
      suppressPersistentEffects: true,
    });

    player.advance();

    expect(player.getState().dialogue).toEqual(expect.objectContaining({
      text: "你好，小满！",
      sourceText: "你好，[b]{玩家名字}[/b][pause=250][color=accent]！[/color]",
      tokens: [
        { type: "text", text: "你好，" },
        { type: "text", text: "小满", bold: true },
        { type: "pause", ms: 250 },
        { type: "text", text: "！", color: "#123ABC" },
      ],
    }));
    expect(player.getBacklog()[0]).toEqual(expect.objectContaining({
      text: "你好，小满！",
      tokens: expect.any(Array),
      readKey: readKey("line_01", "你好，[b]{玩家名字}[/b][pause=250][color=accent]！[/color]"),
    }));
    player.dispose();
  });

  it("reportsRuntimeTextDiagnosticsOncePerStoryPoint", () => {
    const diagnostics = vi.fn();
    const player = new GraphNovelPlayer({
      manifest,
      meta,
      variables: registry,
      onRuntimeTextDiagnostic: diagnostics,
    });
    player.loadGraph(baseGraph, [{
      id: "start",
      instructions: [{
        t: "narrate",
        id: "line_01",
        text: "你好，{missing}。[unknown]",
      }],
    }]);

    player.advance();
    player.seekToInstruction(1);
    player.jumpToStoryPoint({ nodeId: "start", instructionId: "line_01" });

    expect(diagnostics).toHaveBeenCalledTimes(2);
    expect(diagnostics).toHaveBeenCalledWith(expect.objectContaining({
      storyPoint: { nodeId: "start", instructionId: "line_01" },
      diagnostic: expect.objectContaining({ code: "text_unknown_variable" }),
    }));
    expect(diagnostics).toHaveBeenCalledWith(expect.objectContaining({
      diagnostic: expect.objectContaining({ code: "text_unknown_markup" }),
    }));
    player.dispose();
  });

  it("honorsInlinePauseBeforeRevealingTheFollowingCharacter", async () => {
    vi.useFakeTimers();
    try {
      const player = new GraphNovelPlayer({ manifest, meta: { ...meta, typingSpeedCps: 10 } });
      player.loadGraph(baseGraph, [{
        id: "start",
        instructions: [{ t: "narrate", id: "line_01", text: "前[pause=500]后" }],
      }]);

      player.advance();
      await vi.advanceTimersByTimeAsync(100);
      expect(player.getState().narration?.typedLen).toBe(1);
      await vi.advanceTimersByTimeAsync(599);
      expect(player.getState().narration?.typedLen).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(player.getState().narration?.typedLen).toBe(2);
      player.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("previewsUnsavedPlayerNamingWithIndexFallbackIdentity", () => {
    const player = new GraphNovelPlayer({ manifest, meta, variables: registry });
    player.loadGraph(baseGraph, [{
      id: "start",
      instructions: [
        { t: "inputName", key: "playerName", prompt: "怎么称呼你？", maxLength: 20 },
        { t: "narrate", id: "line_01", text: "你好，{玩家名字}。" },
      ],
    }]);

    player.advance();
    expect(player.getState().nameInput).toMatchObject({ instructionId: "draft-name-input" });
    expect(player.getCurrentStoryPoint()).toEqual({ nodeId: "start", instructionId: "index:0" });
    expect(player.submitName("小满")).toBe(true);
    expect(player.getState().vars.playerName).toBe("小满");

    player.jumpToStoryPoint({ nodeId: "start", instructionId: "index:0" });
    expect(player.getState().nameInput).not.toBeNull();
    expect(player.getState().vars.playerName).toBe("旅行者");
    player.dispose();
  });

  it("blocksForPlayerNamingAndRestoresThePreviousValueOnRollback", () => {
    const player = new GraphNovelPlayer({ manifest, meta, variables: registry });
    player.loadGraph(baseGraph, [{
      id: "start",
      instructions: [
        {
          t: "inputName",
          id: "ask_name",
          key: "playerName",
          prompt: "怎么称呼你？",
          maxLength: 3,
        },
        { t: "narrate", id: "line_01", text: "你好，{玩家名字}。" },
      ],
    }]);

    player.advance();
    expect(player.getCurrentStoryPoint()).toEqual({ nodeId: "start", instructionId: "ask_name" });
    expect(player.getState().nameInput).toEqual(expect.objectContaining({ key: "playerName" }));
    expect(player.submitName("   ")).toBe(false);
    expect(player.getState().nameInput?.error).toBe("请输入名字。");
    expect(player.submitName("四个字符")).toBe(false);
    expect(player.getState().nameInput?.error).toContain("3");

    expect(player.submitName("小满")).toBe(true);
    expect(player.getState().vars.playerName).toBe("小满");
    expect(player.getState().narration?.text).toBe("你好，小满。");

    player.jumpToStoryPoint({ nodeId: "start", instructionId: "ask_name" });
    expect(player.getState().nameInput).not.toBeNull();
    expect(player.getState().vars.playerName).toBe("旅行者");
    player.dispose();
  });

  it("restoresThePreInputValueAfterSavingAndLoadingAtPlayerNaming", () => {
    const instructions = [
      {
        t: "inputName" as const,
        id: "ask_name",
        key: "playerName",
        prompt: "怎么称呼你？",
        maxLength: 20,
      },
      { t: "narrate" as const, id: "line_01", text: "你好，{玩家名字}。" },
    ];
    const original = new GraphNovelPlayer({ manifest, meta, variables: registry });
    original.loadGraph(baseGraph, [{ id: "start", instructions }]);
    original.advance();
    const snapshot = original.createSnapshot();
    expect(snapshot.nameInputOrigin).toEqual({
      instructionId: "ask_name",
      key: "playerName",
      value: "旅行者",
    });

    const restored = new GraphNovelPlayer({ manifest, meta, variables: registry });
    restored.loadGraph(baseGraph, [{ id: "start", instructions }]);
    expect(restored.restoreSnapshot(snapshot).warnings).toEqual([]);
    expect(restored.getState().nameInput?.key).toBe("playerName");
    expect(restored.submitName("小满")).toBe(true);
    expect(restored.getState().vars.playerName).toBe("小满");

    restored.jumpToStoryPoint({ nodeId: "start", instructionId: "ask_name" });
    expect(restored.getState().vars.playerName).toBe("旅行者");
    original.dispose();
    restored.dispose();
  });

  it("usesTheDefaultNameAndRejectsNonTextStoryState", () => {
    const player = new GraphNovelPlayer({ manifest, meta, variables: registry });
    player.loadGraph(baseGraph, [{
      id: "start",
      instructions: [
        {
          t: "inputName",
          id: "ask_default",
          key: "playerName",
          prompt: "怎么称呼你？",
          default: "旅人",
          maxLength: 20,
        },
        { t: "inputName", id: "ask_number", key: "affection", prompt: "数值？", maxLength: 20 },
      ],
    }]);

    player.advance();
    expect(player.submitName(" ")).toBe(true);
    expect(player.getState().vars.playerName).toBe("旅人");
    expect(player.getState().nameInput?.key).toBe("affection");
    expect(player.submitName("1")).toBe(false);
    expect(player.getState().nameInput?.error).toContain("不是可命名的文本状态");
    player.dispose();
  });

  it("localizesDisplayAndBacklogWithoutChangingReadIdentity", () => {
    const player = new GraphNovelPlayer({
      manifest,
      meta: { ...meta, locale: { default: "zh-CN", available: ["zh-CN", "en"] } },
      locales: {
        "zh-CN": { "opening.hello": "早上好。" },
        en: { "opening.hello": "Good morning." },
      },
      currentLocale: "en",
    });
    player.loadGraph(baseGraph, [{
      id: "start",
      instructions: [{
        t: "say",
        id: "line_01",
        who: "hero",
        expr: "default",
        text: "原始台词。",
        textKey: "opening.hello",
      }],
    }]);

    player.advance();

    expect(player.getState().dialogue?.text).toBe("Good morning.");
    expect(player.getBacklog()[0]).toEqual(expect.objectContaining({
      text: "Good morning.",
      readKey: readKey("line_01", "原始台词。"),
    }));
    expect(player.getCurrentReadKey()).toEqual(readKey("line_01", "原始台词。"));

    player.setCurrentLocale("ja");

    expect(player.getState().dialogue?.text).toBe("早上好。");
    expect(player.getCurrentReadKey()).toEqual(readKey("line_01", "原始台词。"));
    expect(player.createSnapshot()).not.toHaveProperty("currentLocale");
    player.dispose();
  });

  it("lineVoicePlaysWithDialogueAndBindsToHistory", () => {
    const player = new GraphNovelPlayer({ manifest, meta });
    player.loadGraph(baseGraph, [{
      id: "start",
      instructions: [{
        t: "say",
        id: "line_01",
        who: "hero",
        expr: "default",
        text: "逐行语音。",
        voice: "lineVoice",
      }],
    }]);

    player.advance();

    expect(player.getState().audio.voice).toEqual(expect.objectContaining({ id: "lineVoice" }));
    expect(player.getBacklog()[0]).toEqual(expect.objectContaining({ voiceId: "lineVoice" }));
    player.dispose();
  });

  it("seekAndRestoreDoNotReplayLineVoice", () => {
    const player = new GraphNovelPlayer({ manifest, meta });
    player.loadGraph(baseGraph, [{
      id: "start",
      instructions: [
        { t: "bgm", id: "theme", fade: 0, loop: true },
        {
          t: "say",
          id: "line_01",
          who: "hero",
          expr: "default",
          text: "逐行语音。",
          voice: "lineVoice",
        },
      ],
    }]);

    player.advance();
    expect(player.getState().audio.voice?.id).toBe("lineVoice");
    const snapshot = player.createSnapshot();

    player.seekToInstruction(2);
    expect(player.getState().audio.bgm?.id).toBe("theme");
    expect(player.getState().audio.voice).toBeNull();

    player.restoreSnapshot(snapshot);
    expect(player.getState().dialogue?.text).toBe("逐行语音。");
    expect(player.getState().audio.voice).toBeNull();
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

  it("startsANewPlaythroughFromTheCompleteChapterCheckpoint", () => {
    const reached: string[] = [];
    const graph: ProjectGraphData = {
      version: 1,
      entryNodeId: "start",
      chapters: [
        { id: "opening", title: "Opening" },
        { id: "chapter_2", title: "Chapter 2" },
      ],
      nodes: [
        { id: "start", title: "Start", file: "nodes/start.json", position: { x: 0, y: 0 }, chapterId: "opening" },
        { id: "chapter_2_start", title: "Chapter 2", file: "nodes/chapter_2.json", position: { x: 200, y: 0 }, chapterId: "chapter_2" },
      ],
      edges: [],
    };
    const player = new GraphNovelPlayer({
      manifest: {
        ...manifest,
        backgrounds: { school: "school.png" },
        audio: { ...manifest.audio, bgm: { theme: "theme.ogg" } },
      },
      meta,
      onChapterReached: (chapterId) => reached.push(chapterId),
    });
    player.loadGraph(graph, [
      { id: "start", instructions: [{ t: "narrate", id: "opening_01", text: "opening" }] },
      {
        id: "chapter_2_start",
        instructions: [
          { t: "say", id: "chapter_2_line", who: "hero", text: "checkpoint line" },
          { t: "narrate", id: "chapter_2_next", text: "next line" },
        ],
      },
    ]);
    player.advance();
    const previousPlaythrough = player.createSnapshot().playthroughId;

    expect(player.startChapter({
      nodeId: "chapter_2_start",
      instructionId: "chapter_2_line",
      vars: { route: "b" },
      background: "school",
      sprites: [{ id: "hero", pos: "right", expr: "default", scale: 1.25, flip: true }],
      bgm: { id: "theme", loop: false },
    })).toEqual({ warnings: [] });

    const snapshot = player.createSnapshot();
    expect(snapshot.playthroughId).not.toBe(previousPlaythrough);
    expect(player.getDecisionLog()).toEqual([{ type: "start", nodeId: "chapter_2_start" }]);
    expect(player.getCurrentStoryPoint()).toEqual({ nodeId: "chapter_2_start", instructionId: "chapter_2_line" });
    expect(player.getState()).toEqual(expect.objectContaining({
      vars: expect.objectContaining({ route: "b" }),
      background: "school",
      sprites: [expect.objectContaining({
        id: "hero", pos: "right", expr: "default", scale: 1.25, flip: true,
        exprMs: 0, ms: 0, justEntered: false, trans: "cut",
      })],
      audio: expect.objectContaining({ bgm: { id: "theme", loop: false, fade: 0 } }),
    }));
    expect(player.getState().dialogue).toEqual(expect.objectContaining({ text: "checkpoint line", fullyRevealed: true }));
    expect(reached).toEqual(["opening", "chapter_2"]);
    player.dispose();
  });

  it("startsAChapterAtNodeEntryAndRejectsMissingCheckpointTargets", () => {
    const player = new GraphNovelPlayer({ manifest, meta });
    player.loadGraph(baseGraph, [
      {
        id: "start",
        instructions: [
          { t: "set", key: "affection", value: 5 },
          { t: "narrate", id: "line_01", text: "started" },
        ],
      },
    ]);

    expect(player.startChapter({
      nodeId: "start",
      instructionId: null,
      vars: { affection: 2 },
      background: null,
      sprites: [],
      bgm: null,
    })).toEqual({ warnings: [] });
    expect(player.getState().vars.affection).toBe(5);
    expect(player.getState().narration?.text).toBe("started");

    expect(player.startChapter({
      nodeId: "missing",
      instructionId: null,
      vars: {},
      background: null,
      sprites: [],
      bgm: null,
    })).toEqual({ warnings: [expect.objectContaining({ code: "node_not_found", nodeId: "missing" })] });
    player.dispose();
  });

  it("replaySuppressesReadAndChapterPersistenceAndSignalsTerminalPlaybackOnce", () => {
    const markRead = vi.fn();
    const onChapterReached = vi.fn();
    const onPlaybackEnded = vi.fn();
    const player = new GraphNovelPlayer({
      manifest,
      meta,
      persistent: { getReadStatus: () => false, markRead },
      onChapterReached,
      onPlaybackEnded,
    });
    const graph: ProjectGraphData = {
      version: 1,
      entryNodeId: "start",
      chapters: [{ id: "opening", title: "Opening" }, { id: "replay", title: "Replay" }],
      nodes: [
        { id: "start", file: "nodes/start.json", position: { x: 0, y: 0 }, chapterId: "opening" },
        { id: "replay_start", file: "nodes/replay.json", position: { x: 100, y: 0 }, chapterId: "replay" },
      ],
      edges: [],
    };
    player.loadGraph(graph, [
      { id: "start", instructions: [{ t: "narrate", id: "opening_01", text: "opening" }] },
      { id: "replay_start", instructions: [{ t: "narrate", id: "replay_01", text: "replay" }] },
    ]);
    onChapterReached.mockClear();

    expect(player.startReplay("replay_start")).toEqual({ warnings: [] });
    player.advance();
    player.advance();
    player.advance();

    expect(markRead).not.toHaveBeenCalled();
    expect(onChapterReached).not.toHaveBeenCalled();
    expect(onPlaybackEnded).toHaveBeenCalledOnce();
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
