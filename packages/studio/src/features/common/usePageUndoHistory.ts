/**
 * 页面级撤销栈（设置页 / 资产页共用）。
 *
 * 节点编辑器的撤销挂在 textarea 上；设置页/资产页全是表单控件，没有单一
 * 文本焦点，因此用窗口级 keydown + 整页快照恢复（Spec 33 §6.1）：
 *   - record(snapshot) 在应用新值前压旧快照（复用 undoHistory 泛型栈，
 *     自带 600ms 合并：连续击键算一步撤销）；
 *   - cmd+z / cmd+shift+z / ctrl+y 命中时 preventDefault 并整页恢复——
 *     接管 input 的原生撤销，避免出现页面撤销栈不知道的“半撤销”；
 *   - 栈空时也 preventDefault：输入框的原生撤销会让撤销语义分裂。
 *
 * undo/redo 恢复后由调用方的 apply(snapshot) 回填状态并触发自动落盘，
 * 磁盘跟随撤销。
 */
import { useCallback, useEffect, useRef } from "react";
import {
  createUndoHistory,
  recordUndoCheckpoint,
  redoScenarioText,
  undoScenarioText,
  undoShortcutType,
  type UndoHistory,
} from "../script/undoHistory";

interface UsePageUndoHistoryOptions<T> {
  /** 当前快照取值器：undo/redo 时把当前值压入对侧栈。 */
  current: () => T;
  /** 恢复快照：调用方回填状态并触发自动保存。 */
  apply: (snapshot: T) => void;
  /** 是否挂窗口级快捷键监听；false 时只保留栈操作（record/undo/redo/reset）。 */
  enabled?: boolean;
}

export function usePageUndoHistory<T>({ current, apply, enabled = true }: UsePageUndoHistoryOptions<T>) {
  const historyRef = useRef<UndoHistory<T>>(createUndoHistory());
  const currentRef = useRef(current);
  currentRef.current = current;
  const applyRef = useRef(apply);
  applyRef.current = apply;

  const record = useCallback((snapshot: T) => {
    historyRef.current = recordUndoCheckpoint(historyRef.current, snapshot);
  }, []);

  const undo = useCallback((): boolean => {
    const result = undoScenarioText(historyRef.current, currentRef.current());
    if (!result) return false;
    historyRef.current = result.history;
    applyRef.current(result.text);
    return true;
  }, []);

  const redo = useCallback((): boolean => {
    const result = redoScenarioText(historyRef.current, currentRef.current());
    if (!result) return false;
    historyRef.current = result.history;
    applyRef.current(result.text);
    return true;
  }, []);

  const reset = useCallback(() => {
    historyRef.current = createUndoHistory();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const shortcut = undoShortcutType(event);
      if (!shortcut) return;
      event.preventDefault();
      if (shortcut === "undo") undo();
      else redo();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, redo, undo]);

  return { record, undo, redo, reset };
}
