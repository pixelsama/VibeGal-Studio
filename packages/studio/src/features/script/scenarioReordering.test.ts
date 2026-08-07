import { describe, expect, it } from "vitest";
import { parseScenarioText, type Instruction } from "@vibegal/engine";
import { planScenarioInstructionMove } from "./scenarioReordering";
import { createUndoHistory, recordUndoCheckpoint, redoScenarioText, undoScenarioText } from "./undoHistory";

function parse(text: string): Instruction[] {
  const parsed = parseScenarioText(text);
  if (!parsed.ok) throw new Error("scenario fixture should parse");
  return parsed.instructions;
}

describe("planScenarioInstructionMove", () => {
  it("moves repeated story points by parsed identity instead of matching text", () => {
    const instructions = [
      { t: "say", id: "say_a", who: "akari", text: "一样" },
      { t: "say", id: "say_b", who: "akari", text: "一样" },
    ] as Instruction[];

    const move = planScenarioInstructionMove(instructions, 0, 1);

    expect(move?.instructions).toEqual([
      { t: "say", id: "say_b", who: "akari", text: "一样" },
      { t: "say", id: "say_a", who: "akari", text: "一样" },
    ]);
    expect(move?.instructions[1]).toBe(instructions[0]);
    expect(move?.text).toBe("akari: 一样\n\nakari: 一样");
    expect(move?.cursorOffset).toBe("akari: 一样\n\n".length);
  });

  it("moves an implicit pause as a parsed instruction and formats it explicitly", () => {
    const instructions = parse("@bg room fade\n\nakari: 你好。");

    const move = planScenarioInstructionMove(instructions, 1, 2);

    expect(move?.instructions.map((instruction) => instruction.t)).toEqual(["bg", "say", "pause"]);
    expect(move?.text).toBe("@bg room\nakari: 你好。\n@pause");
    expect(parse(move!.text).map((instruction) => instruction.t)).toEqual(["bg", "say", "pause"]);
  });

  it("rebuilds blocking frame boundaries after movement", () => {
    const instructions = [
      { t: "bg", id: "room" },
      { t: "say", id: "say_a", who: "akari", text: "你好。" },
      { t: "bgm", id: "daily" },
    ] as Instruction[];

    const move = planScenarioInstructionMove(instructions, 2, 0);

    expect(move?.text).toBe("@bgm daily\n@bg room\nakari: 你好。");
    expect(parse(move!.text).map((instruction) => instruction.t)).toEqual(["bgm", "bg", "say"]);
  });

  it("round-trips one structured movement through one undo checkpoint", () => {
    const instructions = [
      { t: "say", id: "say_a", who: "akari", text: "一" },
      { t: "say", id: "say_b", who: "akari", text: "二" },
    ] as Instruction[];
    const text = "akari: 一\n\nakari: 二";
    const move = planScenarioInstructionMove(instructions, 0, 1)!;
    const history = recordUndoCheckpoint(createUndoHistory<{ text: string; instructions: Instruction[] }>(), {
      text,
      instructions,
    }, { programmatic: true, now: 1 });

    const undone = undoScenarioText(history, { text: move.text, instructions: move.instructions })!;
    const redone = redoScenarioText(undone.history, undone.text)!;

    expect(history.past).toHaveLength(1);
    expect(undone.text).toEqual({ text, instructions });
    expect(redone.text).toEqual({ text: move.text, instructions: move.instructions });
  });

  it("rejects first-up, last-down, and invalid source movements", () => {
    const instructions = [
      { t: "narrate", text: "一" },
      { t: "narrate", text: "二" },
    ] as Instruction[];

    expect(planScenarioInstructionMove(instructions, 0, -1)).toBeNull();
    expect(planScenarioInstructionMove(instructions, 1, 2)).toBeNull();
    expect(planScenarioInstructionMove(instructions, -1, 0)).toBeNull();
  });

  it("moves a choice block as a single top-level instruction", () => {
    // Spec 35 Phase 2：choice 整块算一条顶层指令，移动 index 0→1 把整块挪到 say 之后。
    const instructions = [
      {
        t: "choice",
        prompt: null,
        options: [
          { text: "A", to: "a" },
          { text: "B", to: "b" },
        ],
      },
      { t: "say", who: "akari", text: "开场。" },
    ] as Instruction[];

    const move = planScenarioInstructionMove(instructions, 0, 1);

    expect(move?.instructions.map((i) => i.t)).toEqual(["say", "choice"]);
    // 重新格式化后 choice 块保持完整缩进树
    expect(move?.text).toContain("choice");
    expect(move?.text).toContain("    A @to a");
    expect(parse(move!.text).map((i) => i.t)).toEqual(["say", "choice"]);
  });
});
