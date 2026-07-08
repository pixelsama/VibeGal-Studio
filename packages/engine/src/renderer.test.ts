import { describe, expect, it, vi } from "vitest";
import { createInitialState } from "./state";
import {
  RENDERER_CONTRACT_VERSION,
  createInMemoryRuntimeServices,
  validateRendererManifestContract,
  type BacklogEntry,
  type RendererProps,
  type RuntimeSettingsRecord,
} from "./renderer";
import { createInMemoryRuntimePersistenceAdapter, createRuntimeSnapshot, createSaveSlotRecord } from "./runtimeContract";

function Component() {
  return null;
}

describe("renderer contract", () => {
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

  it("historyServiceReturnsBacklogEntriesWithStoryPoint", () => {
    const entry: BacklogEntry = {
      id: "entry-1",
      storyPoint: { nodeId: "start", instructionId: "line_01" },
      speakerName: "Akari",
      text: "今天也很安静呢。",
      readKey: { nodeId: "start", instructionId: "line_01", textHash: "line-hash" },
    };
    const rollbackTo = vi.fn();
    const runtime = createInMemoryRuntimeServices({
      getState: createInitialState,
      initialBacklog: [entry],
      rollbackTo,
    });

    expect(runtime.history.getBacklog()).toEqual([entry]);
    runtime.history.rollbackTo("entry-1");

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
