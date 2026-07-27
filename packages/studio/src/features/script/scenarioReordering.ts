import { formatScenarioText, type Instruction } from "@vibegal/engine";
import { moveInstruction } from "./instructionEditing";
import { mapScenarioFrames } from "./scenarioFrames";

export interface ScenarioInstructionMove {
  instructions: Instruction[];
  text: string;
  movedIndex: number;
  cursorOffset: number;
}

/**
 * 按解析后的指令顺序移动，而不是搬运原始文本行。
 * 重新格式化会一并修复空行产生的隐式停顿和阻塞帧边界。
 */
export function planScenarioInstructionMove(
  instructions: Instruction[],
  from: number,
  to: number,
): ScenarioInstructionMove | null {
  const nextInstructions = moveInstruction(instructions, from, to);
  if (nextInstructions === instructions) return null;

  const movedIndex = Math.max(0, Math.min(to, instructions.length - 1));
  const text = formatScenarioText(nextInstructions);
  const line = mapScenarioFrames(text).lineByInstructionIndex[movedIndex];

  return {
    instructions: nextInstructions,
    text,
    movedIndex,
    cursorOffset: line == null ? text.length : lineStartOffset(text, line),
  };
}

function lineStartOffset(text: string, line: number): number {
  if (line <= 1) return 0;
  let offset = 0;
  for (let currentLine = 1; currentLine < line; currentLine += 1) {
    const newline = text.indexOf("\n", offset);
    if (newline < 0) return text.length;
    offset = newline + 1;
  }
  return offset;
}
