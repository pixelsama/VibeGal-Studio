import { variableKind, type Instruction } from "@vibegal/engine";
import type { ProjectData } from "../../lib/types";
import {
  defaultInstruction,
  type InsertableKind,
} from "./instructions";
import { variableLabel } from "./storyState";

export type CommandMenuSource = "trigger" | "line-plus";

export type ScenarioParameterKind =
  | "character"
  | "expression"
  | "background"
  | "bgm"
  | "sfx"
  | "voice"
  | "cg"
  | "video"
  | "story-state"
  | "name-state"
  | "cg-unlock"
  | "music-unlock"
  | "replay-unlock"
  | "ending-unlock";

export interface ScenarioParameterTrigger {
  kind: ScenarioParameterKind;
  query: string;
  replaceStart: number;
  replaceEnd: number;
  line: number;
  ownerId?: string;
}

export interface ScenarioParameterOption {
  id: string;
  label: string;
  detail: string;
}

export function scenarioParameterTriggerAtCursor(
  text: string,
  cursorOffset: number,
): ScenarioParameterTrigger | null {
  const bounds = lineBoundsAtCursor(text, cursorOffset);
  const line = text.slice(bounds.start, bounds.end);
  const localOffset = bounds.offset - bounds.start;
  const prefix = line.slice(0, localOffset);

  if (!prefix.trimStart().startsWith("@")) {
    if (!/[:：]/.test(line)) return null;
    const speaker = prefix.match(/^\s*([^:：\s(),]*)(?:\(([^,):：\s]*))?$/);
    if (!speaker) return null;
    if (speaker[2] !== undefined) {
      return localTrigger(bounds, "expression", speaker[2], localOffset - speaker[2].length, localOffset, speaker[1]);
    }
    return localTrigger(bounds, "character", speaker[1], prefix.lastIndexOf(speaker[1]), localOffset);
  }

  const tokens = Array.from(line.matchAll(/\S+/g)).map((match) => ({
    value: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
  const current = tokenAtCursor(tokens, localOffset);
  const index = current?.index ?? tokens.length;
  const query = current?.token.value ?? "";
  const replaceStart = current?.token.start ?? localOffset;
  const replaceEnd = current?.token.end ?? localOffset;
  const command = tokens[0]?.value;

  let kind: ScenarioParameterKind | null = null;
  let ownerId: string | undefined;
  if (index === 1) {
    kind = {
      "@bg": "background",
      "@bgm": "bgm",
      "@sfx": "sfx",
      "@voice": "voice",
      "@char": "character",
      "@showCg": "cg",
      "@playVideo": "video",
      "@set": "story-state",
      "@inputName": "name-state",
      "@completeEnding": "ending-unlock",
    }[command ?? ""] as ScenarioParameterKind | undefined ?? null;
  } else if (command === "@char" && index === 2) {
    kind = "expression";
    ownerId = tokens[1]?.value;
  } else if (command === "@unlock" && index === 2) {
    kind = unlockParameterKind(tokens[1]?.value);
  }
  if (!kind) return null;
  return localTrigger(bounds, kind, query, replaceStart, replaceEnd, ownerId);
}

export function scenarioParameterOptions(
  trigger: ScenarioParameterTrigger,
  project: ProjectData,
): ScenarioParameterOption[] {
  const manifest = project.content.manifest;
  let options: ScenarioParameterOption[];
  switch (trigger.kind) {
    case "character":
      options = Object.entries(manifest.characters).map(([id, item]) => option(id, item.name));
      break;
    case "expression":
      options = Object.keys(manifest.characters[trigger.ownerId ?? ""]?.sprites ?? {}).map((id) => option(id, id));
      break;
    case "background":
      options = Object.keys(manifest.backgrounds).map((id) => option(id, id));
      break;
    case "bgm":
    case "sfx":
    case "voice":
      options = Object.keys(manifest.audio[trigger.kind]).map((id) => option(id, id));
      break;
    case "cg":
      options = Object.entries(manifest.cg).map(([id, item]) => option(id, item.name));
      break;
    case "video":
      options = Object.entries(manifest.videos).map(([id, item]) => option(id, item.name));
      break;
    case "story-state":
      options = Object.entries(project.content.variables?.variables ?? {}).map(([id, declaration]) => (
        option(id, variableLabel(id, declaration, manifest))
      ));
      break;
    case "name-state":
      options = Object.entries(project.content.variables?.variables ?? {})
        .filter(([, declaration]) => declaration.type === "string" && variableKind(declaration) === "text")
        .map(([id, declaration]) => option(id, variableLabel(id, declaration, manifest)));
      break;
    case "cg-unlock":
      options = unlockOptions(manifest.unlocks.cg);
      break;
    case "music-unlock":
      options = unlockOptions(manifest.unlocks.music);
      break;
    case "replay-unlock":
      options = unlockOptions(manifest.unlocks.replay);
      break;
    case "ending-unlock":
      options = unlockOptions(manifest.unlocks.endings);
      break;
  }
  const query = trigger.query.trim().toLowerCase();
  return query
    ? options.filter((item) => item.id.toLowerCase().includes(query) || item.label.toLowerCase().includes(query))
    : options;
}

export function insertScenarioParameterAtCursor(
  text: string,
  trigger: ScenarioParameterTrigger,
  id: string,
): { text: string; cursorOffset: number } {
  const nextText = `${text.slice(0, trigger.replaceStart)}${id}${text.slice(trigger.replaceEnd)}`;
  return { text: nextText, cursorOffset: trigger.replaceStart + id.length };
}

function localTrigger(
  bounds: ReturnType<typeof lineBoundsAtCursor>,
  kind: ScenarioParameterKind,
  query: string,
  replaceStart: number,
  replaceEnd: number,
  ownerId?: string,
): ScenarioParameterTrigger {
  return {
    kind,
    query,
    replaceStart: bounds.start + replaceStart,
    replaceEnd: bounds.start + replaceEnd,
    line: bounds.line,
    ...(ownerId ? { ownerId } : {}),
  };
}

function tokenAtCursor(tokens: Array<{ value: string; start: number; end: number }>, offset: number) {
  const index = tokens.findIndex((token) => offset >= token.start && offset <= token.end);
  return index >= 0 ? { index, token: tokens[index] } : null;
}

function unlockParameterKind(kind: string | undefined): ScenarioParameterKind | null {
  if (kind === "cg") return "cg-unlock";
  if (kind === "music") return "music-unlock";
  if (kind === "replay") return "replay-unlock";
  if (kind === "endings") return "ending-unlock";
  return null;
}

function option(id: string, label: string | undefined): ScenarioParameterOption {
  return { id, label: label?.trim() || id, detail: id };
}

function unlockOptions(registry: Record<string, { title?: string }>): ScenarioParameterOption[] {
  return Object.entries(registry).map(([id, item]) => option(id, item.title));
}

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
  { kind: "set", label: "故事状态", detail: "改变故事状态", aliases: ["set", "state", "状态"] },
  { kind: "inputName", label: "玩家命名", detail: "请玩家输入名字", aliases: ["inputname", "name", "命名", "名字"] },
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
  const firstNameState = Object.entries(project.content.variables?.variables ?? {})
    .find(([, declaration]) => declaration.type === "string" && variableKind(declaration) === "text")?.[0]
    ?? "playerName";

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
    case "inputName":
      return { ...draft, key: firstNameState };
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
