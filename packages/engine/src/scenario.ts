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
  if (trimmed === "@choice" || /^-\s*.+\s*->\s*\S+/.test(trimmed)) {
    return { ok: false, message: "分支选项已移到节点出口，请在节点底部的出口块中配置。" };
  }

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
      case "@set": {
        const key = parts[1];
        const valueRaw = parts.slice(2).join(" ");
        if (!key) return { ok: false, message: "@set 需要变量名。" };
        if (!valueRaw) return { ok: false, message: "@set 需要变量值。" };
        return { ok: true, instruction: { t: "set", key, value: parseScenarioValue(valueRaw) } as Instruction };
      }
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
    case "set":
      return `@set ${instruction.key} ${formatScenarioValue(instruction.value)}`;
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
    || instruction.t === "wait"
    || instruction.t === "pause";
}

function parseScenarioValue(raw: string): string | number | boolean | null {
  const value = raw.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  const numberValue = Number(value);
  if (Number.isFinite(numberValue) && value !== "") return numberValue;
  return value;
}

function formatScenarioValue(value: string | number | boolean | null): string {
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}
