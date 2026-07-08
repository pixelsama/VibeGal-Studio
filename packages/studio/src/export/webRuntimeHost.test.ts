import { describe, expect, it } from "vitest";
import type { Instruction, ProjectGraphData } from "@galstudio/engine";
import {
  createWebRuntimePlayer,
  createWebStorageAdapter,
  defaultRuntimeSettings,
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

const manifest = {
  characters: {},
  backgrounds: {},
  audio: { bgm: {}, sfx: {}, voice: {} },
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

    runtime.dispose();
  });
});
