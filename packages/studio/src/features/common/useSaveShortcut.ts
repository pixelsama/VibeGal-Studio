/**
 * Ctrl/Cmd+S 保存快捷键绑定（窗口级）。
 *
 * 节点编辑器、资产草稿条、项目设置三处保存入口原先各自重复一份
 * window keydown 监听，这里收口为统一 hook：
 *   - enabled = false 时不监听（无草稿 / 保存中），按键原样放行；
 *   - 触发时 preventDefault 并调用最新 onSave（ref 保证闭包不过期，
 *     避免回调引用变化导致反复解绑）。
 */
import { useEffect, useRef } from "react";
import { isSaveKeyboardShortcut } from "../script/unsavedChanges";

export function useSaveShortcut(enabled: boolean, onSave: () => void): void {
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  useEffect(() => {
    if (!enabled) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isSaveKeyboardShortcut(event)) return;
      event.preventDefault();
      onSaveRef.current();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled]);
}
