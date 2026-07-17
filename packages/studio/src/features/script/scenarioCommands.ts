import type { Instruction } from "@vibegal/engine";
import type { ProjectData } from "../../lib/types";
import {
  defaultInstruction,
  type InsertableKind,
} from "./instructions";

export type CommandMenuSource = "trigger" | "line-plus";

export interface ScenarioCommandOption {
  kind: InsertableKind;
  label: string;
  detail: string;
  aliases: string[];
}

const SCENARIO_COMMANDS: ScenarioCommandOption[] = [
  { kind: "narrate", label: "旁白", detail: "插入一行叙述文本", aliases: ["narrate", "text", "旁白"] },
  { kind: "say", label: "台词", detail: "插入角色台词", aliases: ["say", "dialog", "台词"] },
  { kind: "bg", label: "背景", detail: "切换背景", aliases: ["bg", "background", "背景"] },
  { kind: "bgm", label: "BGM", detail: "播放背景音乐", aliases: ["bgm", "music", "音乐"] },
  { kind: "sfx", label: "音效", detail: "播放音效", aliases: ["sfx", "sound", "音效"] },
  { kind: "voice", label: "语音", detail: "播放语音", aliases: ["voice", "语音"] },
  { kind: "char", label: "角色", detail: "登场或切换立绘", aliases: ["char", "character", "角色"] },
  { kind: "showCg", label: "CG", detail: "全屏展示一张 CG", aliases: ["showcg", "cg"] },
  { kind: "playVideo", label: "视频", detail: "播放一段视频", aliases: ["playvideo", "video", "视频"] },
  { kind: "wait", label: "等待", detail: "等待指定毫秒", aliases: ["wait", "等待"] },
  { kind: "effect", label: "效果", detail: "触发画面效果", aliases: ["effect", "fx", "效果"] },
  { kind: "transition", label: "转场", detail: "触发转场覆盖层", aliases: ["transition", "trans", "转场"] },
  { kind: "set", label: "变量", detail: "设置剧情变量", aliases: ["set", "var", "变量"] },
];

export interface ScenarioCommandTrigger {
  trigger: "@" | "/";
  query: string;
  replaceStart: number;
  replaceEnd: number;
  line: number;
}

export function scenarioCommandTriggerAtCursor(text: string, cursorOffset: number): ScenarioCommandTrigger | null {
  const bounds = lineBoundsAtCursor(text, cursorOffset);
  const prefix = text.slice(bounds.start, bounds.offset);
  const suffix = text.slice(bounds.offset, bounds.end);
  if (suffix.trim().length > 0) return null;

  const trimmedPrefix = prefix.trimStart();
  const leadingWhitespace = prefix.length - trimmedPrefix.length;
  const trigger = trimmedPrefix[0];
  if (trigger !== "@" && trigger !== "/") return null;

  const query = trimmedPrefix.slice(1);
  if (query.length > 0 && /\s/.test(query)) return null;

  return {
    trigger,
    query,
    replaceStart: bounds.start + leadingWhitespace,
    replaceEnd: bounds.end,
    line: bounds.line,
  };
}

export function insertScenarioCommandAtCursor(
  text: string,
  cursorOffset: number,
  commandText: string,
): { text: string; cursorOffset: number } {
  const trigger = scenarioCommandTriggerAtCursor(text, cursorOffset);
  if (trigger) {
    const nextText = `${text.slice(0, trigger.replaceStart)}${commandText}${text.slice(trigger.replaceEnd)}`;
    return { text: nextText, cursorOffset: trigger.replaceStart + commandText.length };
  }

  const bounds = lineBoundsAtCursor(text, cursorOffset);
  const lineText = text.slice(bounds.start, bounds.end);
  if (lineText.trim().length === 0) {
    const nextText = `${text.slice(0, bounds.start)}${commandText}${text.slice(bounds.end)}`;
    return { text: nextText, cursorOffset: bounds.start + commandText.length };
  }

  const nextText = `${text.slice(0, bounds.end)}\n${commandText}${text.slice(bounds.end)}`;
  return { text: nextText, cursorOffset: bounds.end + 1 + commandText.length };
}

export function scenarioCommandOptionsForQuery(query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return SCENARIO_COMMANDS;
  return SCENARIO_COMMANDS.filter((command) => (
    command.label.toLowerCase().includes(normalized)
    || command.kind.toLowerCase().includes(normalized)
    || command.aliases.some((alias) => alias.toLowerCase().includes(normalized))
  ));
}

export function defaultScenarioInstruction(kind: InsertableKind, project: ProjectData): Instruction {
  const draft = defaultInstruction(kind);
  const manifest = project.content.manifest;
  const firstCharacter = Object.keys(manifest.characters)[0] ?? "角色";
  const firstBackground = Object.keys(manifest.backgrounds)[0] ?? "背景";
  const firstBgm = Object.keys(manifest.audio.bgm)[0] ?? "bgm";
  const firstSfx = Object.keys(manifest.audio.sfx)[0] ?? "sfx";
  const firstVoice = Object.keys(manifest.audio.voice)[0] ?? "voice";
  const firstCg = Object.keys(manifest.cg ?? {})[0] ?? "cg";
  const firstVideo = Object.keys(manifest.videos ?? {})[0] ?? "video";

  switch (draft.t) {
    case "narrate":
      return { ...draft, text: "旁白" };
    case "say":
      return { ...draft, who: firstCharacter, text: "台词" };
    case "bg":
      return { ...draft, id: firstBackground };
    case "bgm":
      return { ...draft, id: firstBgm };
    case "sfx":
      return { ...draft, id: firstSfx };
    case "voice":
      return { ...draft, id: firstVoice };
    case "char":
      return { ...draft, id: firstCharacter };
    case "showCg":
      return { ...draft, id: firstCg };
    case "playVideo":
      return { ...draft, id: firstVideo };
    case "set":
      return { ...draft, key: "flag", value: true };
    default:
      return draft;
  }
}

function lineBoundsAtCursor(text: string, cursorOffset: number): { start: number; end: number; offset: number; line: number } {
  const offset = Math.max(0, Math.min(cursorOffset, text.length));
  const previousBreak = offset === 0 ? -1 : text.lastIndexOf("\n", offset - 1);
  const start = previousBreak + 1;
  const nextBreak = text.indexOf("\n", offset);
  const end = nextBreak === -1 ? text.length : nextBreak;
  const line = text.slice(0, offset).split("\n").length;
  return { start, end, offset, line };
}
