import type { RuntimeTextDiagnostic, RuntimeTextToken } from "./state";
import type { VariableRegistry } from "./types";

export type { RuntimeTextDiagnostic, RuntimeTextToken } from "./state";

export const RUNTIME_TEXT_MAX_DEPTH = 8;
export const RUNTIME_TEXT_MAX_TOKENS = 512;

export interface RuntimeTextContent {
  source: string;
  plainText: string;
  tokens: RuntimeTextToken[];
  diagnostics: RuntimeTextDiagnostic[];
}

export interface InterpolatedText {
  text: string;
  diagnostics: RuntimeTextDiagnostic[];
}

interface TextStyle {
  bold?: boolean;
  color?: string;
  ruby?: string;
}

interface OpenTag {
  name: "b" | "color" | "ruby";
  style: TextStyle;
}

export function interpolateRuntimeText(
  source: string,
  values: Readonly<Record<string, string | number | boolean | null>>,
  registry?: VariableRegistry,
): InterpolatedText {
  const diagnostics: RuntimeTextDiagnostic[] = [];
  const labelIds = new Map<string, string[]>();
  for (const [id, declaration] of Object.entries(registry?.variables ?? {})) {
    if (!declaration.label) continue;
    labelIds.set(declaration.label, [...(labelIds.get(declaration.label) ?? []), id]);
  }

  let text = "";
  let index = 0;
  while (index < source.length) {
    if (source.startsWith("{{", index)) {
      text += "{";
      index += 2;
      continue;
    }
    if (source.startsWith("}}", index)) {
      text += "}";
      index += 2;
      continue;
    }
    if (source[index] !== "{") {
      text += source[index];
      index += 1;
      continue;
    }

    const close = source.indexOf("}", index + 1);
    if (close < 0) {
      text += source.slice(index);
      break;
    }
    const placeholder = source.slice(index, close + 1);
    const name = source.slice(index + 1, close);
    if (!name || name.includes("{") || name.trim() !== name) {
      text += placeholder;
      index = close + 1;
      continue;
    }

    let id: string | undefined;
    if (Object.prototype.hasOwnProperty.call(values, name)) {
      id = name;
    } else {
      const matches = labelIds.get(name) ?? [];
      if (matches.length === 1) id = matches[0];
      if (matches.length > 1) {
        diagnostics.push({
          code: "text_ambiguous_variable_label",
          message: `故事状态显示名“${name}”对应多个状态，请改用稳定 ID。`,
          offset: index,
        });
      }
    }

    if (id && Object.prototype.hasOwnProperty.call(values, id)) {
      text += formatRuntimeValue(values[id]);
    } else {
      text += placeholder;
      if (!diagnostics.some((diagnostic) => (
        diagnostic.code === "text_ambiguous_variable_label" && diagnostic.offset === index
      ))) {
        diagnostics.push({
          code: "text_unknown_variable",
          message: `找不到故事状态“${name}”，已保留原占位符。`,
          offset: index,
        });
      }
    }
    index = close + 1;
  }

  return { text, diagnostics };
}

export function parseRuntimeText(
  source: string,
  themeColors?: Readonly<Record<string, string | number>>,
): RuntimeTextContent {
  const diagnostics: RuntimeTextDiagnostic[] = [];
  const tokens: RuntimeTextToken[] = [];
  const stack: OpenTag[] = [];
  let plainText = "";
  let index = 0;
  let limitReported = false;

  const appendText = (text: string, offset: number) => {
    if (!text) return;
    plainText += text;
    const style = stack.at(-1)?.style ?? {};
    const previous = tokens.at(-1);
    if (previous?.type === "text" && sameStyle(previous, style)) {
      previous.text += text;
      return;
    }
    if (tokens.length >= RUNTIME_TEXT_MAX_TOKENS) {
      if (!limitReported) {
        diagnostics.push({
          code: "text_markup_limit",
          message: `行内标记片段不能超过 ${RUNTIME_TEXT_MAX_TOKENS} 个，超出部分按普通文本显示。`,
          offset,
        });
        limitReported = true;
      }
      const fallback = tokens.at(-1);
      if (fallback?.type === "text") fallback.text += text;
      else tokens.push({ type: "text", text });
      return;
    }
    tokens.push({ type: "text", text, ...style });
  };

  while (index < source.length) {
    if (source[index] !== "[") {
      const next = source.indexOf("[", index);
      const end = next < 0 ? source.length : next;
      appendText(source.slice(index, end), index);
      index = end;
      continue;
    }

    const close = source.indexOf("]", index + 1);
    if (close < 0) {
      appendText(source.slice(index), index);
      diagnostics.push({
        code: "text_unclosed_markup",
        message: "行内标记缺少右方括号，已按普通文本显示。",
        offset: index,
      });
      break;
    }

    const literal = source.slice(index, close + 1);
    const body = source.slice(index + 1, close);
    if (body === "b" || body.startsWith("color=") || body.startsWith("ruby=")) {
      const name = body === "b" ? "b" : body.startsWith("color=") ? "color" : "ruby";
      const closing = `[/${name}]`;
      if (!source.slice(close + 1).includes(closing)) {
        appendText(literal, index);
        diagnostics.push({
          code: "text_unclosed_markup",
          message: `行内标记 ${literal} 缺少 ${closing}，已按普通文本显示。`,
          offset: index,
        });
        index = close + 1;
        continue;
      }
      if (stack.length >= RUNTIME_TEXT_MAX_DEPTH) {
        appendText(literal, index);
        diagnostics.push({
          code: "text_markup_limit",
          message: `行内标记嵌套不能超过 ${RUNTIME_TEXT_MAX_DEPTH} 层，已按普通文本显示。`,
          offset: index,
        });
        index = close + 1;
        continue;
      }

      const current = stack.at(-1)?.style ?? {};
      if (name === "color") {
        const color = body.slice("color=".length);
        const resolved = resolveRuntimeColor(color, themeColors);
        if (!resolved) {
          appendText(literal, index);
          diagnostics.push({
            code: "text_invalid_markup_value",
            message: `颜色 ${color || "（空）"} 不是安全的 #RRGGBB 色值或已登记主题色，已按普通文本显示。`,
            offset: index,
          });
          index = close + 1;
          continue;
        }
        stack.push({ name, style: { ...current, color: resolved } });
      } else if (name === "ruby") {
        const ruby = body.slice("ruby=".length);
        if (!ruby || ruby.length > 100 || ruby.includes("[")) {
          appendText(literal, index);
          diagnostics.push({
            code: "text_invalid_markup_value",
            message: "ruby 读音必须是 1–100 个普通字符，已按普通文本显示。",
            offset: index,
          });
          index = close + 1;
          continue;
        }
        stack.push({ name, style: { ...current, ruby } });
      } else {
        stack.push({ name, style: { ...current, bold: true } });
      }
      index = close + 1;
      continue;
    }

    if (body === "/b" || body === "/color" || body === "/ruby") {
      const name = body.slice(1) as OpenTag["name"];
      if (stack.at(-1)?.name === name) {
        stack.pop();
      } else {
        appendText(literal, index);
        diagnostics.push({
          code: "text_mismatched_markup",
          message: `行内结束标记 ${literal} 没有匹配的开始标记，已按普通文本显示。`,
          offset: index,
        });
      }
      index = close + 1;
      continue;
    }

    if (body.startsWith("pause=")) {
      const raw = body.slice("pause=".length);
      const ms = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
      if (!Number.isSafeInteger(ms) || ms < 0 || ms > 60_000) {
        appendText(literal, index);
        diagnostics.push({
          code: "text_invalid_markup_value",
          message: "行内停顿必须是 0–60000 毫秒，已按普通文本显示。",
          offset: index,
        });
      } else if (tokens.length < RUNTIME_TEXT_MAX_TOKENS) {
        tokens.push({ type: "pause", ms });
      } else if (!limitReported) {
        diagnostics.push({
          code: "text_markup_limit",
          message: `行内标记片段不能超过 ${RUNTIME_TEXT_MAX_TOKENS} 个，超出部分已忽略停顿。`,
          offset: index,
        });
        limitReported = true;
      }
      index = close + 1;
      continue;
    }

    appendText(literal, index);
    diagnostics.push({
      code: "text_unknown_markup",
      message: `不支持行内标记 ${literal}，已按普通文本显示。`,
      offset: index,
    });
    index = close + 1;
  }

  return { source, plainText, tokens, diagnostics };
}

export function formatRuntimeText(
  source: string,
  values: Readonly<Record<string, string | number | boolean | null>>,
  registry?: VariableRegistry,
  themeColors?: Readonly<Record<string, string | number>>,
): RuntimeTextContent {
  const interpolated = interpolateRuntimeText(source, values, registry);
  const parsed = parseRuntimeText(interpolated.text, themeColors);
  return {
    ...parsed,
    source,
    diagnostics: [...interpolated.diagnostics, ...parsed.diagnostics],
  };
}

export function runtimeTextPauseAt(content: RuntimeTextContent, plainTextOffset: number): number {
  let offset = 0;
  let delay = 0;
  for (const token of content.tokens) {
    if (token.type === "pause") {
      if (offset === plainTextOffset) delay += token.ms;
    } else {
      offset += token.text.length;
    }
  }
  return delay;
}

function formatRuntimeValue(value: string | number | boolean | null): string {
  if (value === null) return "null";
  return String(value);
}

function resolveRuntimeColor(
  value: string,
  themeColors?: Readonly<Record<string, string | number>>,
): string | null {
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toUpperCase();
  const registered = themeColors?.[value];
  return typeof registered === "string" && /^#[0-9a-fA-F]{6}$/.test(registered)
    ? registered.toUpperCase()
    : null;
}

function sameStyle(token: Extract<RuntimeTextToken, { type: "text" }>, style: TextStyle): boolean {
  return token.bold === style.bold && token.color === style.color && token.ruby === style.ruby;
}
