import { describe, expect, it, vi } from "vitest";
import { createInitialState } from "./state";
import {
  RENDERER_CONTRACT_VERSION,
  createInMemoryRuntimeServices,
  validateRendererManifestContract,
  type BacklogEntry,
  type HistoryService,
  type RendererProps,
  type RuntimeSettingsRecord,
} from "./renderer";
import { createInMemoryRuntimePersistenceAdapter, createRuntimeSnapshot, createSaveSlotRecord } from "./runtimeContract";

function Component() {
  return null;
}

describe("renderer contract", () => {
  it("historyServiceKeepsVoidRollbackImplementationsCompatible", () => {
    const history: HistoryService = {
      getBacklog: () => [],
      replayVoice: vi.fn(),
      rollbackTo: (): void => {},
    };

    expect(history.rollbackTo("entry-1")).toBeUndefined();
  });

  it("rendererPropsRequiresControlsAdvance", () => {
    const advance = vi.fn();
    const props: RendererProps = {
      state: createInitialState(),
      manifest: { characters: {}, backgrounds: {}, audio: { bgm: {}, sfx: {}, voice: {} } },
      contentBase: "/project/content",
      stage: { width: 1280, height: 720 },
      controls: {
        advance,
        choose: vi.fn(),
        setAutoPlay: vi.fn(),
        setSkipMode: vi.fn(),
        rollbackTo: vi.fn(),
        restart: vi.fn(),
      },
      runtime: createInMemoryRuntimeServices({ getState: createInitialState }),
    };

    props.controls.advance();

    expect(advance).toHaveBeenCalledOnce();
    expect("onAdvance" in props).toBe(false);
  });

  it("rendererManifestAcceptsCurrentContractVersion", () => {
    expect(
      validateRendererManifestContract({
        id: "default",
        name: "Default",
        contractVersion: RENDERER_CONTRACT_VERSION,
        Component,
      }),
    ).toEqual([]);
  });

  it("rendererManifestWarnsUnsupportedContractVersion", () => {
    expect(
      validateRendererManifestContract({
        id: "future",
        name: "Future",
        contractVersion: 2,
        Component,
      }),
    ).toEqual([
      expect.objectContaining({
        level: "error",
        code: "renderer_contract_unsupported",
      }),
    ]);
  });

  it("saveServiceDoesNotMutateGlobalPersistentOnLoad", async () => {
    const runtime = createInMemoryRuntimeServices({
      getState: () => ({
        ...createInitialState(),
        vars: { route: "a" },
      }),
      now: () => "2026-07-08T00:00:00.000Z",
    });

    await runtime.persistent.markRead({ nodeId: "start", instructionId: "line_01", textHash: "hash-a" });
    await runtime.persistent.unlock("cg", "cg_01");
    await runtime.save.save("slot-1");
    await runtime.persistent.unlock("music", "theme");
    await runtime.save.load("slot-1");

    expect(runtime.persistent.getReadStatus({ nodeId: "start", instructionId: "line_01", textHash: "hash-a" })).toBe(true);
    expect(runtime.persistent.getUnlocks()).toEqual({
      cg: ["cg_01"],
      music: ["theme"],
      replay: [],
      endings: [],
    });
  });

  it("galleryServiceListsUnlockedCg", async () => {
    const runtime = createInMemoryRuntimeServices({
      getState: createInitialState,
      manifest: {
        characters: {},
        backgrounds: {},
        audio: { bgm: { theme: "theme.mp3" }, sfx: {}, voice: {} },
        cg: { cg_001: { path: "cg_001.png", name: "First CG" }, cg_002: { path: "cg_002.png" } },
        videos: {},
        fonts: {},
        uiSkins: {},
        animationAtlases: {},
        unlocks: {
          cg: {
            cg_rooftop: { assetId: "cg_001", title: "Rooftop" },
            cg_locked: { assetId: "cg_002", title: "Locked" },
          },
          music: { music_theme: { audioId: "theme", title: "Theme" } },
          replay: { replay_start: { nodeId: "start", title: "Start" } },
          endings: { true_end: { title: "True End", nodeId: "ending" } },
        },
      },
    });

    await runtime.persistent.unlock("cg", "cg_rooftop");
    await runtime.persistent.unlock("music", "music_theme");

    expect(runtime.gallery.listCg()).toEqual([
      { id: "cg_rooftop", assetId: "cg_001", title: "Rooftop", asset: { path: "cg_001.png", name: "First CG" } },
    ]);
    expect(runtime.gallery.listMusic()).toEqual([
      { id: "music_theme", audioId: "theme", title: "Theme", asset: "theme.mp3" },
    ]);
    expect(runtime.gallery.isUnlocked("cg", "cg_rooftop")).toBe(true);
    expect(runtime.gallery.isUnlocked("cg", "cg_locked")).toBe(false);
  });

  it("replayServiceReturnsKnownReplayEntry", async () => {
    const runtime = createInMemoryRuntimeServices({
      getState: createInitialState,
      manifest: {
        characters: {},
        backgrounds: {},
        audio: { bgm: {}, sfx: {}, voice: {} },
        cg: {},
        videos: {},
        fonts: {},
        uiSkins: {},
        animationAtlases: {},
        unlocks: {
          cg: {},
          music: {},
          replay: { replay_start: { nodeId: "start", title: "Start" } },
          endings: { true_end: { title: "True End", nodeId: "ending" } },
        },
      },
    });

    await runtime.persistent.unlock("replay", "replay_start");
    await runtime.persistent.unlock("endings", "true_end");

    expect(runtime.gallery.listReplays()).toEqual([{ id: "replay_start", nodeId: "start", title: "Start" }]);
    expect(runtime.gallery.listEndings()).toEqual([{ id: "true_end", title: "True End", nodeId: "ending" }]);
  });

  it("replayServiceStartsAnUnlockedReplayByRegistryId", async () => {
    const startReplay = vi.fn(() => ({ warnings: [] }));
    const runtime = createInMemoryRuntimeServices({
      getState: createInitialState,
      manifest: {
        characters: {},
        backgrounds: {},
        audio: { bgm: {}, sfx: {}, voice: {} },
        cg: {},
        videos: {},
        fonts: {},
        uiSkins: {},
        animationAtlases: {},
        unlocks: {
          cg: {},
          music: {},
          replay: { replay_start: { nodeId: "start", title: "Start" } },
          endings: {},
        },
      },
      startReplay,
    });
    await runtime.persistent.unlock("replay", "replay_start");

    await expect(Promise.resolve(runtime.replay.start("replay_start"))).resolves.toEqual({ warnings: [] });

    expect(startReplay).toHaveBeenCalledWith("start");
  });

  it("replayServiceRejectsLockedReplayEntries", () => {
    const startReplay = vi.fn();
    const runtime = createInMemoryRuntimeServices({
      getState: createInitialState,
      manifest: {
        characters: {},
        backgrounds: {},
        audio: { bgm: {}, sfx: {}, voice: {} },
        cg: {},
        videos: {},
        fonts: {},
        uiSkins: {},
        animationAtlases: {},
        unlocks: {
          cg: {},
          music: {},
          replay: { replay_start: { nodeId: "start", title: "Start" } },
          endings: {},
        },
      },
      startReplay,
    });

    expect(() => runtime.replay.start("replay_start")).toThrow(expect.objectContaining({
      code: "runtime_service_unavailable",
    }));
    expect(startReplay).not.toHaveBeenCalled();
  });

  it("mediaServiceExposesCommandShape", () => {
    const closeCg = vi.fn();
    const skipVideo = vi.fn();
    const runtime = createInMemoryRuntimeServices({
      getState: createInitialState,
      media: { closeCg, skipVideo },
    });

    runtime.media.closeCg();
    runtime.media.skipVideo();

    expect(closeCg).toHaveBeenCalledOnce();
    expect(skipVideo).toHaveBeenCalledOnce();
  });

  it("audioServicePassesVoiceIdToBridge", () => {
    const replayVoice = vi.fn();
    const runtime = createInMemoryRuntimeServices({
      getState: createInitialState,
      audio: { replayVoice },
    });

    runtime.audio.replayVoice("voice_01");

    expect(replayVoice).toHaveBeenCalledWith("voice_01");
  });

  it("audioServiceCanPlayAndStopMusicRoomTracks", () => {
    const playMusic = vi.fn();
    const stopMusic = vi.fn();
    const runtime = createInMemoryRuntimeServices({
      getState: createInitialState,
      audio: { playMusic, stopMusic },
    });

    runtime.audio.playMusic("theme", { loop: true, fadeMs: 250 });
    runtime.audio.stopMusic(100);

    expect(playMusic).toHaveBeenCalledWith("theme", { loop: true, fadeMs: 250 });
    expect(stopMusic).toHaveBeenCalledWith(100);
  });

  it("saveServiceWritesSlotToAdapter", async () => {
    const adapter = createInMemoryRuntimePersistenceAdapter();
    const runtime = createInMemoryRuntimeServices({
      projectId: "project-a",
      persistenceAdapter: adapter,
      getState: () => ({
        ...createInitialState(),
        vars: { route: "a" },
        background: "school",
      }),
      currentNodeId: () => "start",
      currentStoryPoint: () => ({ nodeId: "start", instructionId: "line_01" }),
      now: () => "2026-07-08T00:00:00.000Z",
    });

    await runtime.save.save("slot-1", { label: "Slot 1", preview: { text: "Hello", background: "school" } });

    expect(await adapter.readSaveSlot("project-a", "slot-1")).toEqual(expect.objectContaining({
      projectId: "project-a",
      label: "Slot 1",
      preview: { text: "Hello", background: "school" },
      position: { nodeId: "start", instructionId: "line_01" },
      checkpoint: expect.objectContaining({ currentNodeId: "start", background: "school" }),
    }));
    await expect(runtime.save.listSlots()).resolves.toEqual([
      expect.objectContaining({ slotId: "slot-1", label: "Slot 1", position: { nodeId: "start", instructionId: "line_01" } }),
    ]);
  });

  it("loadServiceRestoresCheckpointState", async () => {
    const adapter = createInMemoryRuntimePersistenceAdapter();
    const restoreFromSave = vi.fn(() => ({ warnings: [] }));
    const checkpoint = createRuntimeSnapshot({ ...createInitialState(), vars: { route: "saved" }, background: "school" }, {
      currentNodeId: "start",
      currentStoryPoint: { nodeId: "start", instructionId: "line_01" },
    });
    await adapter.writeSaveSlot("project-a", "slot-1", createSaveSlotRecord({
      projectId: "project-a",
      now: "2026-07-08T00:00:00.000Z",
      checkpoint,
    }));
    const runtime = createInMemoryRuntimeServices({
      projectId: "project-a",
      persistenceAdapter: adapter,
      getState: createInitialState,
      restoreFromSave,
    });

    await expect(runtime.save.load("slot-1")).resolves.toEqual({ slotId: "slot-1", warnings: [] });

    expect(restoreFromSave).toHaveBeenCalledWith(expect.objectContaining({
      checkpoint: expect.objectContaining({ currentNodeId: "start", background: "school" }),
    }));
  });

  it("settingsServicePersistsVolumeIndependentlyFromSaveSlot", async () => {
    const appliedSettings: RuntimeSettingsRecord[] = [];
    const runtime = createInMemoryRuntimeServices({
      getState: createInitialState,
      now: () => "2026-07-08T00:00:00.000Z",
      onSettingsChanged: (settings) => appliedSettings.push(settings),
    });

    await runtime.settings.updateSettings({ volumes: { master: 0.75, bgm: 0.5, sfx: 0.25, voice: 1 } });
    await runtime.save.save("slot-1");
    await runtime.settings.updateSettings({ volumes: { master: 0.4, bgm: 0.3, sfx: 0.2, voice: 0.1 } });
    await runtime.save.load("slot-1");

    expect(runtime.settings.getSettings().volumes).toEqual({ master: 0.4, bgm: 0.3, sfx: 0.2, voice: 0.1 });
    expect(appliedSettings.at(-1)?.volumes).toEqual({ master: 0.4, bgm: 0.3, sfx: 0.2, voice: 0.1 });
  });

  it("settingsServiceReturnsEffectiveProjectTimingValues", () => {
    const runtime = createInMemoryRuntimeServices({
      getState: createInitialState,
      settingsFallback: { textSpeedCps: 42, autoAdvanceMs: 987 },
      initialSettings: {
        schemaVersion: 1,
        volumes: { master: 1, bgm: 0.8, sfx: 1, voice: 1 },
      },
    });

    expect(runtime.settings.getSettings()).toEqual(expect.objectContaining({
      textSpeedCps: 42,
      autoAdvanceMs: 987,
    }));
  });

  it("settingsServiceKeepsTheSavedValueWhenPersistenceFails", async () => {
    const adapter = createInMemoryRuntimePersistenceAdapter();
    const writeSettings = vi.spyOn(adapter, "writeSettings").mockRejectedValueOnce(new Error("disk full"));
    const setVolumes = vi.fn();
    const onSettingsChanged = vi.fn();
    const runtime = createInMemoryRuntimeServices({
      getState: createInitialState,
      persistenceAdapter: adapter,
      settingsFallback: { textSpeedCps: 30, autoAdvanceMs: 1_200 },
      audio: { setVolumes },
      onSettingsChanged,
    });
    const before = runtime.settings.getSettings();

    await expect(runtime.settings.updateSettings({ textSpeedCps: 90 })).rejects.toThrow("disk full");

    expect(writeSettings).toHaveBeenCalledOnce();
    expect(runtime.settings.getSettings()).toEqual(before);
    expect(setVolumes).not.toHaveBeenCalled();
    expect(onSettingsChanged).not.toHaveBeenCalled();
  });

  it("runtimePersistenceMutationsAreSerialized", async () => {
    const adapter = createInMemoryRuntimePersistenceAdapter();
    const originalWriteSaveSlot = adapter.writeSaveSlot.bind(adapter);
    let activeWrites = 0;
    let maxActiveWrites = 0;
    vi.spyOn(adapter, "writeSaveSlot").mockImplementation(async (...args) => {
      activeWrites += 1;
      maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      await originalWriteSaveSlot(...args);
      activeWrites -= 1;
    });
    const runtime = createInMemoryRuntimeServices({
      getState: createInitialState,
      persistenceAdapter: adapter,
    });

    await Promise.all([
      runtime.save.save("manual-01"),
      runtime.save.save("manual-02"),
      runtime.settings.updateSettings({ textSpeedCps: 45 }),
    ]);

    expect(maxActiveWrites).toBe(1);
  });

  it("runtimeStatusPublishesRendererReadableStructuredNotices", () => {
    const runtime = createInMemoryRuntimeServices({ getState: createInitialState });
    const listener = vi.fn();
    const unsubscribe = runtime.status!.subscribe(listener);

    runtime.status!.report({ level: "warning", code: "runtime_storage_fallback", message: "Using memory storage." });

    expect(listener).toHaveBeenCalledOnce();
    expect(runtime.status!.getNotices()).toEqual([
      expect.objectContaining({
        level: "warning",
        code: "runtime_storage_fallback",
        message: "Using memory storage.",
      }),
    ]);
    unsubscribe();
  });

  it("historyServiceReturnsBacklogEntriesWithStoryPoint", () => {
    const entry: BacklogEntry = {
      id: "entry-1",
      storyPoint: { nodeId: "start", instructionId: "line_01" },
      speakerName: "Akari",
      text: "今天也很安静呢。",
      readKey: { nodeId: "start", instructionId: "line_01", textHash: "line-hash" },
    };
    const rollbackTo = vi.fn(() => ({
      warnings: [{ code: "story_point_not_found", message: "The story point was removed." }],
    }));
    const runtime = createInMemoryRuntimeServices({
      getState: createInitialState,
      initialBacklog: [entry],
      rollbackTo,
    });

    expect(runtime.history.getBacklog()).toEqual([entry]);
    expect(runtime.history.rollbackTo("entry-1")).toEqual({
      warnings: [{ code: "story_point_not_found", message: "The story point was removed." }],
    });

    expect(rollbackTo).toHaveBeenCalledWith(entry.storyPoint);
  });

  it("audioServiceAppliesChannelVolumesThroughRuntimeSettings", async () => {
    const setVolumes = vi.fn();
    const runtime = createInMemoryRuntimeServices({
      getState: createInitialState,
      audio: {
        replayVoice: vi.fn(),
        stopBgm: vi.fn(),
        pauseBgm: vi.fn(),
        resumeBgm: vi.fn(),
        stopVoice: vi.fn(),
        stopAllSfx: vi.fn(),
        setVolumes,
      },
    });

    await runtime.settings.updateSettings({ volumes: { master: 0.5, bgm: 0.8, sfx: 0.25, voice: 1 } });

    expect(setVolumes).toHaveBeenCalledWith({ master: 0.5, bgm: 0.8, sfx: 0.25, voice: 1 });
  });
});
