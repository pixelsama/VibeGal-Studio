import { formatScenarioText } from "@vibegal/engine";
import { parseJsonInstructionText, type NodeEditorMode } from "./nodeEditorModel";

export interface DiffRow {
  type: "same" | "added" | "removed";
  text: string;
}

/** LCS 动态规划的单元格上限；超过就退化为"整块替换"，避免巨型 JSON 卡死 UI。 */
const MAX_LCS_CELLS = 1_000_000;

export function diffLines(beforeText: string, afterText: string): DiffRow[] {
  const before = splitLines(beforeText);
  const after = splitLines(afterText);

  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1] === after[afterEnd - 1]) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  const rows: DiffRow[] = [];
  for (let i = 0; i < start; i += 1) rows.push({ type: "same", text: before[i] });
  const middleBefore = before.slice(start, beforeEnd);
  const middleAfter = after.slice(start, afterEnd);
  rows.push(...diffMiddle(middleBefore, middleAfter));
  for (let i = beforeEnd; i < before.length; i += 1) rows.push({ type: "same", text: before[i] });
  return rows;
}

export function summarizeDiff(rows: DiffRow[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const row of rows) {
    if (row.type === "added") added += 1;
    else if (row.type === "removed") removed += 1;
  }
  return { added, removed };
}

/**
 * 决定"当前草稿 vs 外部版本"在 diff 面板里各自的文本形态：
 * JSON 模式直接对比原始文本；剧本模式把外部 JSON 格式化成剧本文本再对比，
 * 外部内容不可解析时退回原始文本（用户需要看到真实落盘内容）。
 */
export function externalDiffTexts(options: {
  mode: NodeEditorMode;
  draftText: string;
  externalJsonText: string;
}): { beforeText: string; afterText: string } {
  if (options.mode === "json") {
    return { beforeText: options.draftText, afterText: options.externalJsonText };
  }
  const parsed = parseJsonInstructionText(options.externalJsonText);
  return {
    beforeText: options.draftText,
    afterText: parsed.ok ? formatScenarioText(parsed.instructions) : options.externalJsonText,
  };
}

function splitLines(text: string): string[] {
  return text === "" ? [] : text.split("\n");
}

function diffMiddle(before: string[], after: string[]): DiffRow[] {
  if ((before.length + 1) * (after.length + 1) > MAX_LCS_CELLS) {
    return [
      ...before.map((text): DiffRow => ({ type: "removed", text })),
      ...after.map((text): DiffRow => ({ type: "added", text })),
    ];
  }
  return lcsRows(before, after);
}

function lcsRows(before: string[], after: string[]): DiffRow[] {
  const m = before.length;
  const n = after.length;
  const width = n + 1;
  const dp = new Uint32Array((m + 1) * width);
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      dp[i * width + j] = before[i] === after[j]
        ? dp[(i + 1) * width + j + 1] + 1
        : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (before[i] === after[j]) {
      rows.push({ type: "same", text: before[i] });
      i += 1;
      j += 1;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
      rows.push({ type: "removed", text: before[i] });
      i += 1;
    } else {
      rows.push({ type: "added", text: after[j] });
      j += 1;
    }
  }
  while (i < m) {
    rows.push({ type: "removed", text: before[i] });
    i += 1;
  }
  while (j < n) {
    rows.push({ type: "added", text: after[j] });
    j += 1;
  }
  return rows;
}
