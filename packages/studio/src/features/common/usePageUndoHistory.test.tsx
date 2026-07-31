import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePageUndoHistory } from "./usePageUndoHistory";

/**
 * hook 测试用 SSR 捕获模式：renderToStaticMarkup 执行组件函数体
 * （useRef/useCallback 单次渲染可用），捕获返回的闭包后直接驱动。
 * 窗口级 keydown 胶水不在此覆盖（undoShortcutType 由 undoHistory.test.ts 覆盖）。
 */
interface HarnessApi {
  record: (snapshot: string) => void;
  undo: () => boolean;
  redo: () => boolean;
  reset: () => void;
}

let api: HarnessApi | null = null;
let applied: string[] = [];
let current = "";

function Harness() {
  api = usePageUndoHistory<string>({
    current: () => current,
    apply: (snapshot) => {
      applied.push(snapshot);
      current = snapshot;
    },
  });
  return null;
}

function mount(): HarnessApi {
  api = null;
  renderToStaticMarkup(<Harness />);
  expect(api).not.toBeNull();
  return api!;
}

beforeEach(() => {
  api = null;
  applied = [];
  current = "A";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("usePageUndoHistory", () => {
  it("record 压当前快照，undo 恢复它并调用 apply", () => {
    const undoApi = mount();
    undoApi.record("A");
    current = "B";
    expect(undoApi.undo()).toBe(true);
    expect(applied).toEqual(["A"]);
    expect(current).toBe("A");
  });

  it("600ms 内的连续 record 合并为一步撤销", () => {
    vi.useFakeTimers();
    const undoApi = mount();
    undoApi.record("A");
    undoApi.record("B"); // <600ms 内：合并，不压新步
    current = "C";
    expect(undoApi.undo()).toBe(true);
    expect(applied).toEqual(["A"]);
    expect(current).toBe("A");
  });

  it("超过 600ms 后 record 生成新的一步", () => {
    vi.useFakeTimers();
    const undoApi = mount();
    undoApi.record("A");
    vi.advanceTimersByTime(600);
    undoApi.record("B");
    current = "C";
    expect(undoApi.undo()).toBe(true);
    expect(applied).toEqual(["B"]);
    expect(current).toBe("B");
    expect(undoApi.undo()).toBe(true);
    expect(applied).toEqual(["B", "A"]);
    expect(current).toBe("A");
  });

  it("undo 后再 redo 恢复撤销前的快照", () => {
    const undoApi = mount();
    undoApi.record("A");
    current = "B";
    undoApi.undo(); // applied: ["A"], current: "A"
    expect(undoApi.redo()).toBe(true);
    expect(applied).toEqual(["A", "B"]);
    expect(current).toBe("B");
  });

  it("栈空时 undo 返回 false 且不调用 apply", () => {
    const undoApi = mount();
    expect(undoApi.undo()).toBe(false);
    expect(applied).toEqual([]);
    expect(current).toBe("A");
  });

  it("reset 清空栈：reset 后不可再 undo", () => {
    const undoApi = mount();
    undoApi.record("A");
    current = "B";
    undoApi.reset();
    expect(undoApi.undo()).toBe(false);
    expect(applied).toEqual([]);
    expect(current).toBe("B");
  });

  it("undo 后立即 record 会清空 future（新分支取代旧分支）", () => {
    const undoApi = mount();
    undoApi.record("A");
    current = "B";
    undoApi.undo(); // current "A"，future 里有 "B"
    undoApi.record("A"); // 新编辑，future 清空
    current = "A2";
    expect(undoApi.redo()).toBe(false);
    expect(undoApi.undo()).toBe(true);
    expect(current).toBe("A");
  });
});
