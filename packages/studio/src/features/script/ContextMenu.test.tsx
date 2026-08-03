import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextMenu } from "./ContextMenu";
import { enabledMenuIndices, firstEnabledMenuIndex, moveMenuIndex } from "./contextMenuNavigation";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ContextMenu keyboard nav", () => {
  it("skips disabled items and wraps between enabled items", () => {
    const items = [{}, { disabled: true }, {}, { disabled: true }];
    expect(enabledMenuIndices(items)).toEqual([0, 2]);
    expect(firstEnabledMenuIndex(items)).toBe(0);
    expect(moveMenuIndex(0, -1, items)).toBe(2);
    expect(moveMenuIndex(2, 1, items)).toBe(0);
    expect(firstEnabledMenuIndex([{ disabled: true }])).toBe(-1);
  });

  it("gives the first enabled item roving tabindex 0 and others -1", () => {
    // ContextMenu 在渲染期读取 window 尺寸；node 环境下需 stub。
    vi.stubGlobal("window", {
      innerWidth: 1024,
      innerHeight: 768,
      addEventListener: () => {},
      removeEventListener: () => {},
    });

    const html = renderToStaticMarkup(createElement(ContextMenu, {
      anchor: { x: 100, y: 100 },
      items: [
        { key: "a", label: "进入", onSelect: () => {} },
        { key: "b", label: "重命名", onSelect: () => {}, disabled: true },
        { key: "c", label: "复制", onSelect: () => {} },
      ],
      onClose: () => {},
    }));

    // 首个可用项拿到 tabindex=0（打开即聚焦），其余 -1；禁用项不参与。
    expect(html).toMatch(/<button[^>]*tabindex="0"[^>]*>进入<\/button>/);
    expect(html).toMatch(/<button[^>]*tabindex="-1"[^>]*>复制<\/button>/);
  });
});
