import { describe, expect, it } from "vitest";
import type { Instruction } from "@vibegal/engine";
import {
  deleteInstruction,
  duplicateInstruction,
  insertInstruction,
  moveInstruction,
  parseInstructionDraft,
  serializeInstructionDraft,
  updateInstruction,
} from "./instructionEditing";

describe("parseInstructionDraft", () => {
  it("accepts array", () => {
    const result = parseInstructionDraft('[{"t":"wait","ms":1200}]');

    expect(result).toEqual({
      ok: true,
      instructions: [{ t: "wait", ms: 1200 }],
    });
  });

  it("rejects object", () => {
    const result = parseInstructionDraft('{"t":"wait","ms":1200}');

    expect(result.ok).toBe(false);
    expect(result.error).toContain("JSON 数组");
  });
});

describe("updateInstruction", () => {
  it("does not mutate original", () => {
    const original = [
      { t: "say", who: "hero", expr: "default", text: "你好。" },
      { t: "wait", ms: 500 },
    ] as Instruction[];

    const next = updateInstruction(original, 0, { text: "更新后" });

    expect(next).toEqual([
      { t: "say", who: "hero", expr: "default", text: "更新后" },
      { t: "wait", ms: 500 },
    ]);
    expect(original).toEqual([
      { t: "say", who: "hero", expr: "default", text: "你好。" },
      { t: "wait", ms: 500 },
    ]);
    expect(next[0]).not.toBe(original[0]);
    expect(next[1]).toBe(original[1]);
  });

  it("preserves a story-point id even when the patch contains another id", () => {
    const original = [{ t: "say", id: "say_original", who: "hero", text: "Before" }] as Instruction[];

    const next = updateInstruction(original, 0, { id: "say_replacement", text: "After" } as Partial<Instruction>);

    expect(next).toEqual([{ t: "say", id: "say_original", who: "hero", text: "After" }]);
  });

  it("allows resource ids to be updated", () => {
    const original = [{ t: "bg", id: "room" }] as Instruction[];

    expect(updateInstruction(original, 0, { id: "hall" })).toEqual([{ t: "bg", id: "hall" }]);
  });
});

describe("moveInstruction", () => {
  it("reorders items", () => {
    const original = [
      { t: "narrate", text: "一" },
      { t: "narrate", text: "二" },
      { t: "narrate", text: "三" },
    ] as Instruction[];

    const next = moveInstruction(original, 0, 2);

    expect(next.map((item) => ("text" in item ? item.text : ""))).toEqual(["二", "三", "一"]);
    expect(original.map((item) => ("text" in item ? item.text : ""))).toEqual(["一", "二", "三"]);
  });
});

describe("duplicateInstruction", () => {
  it("copies item after source", () => {
    const original = [
      { t: "bg", id: "room" },
      { t: "wait", ms: 500 },
    ] as Instruction[];

    const next = duplicateInstruction(original, 0);

    expect(next).toEqual([
      { t: "bg", id: "room" },
      { t: "bg", id: "room" },
      { t: "wait", ms: 500 },
    ]);
    expect(next[0]).not.toBe(next[1]);
  });

  it("removes identity from a duplicated story point but retains resource ids", () => {
    const original = [
      { t: "say", id: "say_original", who: "hero", text: "Hello" },
      { t: "bg", id: "room" },
    ] as Instruction[];

    const duplicatedStoryPoint = duplicateInstruction(original, 0);
    const duplicatedResource = duplicateInstruction(original, 1);

    expect(duplicatedStoryPoint[1]).toEqual({ t: "say", who: "hero", text: "Hello" });
    expect(duplicatedResource[2]).toEqual({ t: "bg", id: "room" });
  });

  it("moves the complete story-point object with its identity", () => {
    const original = [
      { t: "say", id: "say_a", who: "hero", text: "A" },
      { t: "say", id: "say_b", who: "hero", text: "B" },
    ] as Instruction[];

    expect(moveInstruction(original, 0, 1)).toEqual([
      { t: "say", id: "say_b", who: "hero", text: "B" },
      { t: "say", id: "say_a", who: "hero", text: "A" },
    ]);
  });
});

describe("insertInstruction", () => {
  it("removes a supplied id from a new story point but retains resource ids", () => {
    const storyPoint = insertInstruction([], { t: "wait", id: "copied_wait", ms: 500 });
    const resource = insertInstruction([], { t: "bg", id: "room" });

    expect(storyPoint).toEqual([{ t: "wait", ms: 500 }]);
    expect(resource).toEqual([{ t: "bg", id: "room" }]);
  });
});

describe("deleteInstruction", () => {
  it("removes item", () => {
    const original = [
      { t: "bg", id: "room" },
      { t: "wait", ms: 500 },
      { t: "narrate", text: "尾声" },
    ] as Instruction[];

    const next = deleteInstruction(original, 1);

    expect(next).toEqual([
      { t: "bg", id: "room" },
      { t: "narrate", text: "尾声" },
    ]);
  });
});

describe("serializeInstructionDraft", () => {
  it("pretty prints with stable indentation", () => {
    expect(serializeInstructionDraft([{ t: "wait", ms: 1200 }] as Instruction[])).toBe(`[
  {
    "t": "wait",
    "ms": 1200
  }
]`);
  });
});
