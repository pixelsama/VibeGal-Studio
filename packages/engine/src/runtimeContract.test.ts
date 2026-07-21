import { describe, expect, it } from "vitest";
import type { ProjectGraphData } from "./types";
import {
  RuntimePersistenceError,
  createReadTextKey,
  createRuntimeSnapshot,
  createSaveSlotRecord,
  createInMemoryRuntimePersistenceAdapter,
  migrateGlobalPersistentRecord,
  migrateSaveSlotRecord,
  replayDecisionLogToNodeId,
} from "./runtimeContract";
import type { NovelState } from "./state";
import { createInitialState } from "./state";

describe("runtime contract", () => {
  it("readTextKeyChangesWhenTextChanges", () => {
    const base = createReadTextKey({ nodeId: "start", instructionId: "line_01", text: "Cafe\u0301\r\nline   " });
    const normalizedEquivalent = createReadTextKey({ nodeId: "start", instructionId: "line_01", text: "Café\nline" });
    const changed = createReadTextKey({ nodeId: "start", instructionId: "line_01", text: "Café\nline!" });

    expect(base).toEqual(normalizedEquivalent);
    expect(changed).not.toEqual(base);
    expect(changed.textHash).not.toBe(base.textHash);
  });

  it("saveSlotDoesNotSerializeTransientEffects", () => {
    const state: NovelState = {
      ...createInitialState(),
      vars: { affection: 3 },
      background: "school",
      backgroundTrans: "dissolve",
      backgroundMs: 900,
      sprites: [
        {
          id: "hero",
          pos: "left",
          expr: "smile",
          changeId: 42,
          justEntered: true,
          prevExpr: "default",
          prevPos: "center",
          trans: "slide",
          leaving: false,
        },
      ],
      effects: [{ id: 99, type: "shake", intensity: 5, ms: 300 }],
      transitions: [{ id: 100, type: "fade_in", ms: 700 }],
      audio: {
        bgm: { id: "theme", fade: 1200, loop: true },
        sfx: [{ id: "click", seq: 7 }],
        voice: { id: "voice_01", seq: 8 },
      },
    };
    const checkpoint = createRuntimeSnapshot(state, {
      currentNodeId: "start",
      currentStoryPoint: { nodeId: "start", instructionId: "line_01" },
    });
    const slot = createSaveSlotRecord({
      projectId: "project",
      now: "2026-07-08T00:00:00.000Z",
      checkpoint,
      decisions: [{ type: "checkpoint", snapshot: checkpoint }],
    });
    const json = JSON.stringify(slot);

    expect(slot.position).toEqual({ nodeId: "start", instructionId: "line_01" });
    expect(slot.checkpoint.sprites).toEqual([{ id: "hero", pos: "left", expr: "smile" }]);
    expect(slot.checkpoint.bgm).toEqual({ id: "theme", loop: true });
    expect(json).not.toContain("effects");
    expect(json).not.toContain("transitions");
    expect(json).not.toContain("seq");
    expect(json).not.toContain("changeId");
    expect(json).not.toContain("justEntered");
  });

  it("decisionLogRestoresChoiceRoute", () => {
    const graph: ProjectGraphData = {
      version: 1,
      entryNodeId: "start",
      nodes: [
        { id: "start", file: "nodes/start.json", position: { x: 0, y: 0 } },
        { id: "stay", file: "nodes/stay.json", position: { x: 100, y: 0 } },
        { id: "leave", file: "nodes/leave.json", position: { x: 100, y: 100 } },
      ],
      edges: [
        { id: "start__stay", from: "start", to: "stay", mode: "choice", label: "留下", condition: null },
        { id: "start__leave", from: "start", to: "leave", mode: "choice", label: "离开", condition: null },
      ],
    };

    expect(
      replayDecisionLogToNodeId(graph, [
        { type: "start", nodeId: "start" },
        { type: "choice", fromNodeId: "start", toNodeId: "leave", edgeId: "start__leave" },
      ]),
    ).toEqual({ nodeId: "leave", warnings: [] });
  });

  it("runtimePersistenceAdapterStoresIndependentRuntimeRecords", async () => {
    const adapter = createInMemoryRuntimePersistenceAdapter();
    const checkpoint = createRuntimeSnapshot({ ...createInitialState(), vars: { route: "a" } }, {
      currentNodeId: "start",
      currentStoryPoint: { nodeId: "start", instructionId: "line_01" },
    });
    const slot = createSaveSlotRecord({
      projectId: "project-a",
      now: "2026-07-08T00:00:00.000Z",
      checkpoint,
      label: "Slot A",
    });

    await adapter.writeSaveSlot("project-a", "slot-1", slot);
    await adapter.writeGlobal("project-a", {
      schemaVersion: 1,
      projectId: "project-a",
      readText: [{ nodeId: "start", instructionId: "line_01", textHash: "hash-a" }],
      unlockedCg: ["cg_01"],
      unlockedMusic: [],
      unlockedEndings: [],
      playthroughCount: 1,
    });
    await adapter.writeSettings("project-a", {
      schemaVersion: 1,
      volumes: { master: 0.5, bgm: 0.4, sfx: 0.3, voice: 0.2 },
    });

    expect(await adapter.listSaveSlots("project-a")).toEqual(["slot-1"]);
    expect(await adapter.readSaveSlot("project-a", "slot-1")).toEqual(slot);
    expect(await adapter.readGlobal("project-a")).toEqual(expect.objectContaining({ unlockedCg: ["cg_01"] }));
    expect((await adapter.readSettings("project-a")).volumes).toEqual({ master: 0.5, bgm: 0.4, sfx: 0.3, voice: 0.2 });

    await adapter.deleteSaveSlot("project-a", "slot-1");

    expect(await adapter.listSaveSlots("project-a")).toEqual([]);
    expect(await adapter.readGlobal("project-a")).toEqual(expect.objectContaining({ unlockedCg: ["cg_01"] }));
  });

  it("saveMigrationRejectsFutureVersion", () => {
    expect(() => migrateSaveSlotRecord({ schemaVersion: 999, projectId: "project-a" })).toThrow(RuntimePersistenceError);
    expect(() => migrateSaveSlotRecord({ schemaVersion: 999, projectId: "project-a" })).toThrow(
      expect.objectContaining({ code: "runtime_record_future_version" }),
    );
  });

  it("migrates v1 runtime records deterministically to v2", () => {
    const checkpoint = createRuntimeSnapshot(createInitialState(), { currentNodeId: "start", currentStoryPoint: null });
    const legacy = { ...createSaveSlotRecord({ projectId: "project-a", now: "2026-01-01T00:00:00Z", checkpoint }), schemaVersion: 1 };
    delete (legacy.checkpoint as Partial<typeof legacy.checkpoint>).playthroughId;
    const first = migrateSaveSlotRecord(legacy);
    const second = migrateSaveSlotRecord(legacy);
    expect(first.schemaVersion).toBe(2);
    expect(first.checkpoint.playthroughId).toBe(second.checkpoint.playthroughId);

    expect(migrateGlobalPersistentRecord({
      schemaVersion: 1,
      projectId: "project-a",
      readText: [], unlockedCg: [], unlockedMusic: [], unlockedEndings: [], playthroughCount: 3,
    })).toMatchObject({ schemaVersion: 2, playthroughCount: 3, globalVars: {}, lastEndingId: null });
  });
});
