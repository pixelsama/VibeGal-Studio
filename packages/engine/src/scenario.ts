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
  | { ok: true; instruction: Instruction | null; suppressesImplicitPause?: boolean; block?: BlockHeaderKind }
  | { ok: false; message: string };

/** 块头种类：choice / if / else。供单行解析器标记块头（不构成指令）。 */
type BlockHeaderKind = "choice" | "if" | "else";

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

function parseCharCommand(parts: string[]): ParsedLine {
  const id = parts[1];
  if (!id) return { ok: false, message: "@char 需要角色 ID。" };
  const positional: string[] = [];
  let trans: "fade" | "cut" | "slide" | undefined;
  let ms: number | undefined;
  let scale: number | undefined;
  let moveFrom: string | undefined;
  let exprMs: number | undefined;
  let clear: boolean | undefined;
  let remove: boolean | undefined;
  let flip: boolean | undefined;

  for (const token of parts.slice(2)) {
    if (CHAR_TRANSITIONS.has(token)) {
      if (trans != null) return { ok: false, message: "@char 只能写一个转场。" };
      trans = token as "fade" | "cut" | "slide";
      continue;
    }
    if (token === "clear") clear = true;
    else if (token === "out") remove = true;
    else if (token === "flip") flip = true;
    else if (token.startsWith("scale=")) {
      const value = Number(token.slice("scale=".length));
      if (!Number.isFinite(value) || value < 0.1 || value > 4) {
        return { ok: false, message: "@char 缩放范围是 0.1–4。" };
      }
      scale = value;
    } else if (token.startsWith("from=")) {
      moveFrom = token.slice("from=".length);
      if (!moveFrom) return { ok: false, message: "@char 移动起点不能为空。" };
    } else if (token.startsWith("expr=")) {
      const parsed = parseMsToken(token.slice("expr=".length));
      if (parsed == null) return { ok: false, message: "@char 表情过渡需要写成 expr=180ms。" };
      exprMs = parsed;
    } else {
      const parsed = parseMsToken(token);
      if (parsed === null) return { ok: false, message: `@char 时长必须写成毫秒数，如 600ms（收到「${token}」）。` };
      if (parsed !== undefined) {
        if (ms != null) return { ok: false, message: "@char 只能写一个转场时长。" };
        ms = parsed;
      } else {
        positional.push(token);
      }
    }
  }

  if (positional.length > 2) return { ok: false, message: `@char 不认识「${positional[2]}」。` };
  const [expr, pos] = positional;
  return {
    ok: true,
    instruction: pruneUndefined({
      t: "char",
      id,
      expr,
      pos,
      trans,
      ms,
      clear,
      remove,
      scale,
      flip,
      moveFrom,
      exprMs,
    }) as Instruction,
  };
}

// ── Spec 35 Phase 2：缩进树解析 ──────────────────────────────────────────
//
// choice / if 含嵌套 Instruction[]，行式 DSL 必须感知缩进才能可读表达。
// 设计：
// - `parseScenarioText` 仍是顶层入口（帧语义 + 顶层指令序列），但识别
//   `choice` / `if` / `else` 块头，递归收集缩进的 body / then / else。
// - 帧语义（空行 = 隐式 pause）只作用于**顶层指令序列**；option body /
//   if 分支内不注入隐式 pause（紧凑反应演出）。
// - `@instruction {json}` 逃生路径保留：任何无法用可读语法表达的 choice/if
//   仍可走 JSON（round-trip 不变）。
// - `parseScenarioLine` 保持单行叶子指令语义（被 scenarioFrames /
//   scenarioHighlight 按行调用），不感知缩进。

/** 行首缩进的「展开宽度」：tab = 4，空格原值，其余 = 0。 */
function indentWidth(raw: string): number {
  let width = 0;
  for (const ch of raw) {
    if (ch === " ") width += 1;
    else if (ch === "\t") width += 4;
    else break;
  }
  return width;
}

interface RawLine {
  /** 0 起始下标。 */
  index: number;
  raw: string;
  text: string;
  indent: number;
  blank: boolean;
}

function splitRawLines(text: string): RawLine[] {
  return text.replace(/\r\n/g, "\n").split("\n").map((raw, index) => {
    const textPart = raw.trim();
    return { index, raw, text: textPart, indent: indentWidth(raw), blank: textPart.length === 0 };
  });
}

interface BlockHeader {
  kind: "choice" | "if" | "else";
  /** 块头行 `choice`/`if`/`else` 关键字之后的剩余文本（condition / prompt / id）。 */
  tail: string;
}

/** 识别 choice / if / else 块头。非块头行返回 null。 */
function parseBlockHeader(text: string): BlockHeader | null {
  // choice / if / else 必须是行的第一个词；后续是 tail。
  const match = text.match(/^(choice|if|else)(?:\s+(.*))?$/);
  if (!match) return null;
  return { kind: match[1] as BlockHeader["kind"], tail: (match[2] ?? "").trim() };
}

/** choice / if 块头 tail 里可选的 `#id` 前缀；返回 [id, rest]。 */
function takeInstructionIdFromTail(tail: string): { id?: string; rest: string } {
  const match = tail.match(/^#(\S+)(?:\s+(.*))?$/);
  if (!match) return { rest: tail };
  return { id: match[1], rest: (match[2] ?? "").trim() };
}

/** option 行 / option body 内的 `@to <nodeId>` 标记，可内联在 option 行尾或独占一行。 */
const TO_TOKEN_RE = /@to\s+(\S+)/;

/** 从一段文本里抽取并剔除 `@to <id>`；返回 [剩余文本, to]。 */
function extractInlineTo(text: string): { text: string; to?: string } {
  const match = text.match(TO_TOKEN_RE);
  if (!match) return { text };
  const to = match[1];
  const cleaned = text.replace(TO_TOKEN_RE, "").trim();
  return { text: cleaned, to };
}

interface BlockParseAccumulator {
  diagnostics: ScenarioDiagnostic[];
}

/**
 * 从 `start`（含）起收集所有缩进严格大于 `parentIndent` 的连续行（跳过块内空行，
 * 但空行不终止块——块在「缩进 ≤ parentIndent 的非空行」处终止）。
 * 返回 [收集到的子行, 消费到的下一行下标（不含）]。
 */
function collectIndentedBlock(lines: RawLine[], start: number, parentIndent: number): {
  children: RawLine[];
  next: number;
} {
  const children: RawLine[] = [];
  let i = start;
  // 块在遇到缩进 ≤ parentIndent 的非空行时结束；中间的空行归属于块内（被跳过）。
  while (i < lines.length) {
    const line = lines[i];
    if (line.blank) {
      i += 1;
      continue;
    }
    if (line.indent <= parentIndent) break;
    children.push(line);
    i += 1;
  }
  return { children, next: i };
}

/** 把一组同级行解析成 Instruction[]（叶子指令）；不处理帧/pause。 */
function parseLeafLines(children: RawLine[], acc: BlockParseAccumulator): Instruction[] {
  const out: Instruction[] = [];
  for (const child of children) {
    const parsed = parseScenarioLine(child.text);
    if (!parsed.ok) {
      acc.diagnostics.push({ line: child.index + 1, message: parsed.message });
      continue;
    }
    if (parsed.instruction) out.push(parsed.instruction);
  }
  return out;
}

/**
 * 把一组同级行解析成 Instruction[]，支持嵌套 choice / if 块。
 * `lines` 是完整原始行数组；`children` 是待解析的子行（带原始 .index）。
 */
function parseChildInstructions(
  lines: RawLine[],
  children: RawLine[],
  acc: BlockParseAccumulator,
): Instruction[] {
  const out: Instruction[] = [];
  let ci = 0;
  while (ci < children.length) {
    const child = children[ci];
    const header = parseBlockHeader(child.text);
    if (header?.kind === "choice") {
      const { instruction, next } = parseChoiceBlock(lines, child, acc);
      if (instruction) out.push(instruction);
      ci = findChildIndex(children, next);
      continue;
    }
    if (header?.kind === "if") {
      const { instruction, next } = parseIfBlock(lines, child, acc);
      if (instruction) out.push(instruction);
      ci = findChildIndex(children, next);
      continue;
    }
    if (header?.kind === "else") {
      acc.diagnostics.push({ line: child.index + 1, message: "else 必须跟在 if 之后。" });
      ci += 1;
      continue;
    }
    const parsed = parseScenarioLine(child.text);
    if (!parsed.ok) {
      acc.diagnostics.push({ line: child.index + 1, message: parsed.message });
    } else if (parsed.instruction) {
      out.push(parsed.instruction);
    }
    ci += 1;
  }
  return out;
}

interface ChoiceOptionBlock {
  /** option 标题行（裸文本，可能内联 @to）。 */
  header: RawLine;
  /** option 标题行之下、缩进更深的子行（body 指令 + 可能的独占 @to 行）。 */
  children: RawLine[];
}

/**
 * 把 choice 的子行序列切成若干 option 块：每个 option 由一条缩进最浅的非空行
 * （option 标题）开头，其后所有缩进更深的行归为该 option 的 body。
 */
function splitChoiceOptions(children: RawLine[]): { blocks: ChoiceOptionBlock[]; diagnostics: ScenarioDiagnostic[] } {
  const blocks: ChoiceOptionBlock[] = [];
  const diagnostics: ScenarioDiagnostic[] = [];
  if (children.length === 0) {
    diagnostics.push({ line: 0, message: "choice 需要至少一个选项。" });
    return { blocks, diagnostics };
  }
  const optionIndent = children[0].indent;
  let i = 0;
  while (i < children.length) {
    const header = children[i];
    // option 标题行：缩进最浅（== optionIndent）。更深的行是上一个 option 的 body。
    if (header.indent < optionIndent) {
      diagnostics.push({ line: header.index + 1, message: "choice 选项缩进不一致。" });
      i += 1;
      continue;
    }
    if (header.indent > optionIndent) {
      // 没有 option 标题就出现了更深的行——归到上一个 option（容错）。
      if (blocks.length > 0) {
        blocks[blocks.length - 1].children.push(header);
      } else {
        diagnostics.push({ line: header.index + 1, message: "choice 选项内容缺少选项标题。" });
      }
      i += 1;
      continue;
    }
    const block: ChoiceOptionBlock = { header, children: [] };
    i += 1;
    while (i < children.length && children[i].indent > optionIndent) {
      block.children.push(children[i]);
      i += 1;
    }
    blocks.push(block);
  }
  return { blocks, diagnostics };
}

/**
 * 从 option 子行里抽取 `@to`、`@effects` 块、body 指令。
 * body 指令支持嵌套 choice / if（递归）。`lines` 始终是完整原始行数组，
 * `block.children` 是该 option 的子行（带原始 .index）。
 */
function parseOptionChildren(
  lines: RawLine[],
  block: ChoiceOptionBlock,
  acc: BlockParseAccumulator,
): { to?: string; effects?: Instruction[]; body: Instruction[] } {
  const children = block.children;
  let to: string | undefined;
  let effects: Instruction[] | undefined;
  const body: Instruction[] = [];
  // cursor 是 children 数组的本地下标；用 child.index 投影回 lines 全局下标。
  let ci = 0;
  while (ci < children.length) {
    const child = children[ci];
    // 独占的 @to 行
    const toMatch = child.text.match(/^@to\s+(\S+)$/);
    if (toMatch) {
      to = toMatch[1];
      ci += 1;
      continue;
    }
    // @effects 块：`@effects` 行 + 缩进的 SetInstruction 子行
    if (child.text === "@effects") {
      const effectChildren: RawLine[] = [];
      ci += 1;
      while (ci < children.length && children[ci].indent > child.indent) {
        effectChildren.push(children[ci]);
        ci += 1;
      }
      effects = parseLeafLines(effectChildren, acc);
      continue;
    }
    // 嵌套 choice / if 块（在完整 lines 数组上递归）
    const header = parseBlockHeader(child.text);
    if (header?.kind === "choice") {
      const { instruction, next } = parseChoiceBlock(lines, child, acc);
      if (instruction) body.push(instruction);
      // next 是 lines 全局下标；投影回 children 本地下标。
      ci = findChildIndex(children, next);
      continue;
    }
    if (header?.kind === "if") {
      const { instruction, next } = parseIfBlock(lines, child, acc);
      if (instruction) body.push(instruction);
      ci = findChildIndex(children, next);
      continue;
    }
    if (header?.kind === "else") {
      acc.diagnostics.push({ line: child.index + 1, message: "else 必须跟在 if 之后。" });
      // An orphan else owns the more-indented lines beneath it syntactically;
      // skip that malformed subtree instead of silently leaking its body into
      // the surrounding choice option.
      ci += 1;
      while (ci < children.length && children[ci].indent > child.indent) ci += 1;
      continue;
    }
    // 叶子指令行
    const parsed = parseScenarioLine(child.text);
    if (!parsed.ok) {
      acc.diagnostics.push({ line: child.index + 1, message: parsed.message });
    } else if (parsed.instruction) {
      body.push(parsed.instruction);
    }
    ci += 1;
  }
  return { to, effects, body };
}

/** 把全局行下标 `globalIndex` 投影到 children 本地下标（找不到则末尾）。 */
function findChildIndex(children: RawLine[], globalIndex: number): number {
  for (let k = 0; k < children.length; k += 1) {
    if (children[k].index >= globalIndex) return k;
  }
  return children.length;
}

interface ChoiceOptionLike {
  text: string;
  to?: string;
  body?: Instruction[];
  effects?: Instruction[];
}

/** 递归解析 choice 块。`lines` 是完整原始行数组；返回 next 为全局行下标。 */
function parseChoiceBlock(
  lines: RawLine[],
  headerLine: RawLine,
  acc: BlockParseAccumulator,
): { instruction: Instruction | null; next: number } {
  const header = parseBlockHeader(headerLine.text)!;
  const { id, rest: promptRest } = takeInstructionIdFromTail(header.tail);
  const prompt = promptRest.length > 0 ? promptRest : null;
  const { children, next } = collectIndentedBlock(lines, headerLine.index + 1, headerLine.indent);
  const { blocks, diagnostics } = splitChoiceOptions(children);
  for (const d of diagnostics) acc.diagnostics.push(d);
  const options = blocks.map((block) => {
    const { to: inlineTo, text: optionText } = extractInlineTo(block.header.text);
    const parsed = parseOptionChildren(lines, block, acc);
    const to = inlineTo ?? parsed.to;
    return pruneUndefined({
      text: optionText,
      to,
      effects: parsed.effects,
      body: parsed.body.length > 0 ? parsed.body : undefined,
    }) as ChoiceOptionLike;
  });
  if (options.length === 0) {
    acc.diagnostics.push({ line: headerLine.index + 1, message: "choice 需要至少一个选项。" });
    return { instruction: null, next };
  }
  const instruction = pruneUndefined({
    t: "choice" as const,
    id,
    prompt,
    options,
  }) as Instruction;
  return { instruction, next };
}

/** 递归解析 if 块（含可选 else）。返回 [instruction, 消费到的下一行下标]。 */
function parseIfBlock(
  lines: RawLine[],
  headerLine: RawLine,
  acc: BlockParseAccumulator,
): { instruction: Instruction | null; next: number } {
  const header = parseBlockHeader(headerLine.text)!;
  const { id, rest: conditionRest } = takeInstructionIdFromTail(header.tail);
  const condition = conditionRest;
  if (!condition) {
    acc.diagnostics.push({ line: headerLine.index + 1, message: "if 需要条件表达式。" });
  }
  const thenChildren: RawLine[] = [];
  let i = headerLine.index + 1;
  // then 分支：缩进 > headerIndent 的连续行
  while (i < lines.length) {
    const line = lines[i];
    if (line.blank) { i += 1; continue; }
    if (line.indent <= headerLine.indent) break;
    thenChildren.push(line);
    i += 1;
  }
  // 可选 else：与 header 同级的 `else` 行
  let elseChildren: RawLine[] | null = null;
  if (i < lines.length && lines[i].indent === headerLine.indent && parseBlockHeader(lines[i].text)?.kind === "else") {
    i += 1;
    elseChildren = [];
    while (i < lines.length) {
      const line = lines[i];
      if (line.blank) { i += 1; continue; }
      if (line.indent <= headerLine.indent) break;
      elseChildren.push(line);
      i += 1;
    }
  }
  const then = parseChildInstructions(lines, thenChildren, acc);
  const elseBranch = elseChildren ? parseChildInstructions(lines, elseChildren, acc) : undefined;
  if (thenChildren.length === 0 && elseChildren == null) {
    acc.diagnostics.push({ line: headerLine.index + 1, message: "if 需要至少一条缩进正文；普通旁白请使用 @narrate。" });
  }
  if (!condition) return { instruction: null, next: i };
  const instruction = pruneUndefined({
    t: "if" as const,
    id,
    condition,
    then,
    else: elseBranch,
  }) as Instruction;
  return { instruction, next: i };
}

export function parseScenarioText(text: string): ScenarioParseResult {
  const lines = splitRawLines(text);
  const instructions: Instruction[] = [];
  const diagnostics: ScenarioDiagnostic[] = [];
  const acc: BlockParseAccumulator = { diagnostics };
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
    const line = lines[index];
    const lineNumber = index + 1;

    if (line.blank) {
      finishFrame();
      index += 1;
      continue;
    }

    // 顶层不允许裸 else（没有 if 配对）。
    const header = parseBlockHeader(line.text);
    if (header?.kind === "else") {
      diagnostics.push({ line: lineNumber, message: "else 必须跟在 if 之后。" });
      index += 1;
      continue;
    }

    if (header?.kind === "choice") {
      const { instruction, next } = parseChoiceBlock(lines, line, acc);
      if (instruction) {
        instructions.push(instruction);
        frameHasAnyInstruction = true;
        // choice 不是 blocking 指令（presentChoice 由运行时处理）。
      }
      index = next;
      continue;
    }

    if (header?.kind === "if") {
      const { instruction, next } = parseIfBlock(lines, line, acc);
      if (instruction) {
        instructions.push(instruction);
        frameHasAnyInstruction = true;
      }
      index = next;
      continue;
    }

    const parsed = parseScenarioLine(line.text);
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
  // acc.diagnostics 与 diagnostics 同一引用，块辅助函数已直接写入主数组。

  return diagnostics.length === 0
    ? { ok: true, instructions, diagnostics: [] }
    : { ok: false, instructions, diagnostics };
}

/**
 * Spec 35 Phase 2：定位光标行所属的 choice / if 块头指令。
 *
 * studio 的 `getScenarioSelection` 在光标落在块头行（choice / if / else）上时
 * 调用此函数取得完整指令。返回 null 表示该行不是块头或解析失败。
 */
export function findScenarioBlockHeaderAtLine(text: string, lineNumber: number): {
  instruction: Instruction;
  kind: "choice" | "if";
  startLine: number;
  endLine: number;
  topIndex: number;
} | null {
  const lines = splitRawLines(text);
  const target = lines.find((line) => line.index + 1 === lineNumber);
  if (!target) return null;
  const header = parseBlockHeader(target.text);
  if (!header || header.kind === "else") return null;
  // Use the parser on the prefix to count actual instructions. Counting
  // top-level source lines is insufficient because a blank line can inject an
  // implicit pause for a non-blocking frame before this block header.
  const prefixResult = parseScenarioText(lines.slice(0, target.index).map((line) => line.raw).join("\n"));
  const topIndex = prefixResult.instructions.length;
  const result = parseScenarioText(text);
  const instruction = result.instructions[topIndex];
  if (!instruction || instruction.t !== header.kind) return null;
  const range = blockLineRange(lines, target);
  if (!range) return null;
  return { instruction, kind: header.kind, ...range, topIndex };
}

/** 计算块头指令占据的行范围（块头行到该块最后一个子行）。 */
function blockLineRange(lines: RawLine[], headerLine: RawLine): { startLine: number; endLine: number } | null {
  const startLine = headerLine.index + 1;
  let endLine = startLine;
  const isIfBlock = parseBlockHeader(headerLine.text)?.kind === "if";
  for (let i = headerLine.index + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.blank) continue;
    if (line.indent <= headerLine.indent) {
      // if 块的 else 行与 header 同缩进，仍属于该块。
      if (isIfBlock && line.indent === headerLine.indent && parseBlockHeader(line.text)?.kind === "else") {
        endLine = i + 1;
        continue;
      }
      break;
    }
    endLine = i + 1;
  }
  return { startLine, endLine };
}

export function parseScenarioLine(line: string): ParsedLine {
  const trimmed = line.trim();
  if (trimmed.length === 0) return { ok: true, instruction: null };

  // Spec 35 Phase 2：choice / if / else 是缩进块头，单行解析时不构成指令。
  // 块的嵌套结构由 parseScenarioText 的缩进感知逻辑处理；这里只标记种类，
  // 让 scenarioFrames / scenarioHighlight 不把块头误读成 narrate。
  const blockHeader = parseBlockHeader(trimmed);
  if (blockHeader) {
    return { ok: true, instruction: null, block: blockHeader.kind };
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
      case "@char":
        return parseCharCommand(parts);
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
  // Spec 35 Phase 2：choice / if 用缩进树可读表达。先尝试缩进树格式，再 round-trip
  // 校验；无法表达（如 option 文本含换行）时回退到 @instruction {json}。
  const readable = formatReadableScenarioInstructionBlock(projectedInstruction, 0);
  const reparsed = parseScenarioText(readable);
  // 顶层帧可能给非阻塞尾部注入隐式 pause，故只比较首条指令。
  const reparsedFirst = reparsed.instructions[0];
  if (
    reparsed.ok
    && reparsedFirst
    && instructionsAreEquivalent(reparsedFirst, projectedInstruction)
  ) {
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

/** 缩进单元（与解析器对齐：tab=4）。 */
const SCENARIO_INDENT_UNIT = "    ";

/**
 * 可读缩进树格式化（递归）。返回的字符串已含 `depth` 层缩进。
 * 叶子指令单行带前缀；choice / if 块头在 `depth`，子行在 `depth+1`（或
 * choice option body 在 `depth+2`）。
 */
function formatReadableScenarioInstructionBlock(instruction: Instruction, depth: number): string {
  if (instruction.t === "choice") {
    return formatChoiceBlock(instruction, depth);
  }
  if (instruction.t === "if") {
    return formatIfBlock(instruction, depth);
  }
  // 叶子指令：单行，带 depth 层缩进。
  return indentPrefix(depth) + formatReadableScenarioInstruction(instruction);
}

function formatChoiceBlock(instruction: Extract<Instruction, { t: "choice" }>, depth: number): string {
  const headerParts = ["choice"];
  if (instruction.id) headerParts.push(`#${instruction.id}`);
  if (instruction.prompt) headerParts.push(instruction.prompt);
  const lines: string[] = [indentPrefix(depth) + joinTokens(headerParts)];
  for (const option of instruction.options) {
    const optionParts = [option.text];
    if (option.to != null && (!option.body || option.body.length === 0)) {
      optionParts.push(`@to ${option.to}`);
    }
    lines.push(indentPrefix(depth + 1) + joinTokens(optionParts));
    // effects 在 body 之前（与运行时语义一致）；用 @effects 块头标记，便于解析时
    // 与 body 区分（两者都可能含 set 指令）。
    if (option.effects && option.effects.length > 0) {
      lines.push(`${indentPrefix(depth + 2)}@effects`);
      for (const effect of option.effects) {
        lines.push(...formatReadableScenarioInstructionBlock(effect, depth + 3).split("\n"));
      }
    }
    if (option.body) {
      for (const bodyInstr of option.body) {
        lines.push(...formatReadableScenarioInstructionBlock(bodyInstr, depth + 2).split("\n"));
      }
    }
    if (option.to != null && option.body && option.body.length > 0) {
      lines.push(`${indentPrefix(depth + 2)}@to ${option.to}`);
    }
  }
  return lines.join("\n");
}

function formatIfBlock(instruction: Extract<Instruction, { t: "if" }>, depth: number): string {
  const headerParts = ["if"];
  if (instruction.id) headerParts.push(`#${instruction.id}`);
  headerParts.push(instruction.condition);
  const lines: string[] = [indentPrefix(depth) + joinTokens(headerParts)];
  for (const thenInstr of instruction.then) {
    lines.push(...formatReadableScenarioInstructionBlock(thenInstr, depth + 1).split("\n"));
  }
  if (instruction.else && instruction.else.length > 0) {
    lines.push(indentPrefix(depth) + "else");
    for (const elseInstr of instruction.else) {
      lines.push(...formatReadableScenarioInstructionBlock(elseInstr, depth + 1).split("\n"));
    }
  }
  return lines.join("\n");
}

/** `depth` 层缩进的前缀字符串。 */
function indentPrefix(depth: number): string {
  return depth <= 0 ? "" : SCENARIO_INDENT_UNIT.repeat(depth);
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
        instruction.scale === defaults?.scale || instruction.scale === undefined
          ? undefined
          : `scale=${instruction.scale}`,
        instruction.flip ? "flip" : undefined,
        instruction.moveFrom ? `from=${instruction.moveFrom}` : undefined,
        instruction.exprMs === defaults?.exprMs || instruction.exprMs === undefined
          ? undefined
          : `expr=${msToken(instruction.exprMs)}`,
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
    case "choice":
    case "if":
      // Spec 35 Phase 2：choice/if 由 formatReadableScenarioInstructionBlock 处理
      // （缩进树）。这里不会被单行 formatter 调用到，保留分支仅为穷尽性编译检查。
      return formatReadableScenarioInstructionBlock(instruction, 0);
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
