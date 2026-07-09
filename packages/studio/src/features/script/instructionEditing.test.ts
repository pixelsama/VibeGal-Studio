import { describe, expect, it } from "vitest";
import type { Instruction } from "@vibegal/engine";
import {
  deleteInstruction,
  duplicateInstruction,
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
