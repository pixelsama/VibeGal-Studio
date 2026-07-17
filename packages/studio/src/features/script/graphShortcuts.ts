/**
 * 图视图的撤销/重做快捷键解析。
 *
 * Ctrl/Cmd+Z = 撤销；Ctrl+Shift+Z / Cmd+Shift+Z / Ctrl+Y = 重做。
 * 焦点在输入控件（input/textarea/select/contenteditable）时不拦截，
 * 把按键留给文本编辑自身的撤销栈。
 */

export type UndoRedoAction = "undo" | "redo";

export interface UndoRedoKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  targetIsEditable: boolean;
}

export function resolveUndoRedoShortcut(event: UndoRedoKeyEvent): UndoRedoAction | null {
  if (event.targetIsEditable) return null;
  if (!event.ctrlKey && !event.metaKey) return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y" && !event.metaKey) return "redo";
  return null;
}

/** 判断键盘事件目标是否处于可编辑区域（此时不应拦截 Ctrl+Z/Y）。 */
export function isEditableEventTarget(target: EventTarget | null): boolean {
  if (target == null) return false;
  const el = target as Partial<HTMLElement>;
  if (typeof el.closest === "function" && el.closest("input, textarea, select, [contenteditable]") != null) {
    return true;
  }
  return el.isContentEditable === true;
}
