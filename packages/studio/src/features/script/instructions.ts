/**
 * Phase 10：节点内指令的只读摘要与插入辅助（纯函数）。
 *
 * 节点文件 = Instruction[]（t 判别联合，见 engine/schema.ts）。
 * 这里不引入新 DSL，只做摘要展示和最小占位对象的构造。
 */
import type { Instruction, Manifest } from "@galstudio/engine";

/** 大纲条目：在 JSON 数组中的下标 + 种类 + 人类可读标签。 */
export interface InstructionSummary {
  /** 在指令数组中的下标，点击可定位到 JSON 对应行。 */
  index: number;
  /** say / narrate / bg / bgm —— 块级大纲展示的稳定类别。 */
  kind: "say" | "narrate" | "bg" | "bgm";
  label: string;
}

const SUMMARIZED_KINDS = new Set(["say", "narrate", "bg", "bgm"]);
const LABEL_MAX = 40;

/**
 * 只读摘要 say/narrate/bg/bgm 四类指令，供 NodeEditor 块级大纲展示。
 * - say：`{who}: {text}`
 * - narrate：`{text}`
 * - bg：`背景 {id 或 manifest 名}`
 * - bgm：`BGM {id 或 manifest 名}`
 * text 超过 LABEL_MAX 字符时截断加省略号。
 */
export function summarizeInstructions(
  instructions: Instruction[],
  manifest?: Manifest | null,
): InstructionSummary[] {
  const summaries: InstructionSummary[] = [];
  instructions.forEach((instruction, index) => {
    if (!SUMMARIZED_KINDS.has(instruction.t)) return;
    switch (instruction.t) {
      case "say":
        summaries.push({ index, kind: "say", label: `${instruction.who}: ${truncate(instruction.text)}` });
        break;
      case "narrate":
        summaries.push({ index, kind: "narrate", label: truncate(instruction.text) });
        break;
      case "bg":
        summaries.push({ index, kind: "bg", label: `背景 ${assetName(manifest?.backgrounds?.[instruction.id], instruction.id)}` });
        break;
      case "bgm": {
        // audio 拆成 bgm/sfx/voice 三张子表，bgm 指令只查 bgm 表
        const path = manifest?.audio?.bgm?.[instruction.id];
        summaries.push({ index, kind: "bgm", label: `BGM ${assetName(path, instruction.id)}` });
        break;
      }
    }
  });
  return summaries;
}

/** 插入按钮支持的指令种类。 */
export type InsertableKind =
  | "narrate"
  | "say"
  | "bg"
  | "bgm"
  | "sfx"
  | "voice"
  | "char"
  | "wait"
  | "effect"
  | "transition"
  | "set";

/**
 * 构造各插入按钮的占位指令对象（带 schema 默认值，对齐 engine/schema.ts）。
 * 不走 InstructionSchema.parse()，因为 say/narrate 的 text 是 min(1)，
 * 空字符串会校验失败。这里直接拼出含默认字段的草稿对象，用户插入后再编辑。
 */
export function defaultInstruction(kind: InsertableKind): Instruction {
  switch (kind) {
    case "narrate":
      return { t: "narrate", text: "" };
    case "say":
      return { t: "say", who: "", expr: "default", text: "" };
    case "bg":
      return { t: "bg", id: "", trans: "fade", ms: 1000 };
    case "wait":
      return { t: "wait", ms: 1000 };
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
    case "effect":
      return { t: "effect", type: "shake", intensity: 6, ms: 400 };
    case "transition":
      return { t: "transition", type: "fade_in", ms: 1000 };
    case "set":
      return { t: "set", key: "flag", value: true };
  }
}

/**
 * 不可变插入：在 index 处插入一条指令，返回新数组（不改原数组）。
 * index 越界（< 0 或 > length）时追加到末尾。
 */
export function insertInstructionAt(
  instructions: Instruction[],
  index: number,
  instruction: Instruction,
): Instruction[] {
  const clamped = index < 0 || index > instructions.length ? instructions.length : index;
  const next = instructions.slice();
  next.splice(clamped, 0, instruction);
  return next;
}

function truncate(text: string): string {
  return text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX)}…` : text;
}

/** 资源名解析：manifest 里背景/音频存的是路径，没有独立 name 字段，退回用 id。 */
function assetName(_path: string | undefined, id: string): string {
  // manifest.backgrounds/audio 的值是文件路径（如 "assets/bg/x.png"），不是人类名。
  // 当前 schema 没有 name 字段，所以统一用 id 展示，保持稳定可读。
  return id;
}
