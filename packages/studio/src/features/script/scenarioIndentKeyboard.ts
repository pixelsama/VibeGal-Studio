/**
 * Spec 35 Phase 2：缩进树编辑的键盘交互（纯函数，便于测试）。
 *
 * VS Code 式行为（spec §5.1）：
 * - 在 choice / if 块头行末按回车 → 新行缩进 = 块头 + 1（进入子级）。
 * - 在 option 标题行末按回车 → 新行缩进 = option + 1（进入 option body）。
 * - 在 body / then / else 行末按回车 → 新行保持同一缩进。
 * - 在块内空行按退格 → 先缩进 -1；已是最外层时退成普通空行。
 * - Tab / Shift+Tab → 当前行缩进 ±1。
 *
 * 这里只算「应该插入的缩进」，文本 splice 与光标定位由调用方完成。
 */

const INDENT_UNIT = "    ";

function indentWidth(raw: string): number {
  let width = 0;
  for (const ch of raw) {
    if (ch === " ") width += 1;
    else if (ch === "\t") width += 4;
    else break;
  }
  return width;
}

function indentPrefix(width: number): string {
  if (width <= 0) return "";
  return INDENT_UNIT.repeat(Math.ceil(width / 4));
}

function isBlockHeader(text: string): boolean {
  return /^(choice|if|else)(\s|$)/.test(text.trim());
}

export interface LineContext {
  /** 1 起始行号。 */
  line: number;
  raw: string;
  indent: number;
  trimmed: string;
}

/** 把光标 offset 投影到 [行号, 行内列]（均从 0 起始）。 */
function locateCursor(text: string, offset: number): { line: number; column: number } {
  let line = 0;
  let column = 0;
  const clamped = Math.max(0, Math.min(offset, text.length));
  for (let i = 0; i < clamped; i += 1) {
    if (text[i] === "\n") {
      line += 1;
      column = 0;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

/** 找到包含当前行的最近 choice / if 块头的缩进（向上搜索）。 */
function findEnclosingBlockHeaderIndent(lines: string[], lineIndex: number): number | null {
  let currentIndent = indentWidth(lines[lineIndex] ?? "");
  for (let i = lineIndex; i >= 0; i -= 1) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const indent = indentWidth(line);
    if (indent < currentIndent && isBlockHeader(trimmed)) {
      return indent;
    }
    if (indent < currentIndent) currentIndent = indent;
  }
  return null;
}

/**
 * 回车按下时计算新行的缩进前缀。
 * 返回应插入到换行后的缩进字符串（可能为空）。
 */
export function planEnterIndent(text: string, cursorOffset: number): string {
  const { line: lineIndex } = locateCursor(text, cursorOffset);
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const currentRaw = lines[lineIndex] ?? "";
  const currentTrimmed = currentRaw.trim();

  // 空行回车：继承上一非空行的缩进。
  if (currentTrimmed.length === 0) {
    for (let i = lineIndex - 1; i >= 0; i -= 1) {
      const prev = (lines[i] ?? "").trim();
      if (prev.length > 0) return indentPrefix(indentWidth(lines[i] ?? ""));
    }
    return "";
  }

  const currentIndent = indentWidth(currentRaw);

  // choice / if 块头行末回车：进入子级（+1）。
  if (isBlockHeader(currentTrimmed) && currentTrimmed !== "else") {
    return indentPrefix(currentIndent + 4);
  }

  // else 行末回车：保持与 else 同级（else 分支体在新行 +1，但 else 行本身回车应进入 else body）。
  if (currentTrimmed === "else") {
    return indentPrefix(currentIndent + 4);
  }

  // option 标题行（在 choice 块内、缩进 == choice 头 +1、非块头）：回车进入 option body（+1）。
  const headerIndent = findEnclosingBlockHeaderIndent(lines, lineIndex);
  if (headerIndent != null) {
    const headerLine = lines.slice(0, lineIndex + 1).reverse().find((l) => indentWidth(l) === headerIndent && isBlockHeader(l.trim())) ?? "";
    if (isBlockHeader(headerLine.trim()) && headerLine.trim().startsWith("choice")) {
      // 当前行是 choice 头的直接子项（缩进 == headerIndent+1）且不是块头/@to/@effects → option 标题。
      if (currentIndent === headerIndent + 4 && !isBlockHeader(currentTrimmed)
        && !/^@to\s+\S+$/.test(currentTrimmed) && currentTrimmed !== "@effects") {
        return indentPrefix(currentIndent + 4);
      }
    }
  }

  // 默认：保持当前行缩进。
  return indentPrefix(currentIndent);
}

/**
 * 退格在行首（列 0，即光标在缩进起点或行最左）按下时，决定是否减少缩进。
 * 返回 true 表示应拦截原生退格并改为减少缩进。
 */
export function shouldDedentOnBackspace(text: string, cursorOffset: number): boolean {
  const { line: lineIndex, column } = locateCursor(text, cursorOffset);
  if (column !== 0) return false;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const currentRaw = lines[lineIndex] ?? "";
  // 行首退格且当前行有缩进 → 减少缩进（而非合并到上一行）。
  return indentWidth(currentRaw) > 0 && currentRaw.trim().length === 0;
}

/** Tab / Shift+Tab 时计算目标缩进宽度（相对于当前行）。 */
export function planTabIndent(text: string, cursorOffset: number, delta: 1 | -1): { line: number; indent: number } {
  const { line: lineIndex } = locateCursor(text, cursorOffset);
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const currentRaw = lines[lineIndex] ?? "";
  const currentIndent = indentWidth(currentRaw);
  const next = Math.max(0, currentIndent + delta * 4);
  return { line: lineIndex, indent: next };
}

export { indentPrefix as _indentPrefix };

/** 行首 offset（0 起始）映射辅助。 */
function lineStartOffset(text: string, lineIndex: number): number {
  let offset = 0;
  let line = 0;
  while (line < lineIndex && offset < text.length) {
    if (text[offset] === "\n") line += 1;
    offset += 1;
  }
  return Math.min(offset, text.length);
}

export interface IndentEdit {
  text: string;
  cursorOffset: number;
}

/** 回车：在光标处插入换行 + 计算好的缩进。 */
export function applyEnter(text: string, cursorOffset: number): IndentEdit {
  const indent = planEnterIndent(text, cursorOffset);
  const next = `${text.slice(0, cursorOffset)}\n${indent}${text.slice(cursorOffset)}`;
  return { text: next, cursorOffset: cursorOffset + 1 + indent.length };
}

/** 退格：若在缩进空行行首，减少一级缩进；否则返回原文本（交由原生处理）。 */
export function applyBackspace(text: string, cursorOffset: number): IndentEdit | null {
  if (!shouldDedentOnBackspace(text, cursorOffset)) return null;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const { line: lineIndex } = locateCursor(text, cursorOffset);
  const raw = lines[lineIndex] ?? "";
  const width = Math.max(0, indentWidth(raw) - 4);
  lines[lineIndex] = indentPrefix(width);
  const next = lines.join("\n");
  // 光标定位到该行行首。
  const cursor = lineStartOffset(next, lineIndex);
  return { text: next, cursorOffset: cursor };
}

/** Tab / Shift+Tab：调整当前行缩进 ±1 级，光标移到新行首+缩进。 */
export function applyTab(text: string, cursorOffset: number, delta: 1 | -1): IndentEdit {
  const { line: lineIndex, indent } = planTabIndent(text, cursorOffset, delta);
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const raw = lines[lineIndex] ?? "";
  const content = raw.replace(/^[ \t]+/, "");
  lines[lineIndex] = indentPrefix(indent) + content;
  const next = lines.join("\n");
  const cursor = lineStartOffset(next, lineIndex) + indent;
  return { text: next, cursorOffset: cursor };
}
