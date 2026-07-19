import { describe, expect, it } from "vitest";
import type { Instruction } from "@vibegal/engine";
import {
  mergeAssignedInstructionIdentities,
  projectInstructionsWithoutStoryPointIds,
  reconcileScenarioInstructionIdentities,
} from "./instructionIdentity";

describe("projectInstructionsWithoutStoryPointIds", () => {
  it("strips only machine-managed story-point ids without mutating the input", () => {
    const original = [
      { t: "bg", id: "room" },
      { t: "say", id: "say_1", who: "hero", text: "Hello" },
      { t: "narrate", id: "narrate_1", text: "Wind" },
      { t: "wait", id: "wait_1", ms: 500 },
      { t: "pause", id: "pause_1" },
    ] as Instruction[];

    expect(projectInstructionsWithoutStoryPointIds(original)).toEqual([
      { t: "bg", id: "room" },
      { t: "say", who: "hero", text: "Hello" },
      { t: "narrate", text: "Wind" },
      { t: "wait", ms: 500 },
      { t: "pause" },
    ]);
    expect(original[1]).toHaveProperty("id", "say_1");
  });
});

describe("reconcileScenarioInstructionIdentities", () => {
  it("inherits ids for unique exact semantic matches after a move", () => {
    const previous = [
      { t: "say", id: "say_a", who: "hero", text: "A" },
      { t: "narrate", id: "narrate_b", text: "B" },
    ] as Instruction[];
    const parsed = [
      { t: "narrate", text: "B" },
      { t: "say", who: "hero", text: "A" },
    ] as Instruction[];

    expect(reconcileScenarioInstructionIdentities(previous, parsed)).toEqual([
      { t: "narrate", id: "narrate_b", text: "B" },
      { t: "say", id: "say_a", who: "hero", text: "A" },
    ]);
  });

  it("inherits ids by relative order inside an anchored edit region", () => {
    const previous = [
      { t: "bg", id: "room" },
      { t: "say", id: "say_a", who: "hero", text: "Before" },
      { t: "wait", id: "wait_a", ms: 500 },
      { t: "showCg", id: "ending" },
    ] as Instruction[];
    const parsed = [
      { t: "bg", id: "room" },
      { t: "say", who: "hero", text: "After" },
      { t: "wait", ms: 750 },
      { t: "showCg", id: "ending" },
    ] as Instruction[];

    expect(reconcileScenarioInstructionIdentities(previous, parsed)).toEqual([
      { t: "bg", id: "room" },
      { t: "say", id: "say_a", who: "hero", text: "After" },
      { t: "wait", id: "wait_a", ms: 750 },
      { t: "showCg", id: "ending" },
    ]);
  });

  it("keeps inserted content idless while preserving exact surrounding identities", () => {
    const previous = [
      { t: "say", id: "say_a", who: "hero", text: "A" },
      { t: "say", id: "say_b", who: "hero", text: "B" },
    ] as Instruction[];
    const parsed = [
      { t: "say", who: "hero", text: "A" },
      { t: "narrate", text: "New" },
      { t: "say", who: "hero", text: "B" },
    ] as Instruction[];

    expect(reconcileScenarioInstructionIdentities(previous, parsed)).toEqual([
      { t: "say", id: "say_a", who: "hero", text: "A" },
      { t: "narrate", text: "New" },
      { t: "say", id: "say_b", who: "hero", text: "B" },
    ]);
  });

  it("inherits ids by relative order for an equal-length same-type rewrite", () => {
    const previous = [
      { t: "say", id: "say_a", who: "hero", text: "A" },
      { t: "say", id: "say_b", who: "hero", text: "B" },
    ] as Instruction[];
    const parsed = [
      { t: "say", who: "hero", text: "B changed" },
      { t: "say", who: "hero", text: "A changed" },
    ] as Instruction[];

    expect(reconcileScenarioInstructionIdentities(previous, parsed)).toEqual([
      { t: "say", id: "say_a", who: "hero", text: "B changed" },
      { t: "say", id: "say_b", who: "hero", text: "A changed" },
    ]);
  });

  it("does not guess which identical copy owns an id", () => {
    const previous = [{ t: "narrate", id: "narrate_a", text: "Same" }] as Instruction[];
    const parsed = [
      { t: "narrate", text: "Same" },
      { t: "narrate", text: "Same" },
    ] as Instruction[];

    expect(reconcileScenarioInstructionIdentities(previous, parsed)).toEqual(parsed);
  });

  it("preserves identities when scenario undo restores an earlier semantic sequence", () => {
    const previous = [
      { t: "narrate", id: "narrate_a", text: "A" },
      { t: "wait", id: "wait_a", ms: 500 },
    ] as Instruction[];
    const edited = reconcileScenarioInstructionIdentities(previous, [
      { t: "narrate", text: "A changed" },
      { t: "wait", ms: 750 },
    ] as Instruction[]);

    expect(reconcileScenarioInstructionIdentities(edited, [
      { t: "narrate", text: "A" },
      { t: "wait", ms: 500 },
    ] as Instruction[])).toEqual(previous);
  });

  it("keeps identities stable across scenario-json-scenario projection", () => {
    const previous = [
      { t: "say", id: "say_a", who: "hero", text: "Hello" },
      { t: "pause", id: "pause_a" },
    ] as Instruction[];
    const projected = projectInstructionsWithoutStoryPointIds(previous);

    expect(reconcileScenarioInstructionIdentities(previous, projected)).toEqual(previous);
  });

  it("merges backend-assigned ids into a scenario draft that changed while saving", () => {
    const saved = [
      { t: "say", id: "sp_saved_say", who: "hero", text: "Before" },
      { t: "narrate", id: "sp_saved_narrate", text: "Still here" },
    ] as Instruction[];
    const continuedDraft = [
      { t: "say", who: "hero", text: "After" },
      { t: "narrate", text: "Still here" },
      { t: "wait", ms: 500 },
    ] as Instruction[];

    expect(mergeAssignedInstructionIdentities(saved, [
      { id: "sp_saved_say" },
      { id: "sp_saved_narrate" },
    ], continuedDraft)).toEqual([
      { t: "say", id: "sp_saved_say", who: "hero", text: "After" },
      { t: "narrate", id: "sp_saved_narrate", text: "Still here" },
      { t: "wait", ms: 500 },
    ]);
  });

  it("does not replace an explicit non-empty id in the newer draft", () => {
    const saved = [
      { t: "narrate", id: "sp_backend", text: "Line" },
    ] as Instruction[];
    const jsonDraft = [
      { t: "narrate", id: "sp_explicit", text: "Line" },
    ] as Instruction[];

    expect(reconcileScenarioInstructionIdentities(saved, jsonDraft)).toEqual(jsonDraft);
  });

  it("merges only ids assigned by the in-flight save into a newer JSON draft", () => {
    const saved = [
      { t: "narrate", id: "sp_existing", text: "Existing" },
      { t: "narrate", id: "sp_backend", text: "New" },
    ] as Instruction[];
    const jsonDraft = [
      { t: "narrate", text: "Existing changed" },
      { t: "narrate", id: "sp_explicit", text: "New" },
    ] as Instruction[];

    expect(mergeAssignedInstructionIdentities(saved, [
      { id: "sp_backend" },
    ], jsonDraft)).toEqual(jsonDraft);
  });

  it("restores an assigned id after a newer JSON draft is reparsed", () => {
    const saved = [
      { t: "narrate", id: "sp_backend", text: "New line" },
    ] as Instruction[];
    const reparsedDraft = [
      { t: "narrate", text: "New line edited again" },
    ] as Instruction[];

    expect(mergeAssignedInstructionIdentities(saved, [
      { id: "sp_backend" },
    ], reparsedDraft)).toEqual([
      { t: "narrate", id: "sp_backend", text: "New line edited again" },
    ]);
  });

  it("restores an assigned id after scenario undo returns an older idless snapshot", () => {
    const saved = [
      { t: "narrate", id: "sp_backend", text: "New line" },
    ] as Instruction[];
    const undoneSnapshot = [
      { t: "narrate", text: "New line" },
    ] as Instruction[];

    const reconciled = reconcileScenarioInstructionIdentities(undoneSnapshot, undoneSnapshot);
    expect(mergeAssignedInstructionIdentities(saved, [
      { id: "sp_backend" },
    ], reconciled)).toEqual(saved);
  });

  it("does not mutate either input", () => {
    const previous = [{ t: "narrate", id: "narrate_a", text: "Before" }] as Instruction[];
    const parsed = [{ t: "narrate", text: "After" }] as Instruction[];

    const result = reconcileScenarioInstructionIdentities(previous, parsed);

    expect(previous[0]).toEqual({ t: "narrate", id: "narrate_a", text: "Before" });
    expect(parsed[0]).toEqual({ t: "narrate", text: "After" });
    expect(result).not.toBe(parsed);
  });
});
