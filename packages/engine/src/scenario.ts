import { InstructionSchema } from "./schema";
import type { Instruction } from "./types";
import { instructionPolicies } from "@vibegal/contracts";
import { INSTRUCTION_DEFAULTS, withInstructionDefaults } from "./instructionDefaults";

export interface ScenarioDiagnostic {
  line: number;
  message: string;
}

export type ScenarioParseResult =
  | { ok: true; instructions: Instruction[]; diagnostics: [] }
  | { ok: false; instructions: Instruction[]; diagnostics: ScenarioDiagnostic[] };

type ParsedLine =
  | { ok: true; instruction: Instruction | null; suppressesImplicitPause?: boolean }
  | { ok: false; message: string };

/**
 * 剧本行里的「参数尾巴」。
 *
 * 此前可读语法只能表达指令的一部分字段（`@bg` 固定 ms=1000、`@char` 固定
 * clear/remove=false…），凡是参数偏离默认值的指令都会整条退化成
 * `@instruction {…JSON…}`——角色退场、非默认转场时长这种高频操作首当其冲。
 * 现在统一在位置参数之后接受三类记号：
 *
 * - 时长：`1200ms`
 * - 开关：`clear` / `out` / `once` / `loop`（各命令自行取用）
 * - 其余裸词：交给命令自己按位置解释（转场名、表情、位置、强度…）
 */
interface OptionTokens {
  ok: true;
  words: string[];
  flags: string[];
  ms?: number;
}

type OptionTokensResult = OptionTokens | { ok: false; message: string };

const OPTION_FLAGS = new Set(["clear", "out", "once", "loop"]);

/** `1200ms` → 1200；不是时长记号 → undefined；写坏了（`-5ms`、`abcms`）→ null。 */
function parseMsToken(token: string): number | null | undefined {
  if (!token.endsWith("ms")) return undefined;
  const digits = token.slice(0, -2);
  if (!/^\d+$/.test(digits)) return null;
  return Number.parseInt(digits, 10);
}

function readOptionTokens(tokens: string[]): OptionTokensResult {
  const words: string[] = [];
  const flags: string[] = [];
  let ms: number | undefined;
  for (const token of tokens) {
    const parsed = parseMsToken(token);
    if (parsed === null) return { ok: false, message: `时长必须写成毫秒数，如 1200ms（收到「${token}」）。` };
    if (parsed !== undefined) {
      if (ms != null) return { ok: false, message: "只能写一个时长。" };
      ms = parsed;
      continue;
    }
    if (OPTION_FLAGS.has(token)) flags.push(token);
    else words.push(token);
  }
  return { ok: true, words, flags, ms };
}

/** 只保留真正写下的字段，缺省项留给 schema/interpreter，避免把默认值写进项目文件。 */
function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  const entries = Object.entries(value).filter(([, item]) => item !== undefined);
  return Object.fromEntries(entries) as T;
}

/**
 * 台词行的说话人部分：`雪`、`雪(hurt)`、`雪(hurt, 1800ms)`、`雪(1800ms)`。
 * 表情与停顿写在冒号左边，右边永远是纯台词文本。
 */
function parseScenarioStringArguments(raw: string):
  | { ok: true; values: string[] }
  | { ok: false; message: string } {
  const values: string[] = [];
  let cursor = 0;

  while (cursor < raw.length) {
    while (/\s/.test(raw[cursor] ?? "")) cursor += 1;
    if (cursor >= raw.length) break;
    if (raw[cursor] !== '"') {
      return { ok: false, message: "提问和默认名字需要用引号包起来。" };
    }

    const start = cursor;
    cursor += 1;
    let escaped = false;
    while (cursor < raw.length) {
      const character = raw[cursor];
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') break;
      cursor += 1;
    }
    if (cursor >= raw.length) return { ok: false, message: "引号没有闭合。" };

    const serialized = raw.slice(start, cursor + 1);
    try {
      const value: unknown = JSON.parse(serialized);
      if (typeof value !== "string") throw new TypeError("not a string");
      values.push(value);
    } catch {
      return { ok: false, message: "引号里的文字无法读取。" };
    }
    cursor += 1;
  }

  return { ok: true, values };
}

function parseNameInputCommand(command: string, trimmed: string): ParsedLine {
  const raw = trimmed.slice(command.length).trim();
  const keyMatch = raw.match(/^(\S+)(?:\s+|$)/);
  if (!keyMatch) return { ok: false, message: "玩家命名需要选择一个文本故事状态。" };

  const key = keyMatch[1];
  let rest = raw.slice(keyMatch[0].length).trim();
  let maxLength: number | undefined;
  const lengthMatch = rest.match(/^(\d+)(?:\s+|$)/);
  if (lengthMatch) {
    maxLength = Number.parseInt(lengthMatch[1], 10);
    if (maxLength < 1 || maxLength > 100) {
      return { ok: false, message: "名字长度必须在 1–100 个字符之间。" };
    }
    rest = rest.slice(lengthMatch[0].length).trim();
  }

  const strings = parseScenarioStringArguments(rest);
  if (!strings.ok) return { ok: false, message: `玩家命名：${strings.message}` };
  if (strings.values.length === 0 || !strings.values[0]) {
    return { ok: false, message: "玩家命名需要一句提问。" };
  }
  if (strings.values.length > 2) {
    return { ok: false, message: "玩家命名最多填写提问和默认名字两段文字。" };
  }

  return {
    ok: true,
    instruction: pruneUndefined({
      t: "inputName",
      key,
      prompt: strings.values[0],
      default: strings.values[1],
      maxLength,
    }) as Instruction,
  };
}

function parseSpeakerHead(head: string):
  | { ok: true; who: string; expr?: string; voice?: string; ms?: number }
  | { ok: false; message: string } {
  const match = head.match(/^(.*?)\s*[(（]\s*([^)）]*)\s*[)）]$/);
  if (!match) return { ok: true, who: head };
  const who = match[1].trim();
  if (!who) return { ok: false, message: "台词需要说话人。" };
  let expr: string | undefined;
  let voice: string | undefined;
  let ms: number | undefined;
  for (const raw of match[2].split(/[,，]/)) {
    const token = raw.trim();
    if (!token) continue;
    const parsed = parseMsToken(token);
    if (parsed === null) return { ok: false, message: `台词停顿必须写成毫秒数，如 1800ms（收到「${token}」）。` };
    if (parsed !== undefined) {
      if (ms != null) return { ok: false, message: "台词只能写一个停顿。" };
      ms = parsed;
      continue;
    }
    if (token.startsWith("voice=")) {
      const id = token.slice("voice=".length);
      if (!id) return { ok: false, message: "本句语音需要资源 ID，如 voice=akari_001。" };
      if (voice != null) return { ok: false, message: "台词只能绑定一条本句语音。" };
      voice = id;
      continue;
    }
    if (expr != null) return { ok: false, message: `台词只能写一个表情（收到「${token}」）。` };
    expr = token;
  }
  return { ok: true, who, expr, voice, ms };
}

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
  let frameSuppressesImplicitPause = false;
  let index = 0;

  const finishFrame = () => {
    if (frameHasAnyInstruction && !frameHasBlockingInstruction && !frameSuppressesImplicitPause) {
      instructions.push({ t: "pause" } as Instruction);
    }
    frameHasBlockingInstruction = false;
    frameHasAnyInstruction = false;
    frameSuppressesImplicitPause = false;
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
      if (parsed.suppressesImplicitPause) {
        frameSuppressesImplicitPause = true;
      }
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
    return { ok: false, message: "分支选项已移到流程图出口，请在流程图中配置。" };
  }

  if (trimmed.startsWith("@")) {
    if (trimmed === "@continue") {
      return { ok: true, instruction: null, suppressesImplicitPause: true };
    }

    if (trimmed === "@instruction" || trimmed.startsWith("@instruction ")) {
      const payload = trimmed.slice("@instruction".length).trim();
      if (!payload) return { ok: false, message: "@instruction 需要 Instruction JSON。" };
      try {
        const rawInstruction: unknown = JSON.parse(payload);
        const validated = InstructionSchema.safeParse(rawInstruction);
        if (!validated.success) {
          return { ok: false, message: "@instruction 需要有效的 Instruction JSON。" };
        }
        // Validate the payload, but retain the raw object. Applying Zod defaults here
        // would turn an omitted project field into an explicit field on save.
        return { ok: true, instruction: rawInstruction as Instruction };
      } catch {
        return { ok: false, message: "@instruction 需要有效的 Instruction JSON。" };
      }
    }

    const parts = trimmed.split(/\s+/);
    const command = parts[0];
    switch (command) {
      case "@bg": {
        const id = parts[1];
        if (!id) return { ok: false, message: "@bg 需要背景 ID。" };
        const rest = readOptionTokens(parts.slice(2));
        if (!rest.ok) return { ok: false, message: `@bg ${rest.message}` };
        const trans = rest.words[0];
        if (rest.words.length > 1) return { ok: false, message: "@bg 只接受一个转场名。" };
        if (trans != null && !BG_TRANSITIONS.has(trans)) {
          return { ok: false, message: "@bg 转场必须是 fade、cut 或 dissolve。" };
        }
        if (rest.flags.length > 0) return { ok: false, message: `@bg 不认识「${rest.flags[0]}」。` };
        return {
          ok: true,
          instruction: pruneUndefined({ t: "bg", id, trans, ms: rest.ms }) as Instruction,
        };
      }
      case "@bgm": {
        const id = parts[1];
        if (!id) return { ok: false, message: "@bgm 需要 BGM ID。" };
        const rest = readOptionTokens(parts.slice(2));
        if (!rest.ok) return { ok: false, message: `@bgm ${rest.message}` };
        if (rest.words.length > 0) return { ok: false, message: `@bgm 不认识「${rest.words[0]}」。` };
        const unknown = rest.flags.find((flag) => flag !== "once" && flag !== "loop");
        if (unknown) return { ok: false, message: `@bgm 不认识「${unknown}」。` };
        const loop = rest.flags.includes("once") ? false : rest.flags.includes("loop") ? true : undefined;
        return {
          ok: true,
          instruction: pruneUndefined({ t: "bgm", id, fade: rest.ms, loop }) as Instruction,
        };
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
        const rest = readOptionTokens(parts.slice(2));
        if (!rest.ok) return { ok: false, message: `@char ${rest.message}` };
        const unknownFlag = rest.flags.find((flag) => flag !== "clear" && flag !== "out");
        if (unknownFlag) return { ok: false, message: `@char 不认识「${unknownFlag}」。` };
        // 位置参数：表情、位置、转场。转场名可以直接出现在任意位置（它自成词表），
        // 于是 `@char akari smile left slide` 与 `@char akari slide` 都能写。
        const words = [...rest.words];
        const transIndex = words.findIndex((word) => CHAR_TRANSITIONS.has(word));
        const trans = transIndex >= 0 ? words.splice(transIndex, 1)[0] : undefined;
        if (words.length > 2) return { ok: false, message: `@char 不认识「${words[2]}」。` };
        const [expr, pos] = words;
        return {
          ok: true,
          instruction: pruneUndefined({
            t: "char",
            id,
            expr,
            pos,
            trans,
            ms: rest.ms,
            clear: rest.flags.includes("clear") ? true : undefined,
            remove: rest.flags.includes("out") ? true : undefined,
          }) as Instruction,
        };
      }
      case "@wait": {
        const raw = parts[1] ?? "";
        const ms = Number.parseInt(raw.endsWith("ms") ? raw.slice(0, -2) : raw, 10);
        if (!Number.isInteger(ms) || ms < 0 || parts.length > 2) {
          return { ok: false, message: "@wait 需要非负毫秒数。" };
        }
        return { ok: true, instruction: { t: "wait", ms } as Instruction };
      }
      case "@pause":
        return { ok: true, instruction: { t: "pause" } as Instruction };
      case "@narrate": {
        // 旁白通常直接写一行裸文本；只有需要覆盖自动播放停顿时才用显式命令：
        // `@narrate 0ms 它们不该有意识。`
        const first = parts[1] ?? "";
        const ms = parseMsToken(first);
        if (ms === null) return { ok: false, message: "@narrate 停顿必须是非负毫秒数，如 0ms。" };
        const consumed = ms === undefined ? command.length : trimmed.indexOf(first) + first.length;
        const text = trimmed.slice(consumed).trim();
        if (!text) return { ok: false, message: "@narrate 需要旁白文本。" };
        return { ok: true, instruction: pruneUndefined({ t: "narrate", text, ms }) as Instruction };
      }
      case "@set": {
        const key = parts[1];
        const valueRaw = parts.slice(2).join(" ");
        if (!key) return { ok: false, message: "@set 需要变量名。" };
        if (!valueRaw) return { ok: false, message: "@set 需要变量值。" };
        if (parts[2] === "=") {
          const expr = parts.slice(3).join(" ").trim();
          if (!expr) return { ok: false, message: "@set 表达式不能为空。" };
          return { ok: true, instruction: { t: "set", key, expr } as Instruction };
        }
        return { ok: true, instruction: { t: "set", key, value: parseScenarioValue(valueRaw) } as Instruction };
      }
      case "@inputName":
        return parseNameInputCommand(command, trimmed);
      case "@completeEnding": {
        const endingId = parts[1];
        if (!endingId) return { ok: false, message: "@completeEnding 需要结局 ID。" };
        return { ok: true, instruction: { t: "completeEnding", endingId } as Instruction };
      }
      case "@effect": {
        const type = parts[1];
        if (!type || !EFFECT_TYPES.has(type)) return { ok: false, message: "@effect 类型必须是 shake、flash 或 blur。" };
        const rest = readOptionTokens(parts.slice(2));
        if (!rest.ok) return { ok: false, message: `@effect ${rest.message}` };
        if (rest.flags.length > 0) return { ok: false, message: `@effect 不认识「${rest.flags[0]}」。` };
        if (rest.words.length > 1) return { ok: false, message: `@effect 不认识「${rest.words[1]}」。` };
        const intensity = rest.words.length === 1 ? Number(rest.words[0]) : undefined;
        if (intensity != null && (!Number.isFinite(intensity) || intensity < 0 || intensity > 20)) {
          return { ok: false, message: "@effect 强度必须是 0–20 的数字。" };
        }
        return {
          ok: true,
          instruction: pruneUndefined({ t: "effect", type, intensity, ms: rest.ms }) as Instruction,
        };
      }
      case "@transition": {
        const type = parts[1];
        if (!type || !TRANSITION_TYPES.has(type)) {
          return { ok: false, message: "@transition 类型必须是 fade_in、fade_out、white_in、white_out 或 black。" };
        }
        const rest = readOptionTokens(parts.slice(2));
        if (!rest.ok) return { ok: false, message: `@transition ${rest.message}` };
        if (rest.words.length > 0 || rest.flags.length > 0) {
          return { ok: false, message: `@transition 不认识「${rest.words[0] ?? rest.flags[0]}」。` };
        }
        return {
          ok: true,
          instruction: pruneUndefined({ t: "transition", type, ms: rest.ms }) as Instruction,
        };
      }
      case "@unlock": {
        const kind = parts[1];
        const id = parts[2];
        if (!kind || !["cg", "music", "replay", "endings"].includes(kind)) {
          return { ok: false, message: "@unlock 类型必须是 cg、music、replay 或 endings。" };
        }
        if (!id) return { ok: false, message: "@unlock 需要解锁 ID。" };
        return { ok: true, instruction: { t: "unlock", kind, id } as Instruction };
      }
      case "@showCg": {
        const id = parts[1];
        if (!id) return { ok: false, message: "@showCg 需要 CG ID。" };
        return { ok: true, instruction: { t: "showCg", id } as Instruction };
      }
      case "@playVideo": {
        const id = parts[1];
        if (!id) return { ok: false, message: "@playVideo 需要 video ID。" };
        const skippableRaw = parts[2];
        const skippable = skippableRaw == null ? undefined : parseScenarioBoolean(skippableRaw);
        if (skippableRaw != null && skippable == null) return { ok: false, message: "@playVideo skippable 必须是 true 或 false。" };
        return { ok: true, instruction: { t: "playVideo", id, skippable } as Instruction };
      }
      default:
        return { ok: false, message: `未知命令：${command}` };
    }
  }

  const sayMatch = trimmed.match(/^([^:：\s][^:：]*?)\s*[:：]\s*(.*)$/);
  if (sayMatch) {
    const speaker = parseSpeakerHead(sayMatch[1].trim());
    if (!speaker.ok) return { ok: false, message: speaker.message };
    const sayText = sayMatch[2].trim();
    if (!sayText) return { ok: false, message: "台词文本不能为空。" };
    return {
      ok: true,
      instruction: pruneUndefined({
        t: "say",
        who: speaker.who,
        expr: speaker.expr,
        text: sayText,
        voice: speaker.voice,
        ms: speaker.ms,
      }) as Instruction,
    };
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
  if (instructions.length > 0 && !isBlockingInstruction(instructions[instructions.length - 1])) {
    lines.push("@continue");
  }
  return lines.join("\n").trimEnd();
}

export function formatScenarioInstruction(instruction: Instruction): string {
  const projectedInstruction = withoutStoryPointId(instruction);
  const readable = formatReadableScenarioInstruction(projectedInstruction);
  const reparsed = parseScenarioLine(readable);
  if (reparsed.ok && reparsed.instruction && instructionsAreEquivalent(reparsed.instruction, projectedInstruction)) {
    return readable;
  }
  return `@instruction ${stringifyScenarioJson(projectedInstruction)}`;
}

export function isStoryPointInstruction(instruction: Pick<Instruction, "t">): boolean {
  const policy = instructionPolicies[instruction.t] as { storyPoint?: boolean };
  return policy.storyPoint === true;
}

export function withoutStoryPointId(instruction: Instruction): Instruction {
  if (instruction.t === "completeEnding") return { t: "completeEnding", endingId: instruction.endingId } as Instruction;
  if (!isStoryPointInstruction(instruction) || !("id" in instruction)) return instruction;
  const projected = { ...instruction } as Instruction & { id?: string };
  delete projected.id;
  return projected;
}

function joinTokens(tokens: Array<string | undefined>): string {
  return tokens.filter((token): token is string => token != null && token !== "").join(" ");
}

function msToken(ms: number | undefined): string | undefined {
  return ms === undefined ? undefined : `${ms}ms`;
}

/** 台词的表情/语音/停顿写在冒号左边：`雪(hurt, voice=yuki_001, 1800ms): 台词`。 */
function joinSpeakerOptions(expr: string | undefined, voice: string | undefined, ms: number | undefined): string {
  const options = [
    expr,
    voice ? `voice=${voice}` : undefined,
    msToken(ms),
  ].filter((token): token is string => token != null && token !== "");
  return options.length === 0 ? "" : `(${options.join(", ")})`;
}

function formatReadableScenarioInstruction(instruction: Instruction): string {
  const defaults = INSTRUCTION_DEFAULTS[instruction.t as keyof typeof INSTRUCTION_DEFAULTS] as Record<string, unknown> | undefined;
  switch (instruction.t) {
    case "bg":
      return joinTokens([
        "@bg",
        instruction.id,
        instruction.trans === defaults?.trans ? undefined : instruction.trans,
        instruction.ms === defaults?.ms ? undefined : msToken(instruction.ms),
      ]);
    case "bgm":
      return joinTokens([
        "@bgm",
        instruction.id,
        instruction.fade === defaults?.fade ? undefined : msToken(instruction.fade),
        instruction.loop === defaults?.loop || instruction.loop === undefined
          ? undefined
          : instruction.loop ? "loop" : "once",
      ]);
    case "sfx":
      return `@sfx ${instruction.id}`;
    case "voice":
      return `@voice ${instruction.id}`;
    case "char": {
      const hasNonDefaultPos = instruction.pos !== undefined && instruction.pos !== defaults?.pos;
      const expr = instruction.expr === defaults?.expr && !hasNonDefaultPos ? undefined : instruction.expr;
      const pos = instruction.pos === defaults?.pos ? undefined : instruction.pos;
      return joinTokens([
        "@char",
        instruction.id,
        expr,
        pos,
        instruction.trans === defaults?.trans ? undefined : instruction.trans,
        instruction.ms === defaults?.ms ? undefined : msToken(instruction.ms),
        instruction.clear ? "clear" : undefined,
        instruction.remove ? "out" : undefined,
      ]);
    }
    case "say": {
      const expr = instruction.expr === defaults?.expr ? undefined : instruction.expr;
      const head = joinSpeakerOptions(expr, instruction.voice, instruction.ms);
      return `${instruction.who}${head}: ${instruction.text}`;
    }
    case "narrate":
      return instruction.ms === undefined
        ? instruction.text
        : `@narrate ${msToken(instruction.ms)} ${instruction.text}`;
    case "set":
      return "expr" in instruction && instruction.expr != null
        ? `@set ${instruction.key} = ${instruction.expr}`
        : `@set ${instruction.key} ${formatScenarioValue(instruction.value ?? null)}`;
    case "completeEnding":
      return `@completeEnding ${instruction.endingId}`;
    case "unlock":
      return `@unlock ${instruction.kind} ${instruction.id}`;
    case "showCg":
      return `@showCg ${instruction.id}`;
    case "playVideo":
      return `@playVideo ${instruction.id}${instruction.skippable == null ? "" : ` ${instruction.skippable}`}`;
    case "inputName":
      return joinTokens([
        "@inputName",
        instruction.key,
        instruction.maxLength === defaults?.maxLength || instruction.maxLength === undefined
          ? undefined
          : String(instruction.maxLength),
        JSON.stringify(instruction.prompt),
        instruction.default === undefined ? undefined : JSON.stringify(instruction.default),
      ]);
    case "wait":
      return `@wait ${instruction.ms}`;
    case "effect":
      return joinTokens([
        "@effect",
        instruction.type,
        instruction.intensity === defaults?.intensity || instruction.intensity === undefined
          ? undefined
          : String(instruction.intensity),
        instruction.ms === defaults?.ms ? undefined : msToken(instruction.ms),
      ]);
    case "transition":
      return joinTokens([
        "@transition",
        instruction.type,
        instruction.ms === defaults?.ms ? undefined : msToken(instruction.ms),
      ]);
    case "pause":
      return "@pause";
  }
}

function instructionsAreEquivalent(left: Instruction, right: Instruction): boolean {
  return jsonValuesAreEquivalent(withInstructionDefaults(left), withInstructionDefaults(right));
}

function jsonValuesAreEquivalent(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => jsonValuesAreEquivalent(value, right[index]));
  }
  if (isJsonObject(left) || isJsonObject(right)) {
    if (!isJsonObject(left) || !isJsonObject(right)) return false;
    const leftKeys = Object.keys(left).filter((key) => left[key] !== undefined);
    const rightKeys = Object.keys(right).filter((key) => right[key] !== undefined);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key)
      && jsonValuesAreEquivalent(left[key], right[key]));
  }
  return false;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringifyScenarioJson(value: unknown): string {
  if (typeof value === "number" && Object.is(value, -0)) return "-0";
  if (Array.isArray(value)) {
    return `[${value.map((item) => stringifyScenarioJson(item)).join(",")}]`;
  }
  if (isJsonObject(value)) {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => `${JSON.stringify(key)}:${stringifyScenarioJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized == null) throw new TypeError("Scenario instructions must contain JSON values only.");
  return serialized;
}

export function isBlockingInstruction(instruction: Instruction): boolean {
  return instruction.t === "say"
    || instruction.t === "narrate"
    || instruction.t === "wait"
    || instruction.t === "pause"
    || instruction.t === "inputName";
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

function parseScenarioBoolean(raw: string): boolean | null {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
}

function formatScenarioValue(value: string | number | boolean | null): string {
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}
