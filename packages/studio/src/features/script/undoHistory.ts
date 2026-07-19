/**
 * 剧本编辑器的自定义撤销栈（纯函数）。
 *
 * textarea 原生 undo 追踪不到程序化改文本（Inspector 表单、命令/模板插入），
 * 因此在应用新文本之前把旧文本压栈。打字在 TYPING_COALESCE_MS 窗口内合并为一步，
 * 程序化修改（programmatic: true）始终独立成一步。
 * 仅用于剧本模式；JSON 模式保留 textarea 原生撤销。
 */
export interface UndoHistory<T = string> {
  past: T[];
  future: T[];
  /** 最近一次记录检查点的时间戳；undo/redo 后归零，确保下一次输入生成新检查点。 */
  lastRecordedAt: number;
}

export const UNDO_HISTORY_LIMIT = 100;
export const TYPING_COALESCE_MS = 600;

export function createUndoHistory<T = string>(): UndoHistory<T> {
  return { past: [], future: [], lastRecordedAt: 0 };
}

/** 在应用新文本之前基于 currentText 记录检查点，返回新栈。 */
export function recordUndoCheckpoint<T>(
  history: UndoHistory<T>,
  currentText: T,
  options: { programmatic?: boolean; now?: number } = {},
): UndoHistory<T> {
  const now = options.now ?? Date.now();
  const coalesce = !options.programmatic && now - history.lastRecordedAt < TYPING_COALESCE_MS;
  if (coalesce) return { ...history, lastRecordedAt: now };
  return {
    past: [...history.past, currentText].slice(-UNDO_HISTORY_LIMIT),
    future: [],
    lastRecordedAt: now,
  };
}

export function undoScenarioText<T>(
  history: UndoHistory<T>,
  currentText: T,
): { history: UndoHistory<T>; text: T } | null {
  const text = history.past[history.past.length - 1];
  if (text == null) return null;
  return {
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, currentText],
      lastRecordedAt: 0,
    },
    text,
  };
}

export function redoScenarioText<T>(
  history: UndoHistory<T>,
  currentText: T,
): { history: UndoHistory<T>; text: T } | null {
  const text = history.future[history.future.length - 1];
  if (text == null) return null;
  return {
    history: {
      past: [...history.past, currentText],
      future: history.future.slice(0, -1),
      lastRecordedAt: 0,
    },
    text,
  };
}

export type UndoShortcut = "undo" | "redo";

/** 识别 Ctrl/Cmd+Z（undo）、Ctrl/Cmd+Shift+Z 与 Ctrl+Y（redo）。 */
export function undoShortcutType(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): UndoShortcut | null {
  if (!event.ctrlKey && !event.metaKey) return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y" && event.ctrlKey) return "redo";
  return null;
}
