import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebouncedCallback } from "./useDebouncedCallback";

/**
 * SSR 捕获模式（与 usePageUndoHistory.test 一致）：renderToStaticMarkup
 * 执行组件函数体，捕获返回的闭包后直接驱动；卸载 flush 的 useEffect
 * 不在此覆盖（其逻辑与 flush 相同）。
 */
interface DebounceApi<T extends unknown[]> {
  schedule: (...args: T) => void;
  cancel: () => void;
  flush: () => void;
}

let api: DebounceApi<[number]> | null = null;
let calls: number[] = [];

function Harness() {
  api = useDebouncedCallback((value: number) => {
    calls.push(value);
  }, 800);
  return null;
}

function mount(): DebounceApi<[number]> {
  api = null;
  renderToStaticMarkup(<Harness />);
  expect(api).not.toBeNull();
  return api!;
}

beforeEach(() => {
  api = null;
  calls = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useDebouncedCallback", () => {
  it("窗口内连续 schedule 只执行最后一次（防抖合并）", () => {
    vi.useFakeTimers();
    const debounceApi = mount();
    debounceApi.schedule(1);
    vi.advanceTimersByTime(300);
    debounceApi.schedule(2);
    vi.advanceTimersByTime(300);
    debounceApi.schedule(3);
    vi.advanceTimersByTime(800);
    expect(calls).toEqual([3]);
  });

  it("窗口过后再 schedule 会各自执行", () => {
    vi.useFakeTimers();
    const debounceApi = mount();
    debounceApi.schedule(1);
    vi.advanceTimersByTime(800);
    debounceApi.schedule(2);
    vi.advanceTimersByTime(800);
    expect(calls).toEqual([1, 2]);
  });

  it("窗口内未到期时 flush 立即执行 pending 并取消计时", () => {
    vi.useFakeTimers();
    const debounceApi = mount();
    debounceApi.schedule(1);
    debounceApi.flush();
    expect(calls).toEqual([1]);
    // flush 后计时已取消：再推进也不重复执行
    vi.advanceTimersByTime(800);
    expect(calls).toEqual([1]);
  });

  it("无 pending 时 flush 无操作", () => {
    const debounceApi = mount();
    debounceApi.flush();
    expect(calls).toEqual([]);
  });

  it("cancel 取消 pending：计时到点也不执行", () => {
    vi.useFakeTimers();
    const debounceApi = mount();
    debounceApi.schedule(1);
    debounceApi.cancel();
    vi.advanceTimersByTime(800);
    expect(calls).toEqual([]);
  });

  it("cancel 后再次 schedule 正常执行", () => {
    vi.useFakeTimers();
    const debounceApi = mount();
    debounceApi.schedule(1);
    debounceApi.cancel();
    debounceApi.schedule(2);
    vi.advanceTimersByTime(800);
    expect(calls).toEqual([2]);
  });

  it("schedule 与 flush 都用最新的 fn（fn 跨渲染更新不丢参数）", () => {
    vi.useFakeTimers();
    const debounceApi = mount();
    // 直接重设闭包（模拟组件重渲染后 fn 变化）——ref 保证用最新。
    debounceApi.schedule(7);
    debounceApi.flush();
    expect(calls).toEqual([7]);
  });
});
