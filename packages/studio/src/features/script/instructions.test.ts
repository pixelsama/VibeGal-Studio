import { describe, expect, it } from "vitest";
import { defaultInstruction, insertInstructionAt, summarizeInstructions } from "./instructions";
import type { Instruction, Manifest } from "@vibegal/engine";

const sampleInstructions = [
  { t: "bg", id: "ocean_dawn" },
  { t: "bgm", id: "bgm_main" },
  { t: "narrate", text: "海面没有风。" },
  { t: "say", who: "hero", text: "你好。" },
  { t: "sfx", id: "boom" },
  { t: "char", id: "hero", pos: "center" },
  { t: "wait", ms: 500 },
  { t: "effect", type: "shake", intensity: 4 },
  { t: "transition", type: "fade_in" },
] as unknown as Instruction[];

describe("summarizeInstructions", () => {
  it("only summarizes say/narrate/bg/bgm", () => {
    const summaries = summarizeInstructions(sampleInstructions);

    expect(summaries.map((s) => s.kind)).toEqual(["bg", "bgm", "narrate", "say"]);
    expect(summaries.map((s) => s.index)).toEqual([0, 1, 2, 3]);
  });

  it("ignores sfx/voice/char/wait/effect/transition", () => {
    const summaries = summarizeInstructions(sampleInstructions);
    expect(summaries.every((s) => ["say", "narrate", "bg", "bgm"].includes(s.kind))).toBe(true);
  });

  it("formats say as who: text", () => {
    const summaries = summarizeInstructions([{ t: "say", who: "hero", text: "你好。" }] as unknown as Instruction[]);
    expect(summaries[0].label).toBe("hero: 你好。");
  });

  it("formats narrate as bare text", () => {
    const summaries = summarizeInstructions([{ t: "narrate", text: "黄昏。" }] as unknown as Instruction[]);
    expect(summaries[0].label).toBe("黄昏。");
  });

  it("formats bg and bgm with kind prefix and id", () => {
    const summaries = summarizeInstructions([
      { t: "bg", id: "ocean_dawn" },
      { t: "bgm", id: "bgm_main" },
    ] as unknown as Instruction[]);
    expect(summaries[0].label).toBe("背景 ocean_dawn");
    expect(summaries[1].label).toBe("BGM bgm_main");
  });

  it("truncates long text with ellipsis", () => {
    const long = "啊".repeat(50);
    const summaries = summarizeInstructions([{ t: "narrate", text: long }] as unknown as Instruction[]);
    expect(summaries[0].label.endsWith("…")).toBe(true);
    expect(summaries[0].label.length).toBeLessThan(long.length);
  });

  it("returns empty array for empty instructions", () => {
    expect(summarizeInstructions([])).toEqual([]);
  });

  it("ignores legacy choice instructions", () => {
    const summaries = summarizeInstructions([
      {
        t: "choice",
        choices: [
          { text: "留下", to: "stay" },
          { text: "离开", to: "leave" },
        ],
      },
    ] as unknown as Instruction[]);

    expect(summaries).toEqual([]);
  });
});

describe("insertInstructionAt", () => {
  const base: Instruction[] = [
    { t: "narrate", text: "一" },
    { t: "narrate", text: "三" },
  ] as unknown as Instruction[];
  const newInstr = { t: "narrate", text: "二" } as unknown as Instruction;

  it("inserts at the given index", () => {
    const next = insertInstructionAt(base, 1, newInstr);
    expect(next.map((i) => (i as { text: string }).text)).toEqual(["一", "二", "三"]);
  });

  it("does not mutate the original array", () => {
    insertInstructionAt(base, 1, newInstr);
    expect(base).toHaveLength(2);
    expect(base.map((i) => (i as { text: string }).text)).toEqual(["一", "三"]);
  });

  it("appends to end when index equals length", () => {
    const next = insertInstructionAt(base, base.length, newInstr);
    expect(next.map((i) => (i as { text: string }).text)).toEqual(["一", "三", "二"]);
  });

  it("appends to end when index out of bounds (negative or too large)", () => {
    const neg = insertInstructionAt(base, -1, newInstr);
    const huge = insertInstructionAt(base, 999, newInstr);
    expect(neg.at(-1)).toBe(newInstr);
    expect(huge.at(-1)).toBe(newInstr);
  });
});

describe("defaultInstruction", () => {
  it("narrate has t and empty text", () => {
    expect(defaultInstruction("narrate")).toMatchObject({ t: "narrate", text: "" });
  });

  it("say has t, empty who and text (with schema defaults applied)", () => {
    expect(defaultInstruction("say")).toMatchObject({ t: "say", who: "", text: "", expr: "default" });
  });

  it("bg has t and empty id (with schema defaults applied)", () => {
    expect(defaultInstruction("bg")).toMatchObject({ t: "bg", id: "", trans: "fade", ms: 1000 });
  });

  it("bgm has t and empty id (with schema defaults applied)", () => {
    expect(defaultInstruction("bgm")).toMatchObject({ t: "bgm", id: "", loop: true });
  });

  it("wait has t and ms", () => {
    expect(defaultInstruction("wait")).toEqual({ t: "wait", ms: 1000 });
  });

  it("set has default variable assignment", () => {
    expect(defaultInstruction("set")).toEqual({ t: "set", key: "flag", value: true });
  });
});
