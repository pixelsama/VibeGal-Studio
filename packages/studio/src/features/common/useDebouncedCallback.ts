/**
 * 防抖回调（自动保存用，Spec 33 §6.1）。
 *
 * 收口仓库里重复的 `useRef<number> + setTimeout + clearTimeout` 模式
 * （此前 AppearanceWorkspace / useScriptGraphState 各写一份）：
 *   - schedule(...args)：窗口内再次调用会重排计时，只保留最后一次参数；
 *   - flush()：立即执行 pending（Cmd+S 立即落盘 / 卸载兜底）；
 *   - cancel()：取消 pending（外部改动到达时，防抖不得覆盖外部写盘）。
 *
 * 卸载时若仍有 pending，自动 flush 最后一次（自动保存语义：改什么就是什么）。
 */
import { useCallback, useEffect, useRef } from "react";

export function useDebouncedCallback<T extends unknown[]>(
  fn: (...args: T) => void,
  delayMs: number,
): {
  schedule: (...args: T) => void;
  cancel: () => void;
  flush: () => void;
} {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timerRef = useRef<number | null>(null);
  const pendingRef = useRef<{ args: T } | null>(null);

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      globalThis.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;
  }, []);

  const flush = useCallback(() => {
    if (timerRef.current !== null) {
      globalThis.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) fnRef.current(...pending.args);
  }, []);

  const schedule = useCallback((...args: T) => {
    pendingRef.current = { args };
    if (timerRef.current !== null) globalThis.clearTimeout(timerRef.current);
    timerRef.current = globalThis.setTimeout(() => {
      timerRef.current = null;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending) fnRef.current(...pending.args);
    }, delayMs);
  }, [delayMs]);

  useEffect(() => () => {
    if (timerRef.current !== null && pendingRef.current) {
      globalThis.clearTimeout(timerRef.current);
      fnRef.current(...pendingRef.current.args);
    }
  }, []);

  return { schedule, cancel, flush };
}
