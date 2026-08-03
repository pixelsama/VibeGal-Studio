import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextMenu } from "./ContextMenu";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ContextMenu keyboard nav", () => {
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
