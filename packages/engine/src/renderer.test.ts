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
      endings: [],
    });
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
