import { afterEach, describe, expect, it, vi } from "vitest";
import type { Instruction, ProjectGraphData } from "@vibegal/engine";
import {
  createWebRuntimePlayer,
  createWebStorageAdapter,
  defaultRuntimeSettings,
  resetWebRuntimeSmokeStorage,
  runtimeStorageProjectId,
  runWebRuntimeBehaviorSmoke,
  storyProgressFingerprint,
  type StorageLike,
} from "./webRuntimeHost";

class MemoryStorage implements StorageLike {
  private data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }
}

class ThrowingStorage implements StorageLike {
  getItem(): string | null {
    throw new Error("storage blocked");
  }

  setItem(): void {
    throw new Error("storage blocked");
  }

  removeItem(): void {
    throw new Error("storage blocked");
  }
}

const manifest = {
  characters: {},
  backgrounds: { school: "school.png" },
  audio: { bgm: {}, sfx: {}, voice: {} },
  cg: { cg_001: "cg_001.png" },
  videos: { op: "op.mp4" },
  unlocks: {
    cg: { cg_rooftop: { assetId: "cg_001", title: "Rooftop" } },
    music: {},
    replay: {},
    endings: {},
  },
};

const meta = {
  title: "Export Test",
  typingSpeedCps: 30,
  autoAdvanceMs: 1200,
  chapterGapMs: 0,
};

function runtimeGraph(edges: ProjectGraphData["edges"]): ProjectGraphData {
  return {
    version: 1,
    entryNodeId: "start",
    nodes: [
      { id: "start", title: "Start", file: "nodes/start.json", position: { x: 0, y: 0 } },
      { id: "middle", title: "Middle", file: "nodes/middle.json", position: { x: 200, y: 0 } },
      { id: "left", title: "Left", file: "nodes/left.json", position: { x: 200, y: 100 } },
      { id: "right", title: "Right", file: "nodes/right.json", position: { x: 200, y: 200 } },
    ],
    edges,
  };
}

function node(id: string, text: string): { id: string; instructions: Instruction[] } {
  return { id, instructions: [{ t: "narrate", text }] };
}

describe("web export runtime host", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("webRuntimeDefaultsMatchTheContractsSettingsDefaults", () => {
    expect(defaultRuntimeSettings()).toEqual({
      schemaVersion: 2,
      volumes: { master: 1, bgm: 0.8, sfx: 1, voice: 1 },
    });
  });

  it("webRuntimeRejectsFutureSettingsWithoutOverwritingStorage", () => {
    const storage = new MemoryStorage();
    const raw = JSON.stringify({ schemaVersion: 999, volumes: { master: 1, bgm: 1, sfx: 1, voice: 1 } });
    storage.setItem("vibegal:project-a:settings", raw);
    const adapter = createWebStorageAdapter("project-a", storage);

    expect(() => createWebRuntimePlayer({
      meta,
      manifest,
      graph: runtimeGraph([]),
      nodes: [node("start", "start")],
      contentBase: "./content",
      projectId: "project-a",
      storage: adapter,
    })).toThrow(expect.objectContaining({ code: "runtime_record_future_version" }));
    expect(storage.getItem("vibegal:project-a:settings")).toBe(raw);
  });

  it("webRuntimeFollowsLinearRoute", () => {
    const runtime = createWebRuntimePlayer({
      meta,
      manifest,
      graph: runtimeGraph([{ id: "start__middle", from: "start", to: "middle", mode: "linear", label: null, condition: null }]),
      nodes: [node("start", "start"), node("middle", "middle")],
      contentBase: "./content",
    });

    runtime.advance();
    runtime.advance();
    runtime.advance();

    expect(runtime.getState().narration?.text).toBe("middle");
    runtime.dispose();
  });

  it("webRuntimeHandlesChoiceRoute", () => {
    const runtime = createWebRuntimePlayer({
      meta,
      manifest,
      graph: runtimeGraph([
        { id: "start__left", from: "start", to: "left", mode: "choice", label: "Left", condition: null },
        { id: "start__right", from: "start", to: "right", mode: "choice", label: "Right", condition: null },
      ]),
      nodes: [node("start", "start"), node("left", "left"), node("right", "right")],
      contentBase: "./content",
    });

    runtime.advance();
    runtime.advance();
    runtime.advance();
    expect(runtime.getState().choice?.choices).toEqual([
      { text: "Left", to: "left" },
      { text: "Right", to: "right" },
    ]);

    runtime.choose("right");

    expect(runtime.getState().choice).toBeNull();
    expect(runtime.getState().narration?.text).toBe("right");
    runtime.dispose();
  });

  it("webRuntimePersistsSettingsSeparatelyFromSaveSlot", async () => {
    const storage = new MemoryStorage();
    const adapter = createWebStorageAdapter("project-a", storage);
    const settings = { ...defaultRuntimeSettings(), autoAdvanceMs: 800 };
    const saveSlot = { schemaVersion: 1, projectId: "project-a", label: "slot one" };
    const global = { schemaVersion: 1, projectId: "project-a", playthroughCount: 2 };

    await adapter.setSaveSlot("slot-1", saveSlot);
    await adapter.setGlobalPersistent(global);
    await adapter.setSettings(settings);

    expect(await adapter.listSaveSlots()).toEqual(["slot-1"]);
    expect(await adapter.getSaveSlot("slot-1")).toEqual(saveSlot);
    expect(await adapter.getGlobalPersistent()).toEqual(global);
    expect(await adapter.getSettings()).toEqual(settings);

    await adapter.deleteSaveSlot("slot-1");

    expect(await adapter.getSaveSlot("slot-1")).toBeNull();
    expect(await adapter.listSaveSlots()).toEqual([]);
    expect(await adapter.getGlobalPersistent()).toEqual(global);
    expect(await adapter.getSettings()).toEqual(settings);
  });

  it("webStorageFallsBackToMemoryWhenStorageMethodsThrow", async () => {
    const adapter = createWebStorageAdapter("project-a", new ThrowingStorage());
    const slot = { schemaVersion: 1, projectId: "project-a", label: "fallback slot" };

    await adapter.setSaveSlot("slot-1", slot);

    expect(await adapter.listSaveSlots()).toEqual(["slot-1"]);
    expect(await adapter.getSaveSlot("slot-1")).toEqual(slot);
    expect(adapter.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("runtime storage"),
    ]));
  });

  it("webRuntimeServicesUseStorageAdapter", async () => {
    const storage = new MemoryStorage();
    const adapter = createWebStorageAdapter("project-a", storage);
    const runtime = createWebRuntimePlayer({
      meta,
      manifest,
      graph: runtimeGraph([{ id: "start__middle", from: "start", to: "middle", mode: "linear", label: null, condition: null }]),
      nodes: [node("start", "start"), node("middle", "middle")],
      contentBase: "./content",
      projectId: "project-a",
      storage: adapter,
    });
    const services = runtime.rendererProps().runtime;
    expect(services).toBeTruthy();

    await services!.settings.updateSettings({ volumes: { master: 0.6, bgm: 0.5, sfx: 0.4, voice: 0.3 } });
    await services!.save.save("slot-1", { label: "Slot 1" });
    await services!.persistent.unlock("cg", "cg_001");

    expect((await adapter.getSettings()).volumes).toEqual({ master: 0.6, bgm: 0.5, sfx: 0.4, voice: 0.3 });
    expect(await adapter.listSaveSlots()).toEqual(["slot-1"]);
    expect(await adapter.getSaveSlot("slot-1")).toEqual(expect.objectContaining({ projectId: "project-a", label: "Slot 1" }));
    expect(await adapter.getGlobalPersistent()).toEqual(expect.objectContaining({ unlockedCg: ["cg_001"] }));

    await services!.save.delete("slot-1");

    expect(await adapter.listSaveSlots()).toEqual([]);
    expect(await adapter.getSaveSlot("slot-1")).toBeNull();
    expect(await adapter.getGlobalPersistent()).toEqual(expect.objectContaining({ unlockedCg: ["cg_001"] }));

    runtime.dispose();
  });

  it("webRuntimeAppliesPersistedTimingBeforeTheFirstLine", async () => {
    vi.useFakeTimers();
    try {
      const storage = new MemoryStorage();
      const adapter = createWebStorageAdapter("project-a", storage);
      await adapter.setSettings({
        ...defaultRuntimeSettings(),
        textSpeedCps: 10,
        autoAdvanceMs: 250,
      });
      const runtime = createWebRuntimePlayer({
        meta: { ...meta, typingSpeedCps: 1, autoAdvanceMs: 5_000 },
        manifest,
        graph: runtimeGraph([]),
        nodes: [node("start", "abcd")],
        contentBase: "./content",
        projectId: "project-a",
        storage: adapter,
      });

      runtime.advance();
      await vi.advanceTimersByTimeAsync(100);

      expect(runtime.getState().narration?.typedLen).toBe(1);
      expect(runtime.rendererProps().runtime?.settings.getSettings()).toEqual(expect.objectContaining({
        textSpeedCps: 10,
        autoAdvanceMs: 250,
      }));
      runtime.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("resetWebRuntimeSmokeStorageClearsOnlyTheSmokeProjectRuntimeData", () => {
    const storage = new MemoryStorage();
    storage.setItem("vibegal:project-a:saveIndex", JSON.stringify(["quick", "manual-01"]));
    storage.setItem("vibegal:project-a:save:quick", "quick");
    storage.setItem("vibegal:project-a:save:manual-01", "manual");
    storage.setItem("vibegal:project-a:global", "global");
    storage.setItem("vibegal:project-a:settings", "settings");
    storage.setItem("vibegal:project-b:saveIndex", JSON.stringify(["quick"]));

    resetWebRuntimeSmokeStorage("project-a", storage);

    expect(storage.getItem("vibegal:project-a:saveIndex")).toBeNull();
    expect(storage.getItem("vibegal:project-a:save:quick")).toBeNull();
    expect(storage.getItem("vibegal:project-a:save:manual-01")).toBeNull();
    expect(storage.getItem("vibegal:project-a:global")).toBeNull();
    expect(storage.getItem("vibegal:project-a:settings")).toBeNull();
    expect(storage.getItem("vibegal:project-b:saveIndex")).not.toBeNull();
  });

  it("runtimeStorageProjectIdIsolatesSmokeDataFromRealPlayerSaves", () => {
    expect(runtimeStorageProjectId("project-a", false)).toBe("project-a");
    expect(runtimeStorageProjectId("project-a", true)).toBe("project-a:__smoke__");
  });

  it("storyProgressFingerprintIgnoresOnlyNaturalTypewriterProgress", () => {
    const runtime = createWebRuntimePlayer({
      meta,
      manifest,
      graph: runtimeGraph([]),
      nodes: [node("start", "typing")],
      contentBase: "./content",
    });
    runtime.advance();
    const initial = runtime.getState();
    const typingAdvanced = {
      ...initial,
      narration: { ...initial.narration!, typedLen: 1 },
    };
    const storyAdvanced = {
      ...typingAdvanced,
      narration: { ...typingAdvanced.narration, text: "next line" },
    };

    expect(storyProgressFingerprint(typingAdvanced)).toBe(storyProgressFingerprint(initial));
    expect(storyProgressFingerprint(storyAdvanced)).not.toBe(storyProgressFingerprint(initial));
    runtime.dispose();
  });

  it("webRuntimeAppliesPersistedVoiceVolumeBeforeTheFirstVoice", async () => {
    class FakeAudio {
      static instances: FakeAudio[] = [];
      loop = false;
      muted = false;
      volume = 1;
      readonly play = vi.fn(async () => {});
      readonly pause = vi.fn();
      readonly remove = vi.fn();

      constructor(readonly src: string) {
        FakeAudio.instances.push(this);
      }

      addEventListener() {}
    }
    vi.stubGlobal("Audio", FakeAudio);
    const storage = new MemoryStorage();
    const adapter = createWebStorageAdapter("project-a", storage);
    await adapter.setSettings({
      ...defaultRuntimeSettings(),
      volumes: { master: 0.5, bgm: 0.7, sfx: 0.6, voice: 0.4 },
    });
    const runtime = createWebRuntimePlayer({
      meta,
      manifest: {
        ...manifest,
        audio: { bgm: {}, sfx: {}, voice: { greeting: "voice/greeting.ogg" } },
      },
      graph: runtimeGraph([]),
      nodes: [{
        id: "start",
        instructions: [
          { t: "voice", id: "greeting" },
          { t: "narrate", id: "line_01", text: "hello" },
        ],
      }],
      contentBase: "./content",
      projectId: "project-a",
      storage: adapter,
    });

    runtime.advance();

    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].src).toContain("voice/greeting.ogg");
    expect(FakeAudio.instances[0].volume).toBeCloseTo(0.2);
    runtime.dispose();
  });

  it("webRuntimeWritesNodeAndChoiceAutoSaveSlotsOncePerStablePoint", async () => {
    const storage = new MemoryStorage();
    const adapter = createWebStorageAdapter("project-a", storage);
    const writeSaveSlot = vi.spyOn(adapter, "writeSaveSlot");
    const runtime = createWebRuntimePlayer({
      meta,
      manifest,
      graph: runtimeGraph([
        { id: "start__left", from: "start", to: "left", mode: "choice", label: "Left", condition: null },
        { id: "start__right", from: "start", to: "right", mode: "choice", label: "Right", condition: null },
      ]),
      nodes: [node("start", "start"), node("left", "left"), node("right", "right")],
      contentBase: "./content",
      projectId: "project-a",
      storage: adapter,
    });

    runtime.advance();
    await vi.waitFor(() => expect(writeSaveSlot).toHaveBeenCalledTimes(1));
    runtime.advance();
    runtime.advance();
    runtime.choose("right");
    await vi.waitFor(() => expect(writeSaveSlot).toHaveBeenCalledTimes(3));

    expect(writeSaveSlot.mock.calls.map(([, slotId]) => slotId)).toEqual([
      "auto:node",
      "auto:node",
      "auto:choice",
    ]);

    const snapshot = await adapter.readSaveSlot("project-a", "auto:choice");
    expect(snapshot?.preview).toEqual({ text: "right", background: null });
    await runtime.rendererProps().runtime?.save.load("auto:choice");
    runtime.rendererProps().controls.rollbackTo(snapshot!.position!);
    expect(writeSaveSlot).toHaveBeenCalledTimes(3);
    runtime.dispose();
  });

  it("autoSaveFailureDoesNotBlockPlaybackAndPublishesAStatusNotice", async () => {
    const adapter = createWebStorageAdapter("project-a", new MemoryStorage());
    vi.spyOn(adapter, "writeSaveSlot").mockRejectedValueOnce(new Error("quota exceeded"));
    const runtime = createWebRuntimePlayer({
      meta,
      manifest,
      graph: runtimeGraph([]),
      nodes: [{ id: "start", instructions: [{ t: "narrate", id: "line_01", text: "still playable" }] }],
      contentBase: "./content",
      projectId: "project-a",
      storage: adapter,
    });

    runtime.advance();
    await vi.waitFor(() => expect(runtime.rendererProps().runtime?.status?.getNotices()).toEqual([
      expect.objectContaining({ code: "runtime_auto_save_failed", level: "error" }),
    ]));

    expect(runtime.getState().narration?.text).toBe("still playable");
    runtime.dispose();
  });

  it("memoryStorageFallbackIsVisibleThroughRuntimeStatus", () => {
    const adapter = createWebStorageAdapter("project-a", null);
    const runtime = createWebRuntimePlayer({
      meta,
      manifest,
      graph: runtimeGraph([]),
      nodes: [node("start", "start")],
      contentBase: "./content",
      projectId: "project-a",
      storage: adapter,
    });

    expect(runtime.rendererProps().runtime?.status?.getNotices()).toEqual([
      expect.objectContaining({ code: "runtime_storage_fallback", level: "warning" }),
    ]);
    runtime.dispose();
  });

  it("webRuntimeDoesNotExposeDebugService", () => {
    const runtime = createWebRuntimePlayer({
      meta,
      manifest,
      graph: runtimeGraph([]),
      nodes: [node("start", "start")],
      contentBase: "./content",
      projectId: "project-a",
      storage: createWebStorageAdapter("project-a", new MemoryStorage()),
    });

    expect(runtime.rendererProps().runtime?.debug).toBeUndefined();
    runtime.dispose();
  });

  it("webRuntimeSavePersistsAcrossRuntimeInstances", async () => {
    const storage = new MemoryStorage();
    const graph = runtimeGraph([
      { id: "start__middle", from: "start", to: "middle", mode: "linear", label: null, condition: null },
    ]);
    const nodes = [
      { id: "start", instructions: [
        { t: "bg", id: "school", trans: "cut", ms: 0 },
        { t: "narrate", id: "line_01", text: "saved line" },
      ] satisfies Instruction[] },
      node("middle", "middle"),
    ];
    const firstRuntime = createWebRuntimePlayer({
      meta,
      manifest,
      graph,
      nodes,
      contentBase: "./content",
      projectId: "project-a",
      storage: createWebStorageAdapter("project-a", storage),
    });
    firstRuntime.advance();
    await firstRuntime.rendererProps().runtime!.save.save("slot-1", { label: "Slot 1" });
    firstRuntime.dispose();

    const secondRuntime = createWebRuntimePlayer({
      meta,
      manifest,
      graph,
      nodes,
      contentBase: "./content",
      projectId: "project-a",
      storage: createWebStorageAdapter("project-a", storage),
    });

    await expect(secondRuntime.rendererProps().runtime!.save.listSlots()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ slotId: "slot-1", label: "Slot 1" }),
    ]));
    await expect(secondRuntime.rendererProps().runtime!.save.load("slot-1")).resolves.toEqual({ slotId: "slot-1", warnings: [] });
    expect(secondRuntime.getState().background).toBe("school");
    expect(secondRuntime.getState().narration?.text).toBe("saved line");
    secondRuntime.dispose();
  });

  it("webRuntimeControlsExposePlaybackSkipAndRollback", async () => {
    vi.useFakeTimers();
    try {
      const runtime = createWebRuntimePlayer({
        meta,
        manifest,
        graph: runtimeGraph([
          { id: "start__left", from: "start", to: "left", mode: "choice", label: "Left", condition: null },
          { id: "start__right", from: "start", to: "right", mode: "choice", label: "Right", condition: null },
        ]),
        nodes: [
          { id: "start", instructions: [
            { t: "narrate", id: "line_01", text: "first" },
            { t: "narrate", id: "line_02", text: "second" },
          ] },
          node("left", "left"),
          node("right", "right"),
        ],
        contentBase: "./content",
      });

      runtime.advance();
      runtime.advance();
      runtime.advance();
      expect(runtime.getState().narration?.text).toBe("second");

      runtime.rendererProps().controls.rollbackTo({ nodeId: "start", instructionId: "line_01" });
      expect(runtime.getState().narration?.text).toBe("first");

      runtime.rendererProps().controls.setSkipMode("all");
      await vi.runAllTimersAsync();

      expect(runtime.getState().choice?.choices).toEqual([
        { text: "Left", to: "left" },
        { text: "Right", to: "right" },
      ]);
      runtime.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("webRuntimeHistoryUsesThePlayerBacklogAndRollsBackWithoutAdvancing", async () => {
    const runtime = createWebRuntimePlayer({
      meta,
      manifest: {
        ...manifest,
        audio: { bgm: {}, sfx: {}, voice: { lineVoice: "voice/line.ogg" } },
      },
      graph: runtimeGraph([]),
      nodes: [{
        id: "start",
        instructions: [
          { t: "voice", id: "lineVoice" },
          { t: "narrate", id: "line_01", text: "first" },
          { t: "narrate", id: "line_02", text: "second" },
        ],
      }],
      contentBase: "./content",
    });
    runtime.advance();
    runtime.advance();
    runtime.advance();
    const history = runtime.rendererProps().runtime!.history;
    const entries = history.getBacklog();

    expect(entries).toHaveLength(2);
    const beforeReplay = runtime.getState();
    history.replayVoice(entries[0].id);
    expect(runtime.getState()).toEqual(beforeReplay);

    await expect(Promise.resolve().then(() => history.rollbackTo(entries[0].id))).resolves.toEqual({ warnings: [] });
    expect(runtime.getState().narration?.text).toBe("first");
    runtime.dispose();
  });

  it("webRuntimePersistsUnlocksAcrossReload", async () => {
    const storage = new MemoryStorage();
    const firstRuntime = createWebRuntimePlayer({
      meta,
      manifest,
      graph: runtimeGraph([]),
      nodes: [{ id: "start", instructions: [{ t: "unlock", kind: "cg", id: "cg_rooftop" }] }],
      contentBase: "./content",
      projectId: "project-a",
      storage: createWebStorageAdapter("project-a", storage),
    });

    firstRuntime.advance();
    await Promise.resolve();
    firstRuntime.dispose();

    const secondRuntime = createWebRuntimePlayer({
      meta,
      manifest,
      graph: runtimeGraph([]),
      nodes: [node("start", "start")],
      contentBase: "./content",
      projectId: "project-a",
      storage: createWebStorageAdapter("project-a", storage),
    });

    expect(secondRuntime.rendererProps().runtime?.gallery.isUnlocked("cg", "cg_rooftop")).toBe(true);
    expect(secondRuntime.rendererProps().runtime?.gallery.listCg()).toEqual([
      { id: "cg_rooftop", assetId: "cg_001", title: "Rooftop", asset: { path: "cg_001.png" } },
    ]);
    secondRuntime.dispose();
  });

  it("webRuntimeStartsUnlockedReplayFromTheRuntimeService", async () => {
    const runtime = createWebRuntimePlayer({
      meta,
      manifest: {
        ...manifest,
        unlocks: {
          cg: {},
          music: {},
          replay: { replay_opening: { nodeId: "replay_start", title: "Opening Replay" } },
          endings: {},
        },
      },
      graph: runtimeGraph([]),
      nodes: [
        node("start", "start"),
        { id: "replay_start", instructions: [{ t: "narrate", id: "replay_01", text: "replay line" }] },
      ],
      contentBase: "./content",
    });
    const services = runtime.rendererProps().runtime!;
    await services.persistent.unlock("replay", "replay_opening");

    await expect(Promise.resolve(services.replay.start("replay_opening"))).resolves.toEqual({ warnings: [] });

    expect(runtime.getState().narration?.text).toBe("replay line");
    runtime.dispose();
  });

  it("webRuntimeMusicRoomServicePlaysTheRequestedBgmAsset", () => {
    class FakeAudio {
      static instances: FakeAudio[] = [];
      loop = false;
      muted = false;
      volume = 1;
      readonly play = vi.fn(async () => {});
      readonly pause = vi.fn();
      readonly remove = vi.fn();

      constructor(readonly src: string) {
        FakeAudio.instances.push(this);
      }

      addEventListener() {}
    }
    vi.stubGlobal("Audio", FakeAudio);
    const runtime = createWebRuntimePlayer({
      meta,
      manifest: {
        ...manifest,
        audio: { bgm: { theme: "audio/theme.ogg" }, sfx: {}, voice: {} },
        unlocks: {
          cg: {},
          music: { music_theme: { audioId: "theme", title: "Theme" } },
          replay: {},
          endings: {},
        },
      },
      graph: runtimeGraph([]),
      nodes: [node("start", "start")],
      contentBase: "./content",
    });
    const services = runtime.rendererProps().runtime!;

    services.audio.playMusic("theme", { loop: false, fadeMs: 0 });

    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].src).toContain("audio/theme.ogg");
    expect(FakeAudio.instances[0].loop).toBe(false);
    runtime.dispose();
  });

  it("behavior smoke advances, saves and loads a configured media asset", async () => {
    const runtime = createWebRuntimePlayer({
      meta,
      manifest,
      graph: runtimeGraph([]),
      nodes: [node("start", "start")],
      contentBase: "./content",
      projectId: "smoke-project",
      storage: createWebStorageAdapter("smoke-project", new MemoryStorage()),
    });
    const fetcher = vi.fn(async () => new Response("image", { status: 200 }));

    const result = await runWebRuntimeBehaviorSmoke(runtime, fetcher);

    expect(result).toEqual(expect.objectContaining({
      advanced: true,
      saveRoundTrip: true,
      media: "loaded",
    }));
    expect(fetcher).toHaveBeenCalledWith("./content/cg_001.png");
    runtime.dispose();
  });

  it("loadSaveDoesNotRollbackUnlocks", async () => {
    const storage = new MemoryStorage();
    const adapter = createWebStorageAdapter("project-a", storage);
    const runtime = createWebRuntimePlayer({
      meta,
      manifest,
      graph: runtimeGraph([]),
      nodes: [node("start", "start")],
      contentBase: "./content",
      projectId: "project-a",
      storage: adapter,
    });
    const services = runtime.rendererProps().runtime!;

    await services.save.save("slot-1");
    await services.persistent.unlock("cg", "cg_rooftop");
    await services.save.load("slot-1");

    expect(services.gallery.isUnlocked("cg", "cg_rooftop")).toBe(true);
    expect(await adapter.getGlobalPersistent()).toEqual(expect.objectContaining({ unlockedCg: ["cg_rooftop"] }));
    runtime.dispose();
  });
});
