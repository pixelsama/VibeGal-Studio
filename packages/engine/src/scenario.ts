import type { Instruction } from "./types";

export interface ScenarioDiagnostic {
  line: number;
  message: string;
}

export type ScenarioParseResult =
  | { ok: true; instructions: Instruction[]; diagnostics: [] }
  | { ok: false; instructions: Instruction[]; diagnostics: ScenarioDiagnostic[] };

type ParsedLine =
  | { ok: true; instruction: Instruction | null; consumesChoiceBlock?: boolean }
  | { ok: false; message: string };

const BG_TRANSITIONS = new Set(["fade", "cut", "dissolve"]);
const CHAR_TRANSITIONS = new Set(["fade", "cut", "slide"]);
const EFFECT_TYPES = new Set(["shake", "flash", "blur"]);
const TRANSITION_TYPES = new Set(["fade_in", "fade_out", "white_in", "white_out", "black"]);

export function parseScenarioText(text: string): ScenarioParseResult {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const instructions: Instruction[] = [];
  const diagnostics: ScenarioDiagnostic[] = [];
  let frameHasBlockingInstruction = false;
  let frameHasAnyInstruction = false;
  let index = 0;

  const finishFrame = () => {
    if (frameHasAnyInstruction && !frameHasBlockingInstruction) {
      instructions.push({ t: "pause" } as Instruction);
    }
    frameHasBlockingInstruction = false;
    frameHasAnyInstruction = false;
  };

  while (index < lines.length) {
    const raw = lines[index];
    const lineNumber = index + 1;
    const line = raw.trim();

    if (line.length === 0) {
      finishFrame();
      index += 1;
      continue;
    }

    if (line === "@choice") {
      const choices: Array<{ text: string; to: string }> = [];
      let sawChoiceItem = false;
      let choiceIndex = index + 1;
      while (choiceIndex < lines.length) {
        const choiceLine = lines[choiceIndex].trim();
        if (choiceLine.length === 0) break;
        if (!choiceLine.startsWith("-")) break;
        sawChoiceItem = true;
        const parsed = parseChoiceItem(choiceLine);
        if (parsed.ok) {
          choices.push(parsed.choice);
        } else {
          diagnostics.push({ line: choiceIndex + 1, message: parsed.message });
        }
        choiceIndex += 1;
      }

      if (choices.length === 0 && !sawChoiceItem) {
        diagnostics.push({ line: lineNumber, message: "@choice 需要至少一个选择项。" });
      } else if (choices.length > 0) {
        instructions.push({ t: "choice", choices } as Instruction);
        frameHasAnyInstruction = true;
        frameHasBlockingInstruction = true;
      }
      index = choiceIndex;
      continue;
    }

    const parsed = parseScenarioLine(line);
    if (parsed.ok) {
      if (parsed.instruction) {
        instructions.push(parsed.instruction);
        frameHasAnyInstruction = true;
        if (isBlockingInstruction(parsed.instruction)) {
          frameHasBlockingInstruction = true;
        }
      }
    } else {
      diagnostics.push({ line: lineNumber, message: parsed.message });
    }
    index += 1;
  }

  finishFrame();

  return diagnostics.length === 0
    ? { ok: true, instructions, diagnostics: [] }
    : { ok: false, instructions, diagnostics };
}

export function parseScenarioLine(line: string): ParsedLine {
  const trimmed = line.trim();
  if (trimmed.length === 0) return { ok: true, instruction: null };
  if (trimmed === "@choice" || trimmed.startsWith("-")) return { ok: true, instruction: null };

  if (trimmed.startsWith("@")) {
    const parts = trimmed.split(/\s+/);
    const command = parts[0];
    switch (command) {
      case "@bg": {
        const id = parts[1];
        if (!id) return { ok: false, message: "@bg 需要背景 ID。" };
        const trans = parts[2] ?? "fade";
        if (!BG_TRANSITIONS.has(trans)) return { ok: false, message: "@bg 转场必须是 fade、cut 或 dissolve。" };
        return { ok: true, instruction: { t: "bg", id, trans, ms: 1000 } as Instruction };
      }
      case "@bgm": {
        const id = parts[1];
        if (!id) return { ok: false, message: "@bgm 需要 BGM ID。" };
        return { ok: true, instruction: { t: "bgm", id, fade: 1500, loop: true } as Instruction };
      }
      case "@sfx": {
        const id = parts[1];
        if (!id) return { ok: false, message: "@sfx 需要音效 ID。" };
        return { ok: true, instruction: { t: "sfx", id } as Instruction };
      }
      case "@voice": {
        const id = parts[1];
        if (!id) return { ok: false, message: "@voice 需要语音 ID。" };
        return { ok: true, instruction: { t: "voice", id } as Instruction };
      }
      case "@char": {
        const id = parts[1];
        if (!id) return { ok: false, message: "@char 需要角色 ID。" };
        const expr = parts[2] ?? "default";
        const pos = parts[3] ?? "center";
        const trans = parts[4] && CHAR_TRANSITIONS.has(parts[4]) ? parts[4] : "fade";
        return {
          ok: true,
          instruction: { t: "char", id, expr, pos, trans, ms: 600, clear: false, remove: false } as Instruction,
        };
      }
      case "@wait": {
        const ms = Number.parseInt(parts[1] ?? "", 10);
        if (!Number.isInteger(ms) || ms < 0) return { ok: false, message: "@wait 需要非负毫秒数。" };
        return { ok: true, instruction: { t: "wait", ms } as Instruction };
      }
      case "@pause":
        return { ok: true, instruction: { t: "pause" } as Instruction };
      case "@effect": {
        const type = parts[1];
        if (!type || !EFFECT_TYPES.has(type)) return { ok: false, message: "@effect 类型必须是 shake、flash 或 blur。" };
        return { ok: true, instruction: { t: "effect", type, intensity: 6, ms: 400 } as Instruction };
      }
      case "@transition": {
        const type = parts[1];
        if (!type || !TRANSITION_TYPES.has(type)) {
          return { ok: false, message: "@transition 类型必须是 fade_in、fade_out、white_in、white_out 或 black。" };
        }
        return { ok: true, instruction: { t: "transition", type, ms: 1000 } as Instruction };
      }
      default:
        return { ok: false, message: `未知命令：${command}` };
    }
  }

  const sayMatch = trimmed.match(/^([^:：\s][^:：]*?)\s*[:：]\s*(.*)$/);
  if (sayMatch) {
    const who = sayMatch[1].trim();
    const sayText = sayMatch[2].trim();
    if (!sayText) return { ok: false, message: "台词文本不能为空。" };
    return { ok: true, instruction: { t: "say", who, expr: "default", text: sayText } as Instruction };
  }

  return { ok: true, instruction: { t: "narrate", text: trimmed } as Instruction };
}

export function formatScenarioText(instructions: Instruction[]): string {
  const lines: string[] = [];
  instructions.forEach((instruction, index) => {
    if (lines.length > 0 && lines[lines.length - 1] === "" && instruction.t === "pause") {
      lines.pop();
    }
    lines.push(...formatScenarioInstruction(instruction).split("\n"));
    if (isBlockingInstruction(instruction) && index < instructions.length - 1) {
      lines.push("");
    }
  });
  return lines.join("\n").trimEnd();
}

export function formatScenarioInstruction(instruction: Instruction): string {
  switch (instruction.t) {
    case "bg":
      return `@bg ${instruction.id} ${instruction.trans}`;
    case "bgm":
      return `@bgm ${instruction.id}`;
    case "sfx":
      return `@sfx ${instruction.id}`;
    case "voice":
      return `@voice ${instruction.id}`;
    case "char":
      return `@char ${instruction.id} ${instruction.expr} ${instruction.pos}`;
    case "say":
      return `${instruction.who}: ${instruction.text}`;
    case "narrate":
      return instruction.text;
    case "choice":
      return ["@choice", ...instruction.choices.map((choice) => `- ${choice.text} -> ${choice.to}`)].join("\n");
    case "wait":
      return `@wait ${instruction.ms}`;
    case "effect":
      return `@effect ${instruction.type}`;
    case "transition":
      return `@transition ${instruction.type}`;
    case "pause":
      return "@pause";
  }
}

export function isBlockingInstruction(instruction: Instruction): boolean {
  return instruction.t === "say"
    || instruction.t === "narrate"
    || instruction.t === "choice"
    || instruction.t === "wait"
    || instruction.t === "pause";
}

function parseChoiceItem(line: string): { ok: true; choice: { text: string; to: string } } | { ok: false; message: string } {
  const match = line.match(/^-\s*(.+?)\s*->\s*(\S+)\s*$/);
  if (!match) return { ok: false, message: "选择项格式应为：- 文本 -> nodeId" };
  return { ok: true, choice: { text: match[1].trim(), to: match[2].trim() } };
}
