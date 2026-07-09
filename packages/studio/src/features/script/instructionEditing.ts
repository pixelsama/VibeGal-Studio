import type { Instruction } from "@vibegal/engine";

export type InstructionDraftParseResult =
  | { ok: true; instructions: Instruction[] }
  | { ok: false; error: string };

export type EditableInstructionKind = Instruction["t"];

export function parseInstructionDraft(text: string): InstructionDraftParseResult {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) {
      return { ok: false, error: "节点内容必须是 JSON 数组。", };
    }
    return { ok: true, instructions: parsed as Instruction[] };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function serializeInstructionDraft(instructions: Instruction[]): string {
  return JSON.stringify(instructions, null, 2);
}

export function updateInstruction(
  instructions: Instruction[],
  index: number,
  patch: Partial<Instruction>,
): Instruction[] {
  if (index < 0 || index >= instructions.length) return instructions;
  return instructions.map((instruction, currentIndex) => (
    currentIndex === index
      ? ({ ...instruction, ...patch } as Instruction)
      : instruction
  ));
}

export function moveInstruction(instructions: Instruction[], from: number, to: number): Instruction[] {
  if (from < 0 || from >= instructions.length) return instructions;
  const clampedTo = Math.max(0, Math.min(to, instructions.length - 1));
  if (from === clampedTo) return instructions;
  const next = instructions.slice();
  const [item] = next.splice(from, 1);
  next.splice(clampedTo, 0, item);
  return next;
}

export function duplicateInstruction(instructions: Instruction[], index: number): Instruction[] {
  if (index < 0 || index >= instructions.length) return instructions;
  const next = instructions.slice();
  next.splice(index + 1, 0, cloneInstruction(instructions[index]));
  return next;
}

export function deleteInstruction(instructions: Instruction[], index: number): Instruction[] {
  if (index < 0 || index >= instructions.length) return instructions;
  return instructions.filter((_, currentIndex) => currentIndex !== index);
}

export function insertInstruction(instructions: Instruction[], instruction: Instruction, index = instructions.length): Instruction[] {
  const clampedIndex = Math.max(0, Math.min(index, instructions.length));
  const next = instructions.slice();
  next.splice(clampedIndex, 0, instruction);
  return next;
}

export function createInstructionDraft(kind: EditableInstructionKind): Instruction {
  switch (kind) {
    case "narrate":
      return { t: "narrate", text: "" };
    case "say":
      return { t: "say", who: "", expr: "default", text: "" };
    case "bg":
      return { t: "bg", id: "", trans: "fade", ms: 1000 };
    case "bgm":
      return { t: "bgm", id: "", fade: 1500, loop: true };
    case "sfx":
      return { t: "sfx", id: "" };
    case "voice":
      return { t: "voice", id: "" };
    case "char":
      return {
        t: "char",
        id: "",
        expr: "default",
        pos: "center",
        trans: "fade",
        ms: 600,
        clear: false,
        remove: false,
      };
    case "set":
      return { t: "set", key: "flag", value: true };
    case "wait":
      return { t: "wait", ms: 1000 };
    case "effect":
      return { t: "effect", type: "shake", intensity: 6, ms: 400 };
    case "transition":
      return { t: "transition", type: "fade_in", ms: 1000 };
    case "pause":
      return { t: "pause" };
    case "unlock":
      return { t: "unlock", kind: "cg", id: "" };
    case "showCg":
      return { t: "showCg", id: "" };
    case "playVideo":
      return { t: "playVideo", id: "" };
    default:
      return { t: "narrate", text: "" };
  }
}

export function instructionIndexFromJsonPath(jsonPath?: string): number | null {
  if (!jsonPath) return null;
  const match = /^\$\[(\d+)\](?:\.|$)/.exec(jsonPath);
  return match ? Number.parseInt(match[1] ?? "", 10) : null;
}

function cloneInstruction(instruction: Instruction): Instruction {
  return { ...instruction };
}
