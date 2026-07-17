import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CommandPalette,
  clampActiveIndex,
  filterCommandItems,
  moveActiveIndex,
  type CommandItem,
} from "./CommandPalette";

const items: CommandItem[] = [
  { id: "ws-render", label: "渲染工作台", keywords: "render", onSelect: () => {} },
  { id: "node-intro", label: "跳转节点：序章", hint: "intro", keywords: "intro 序章", onSelect: () => {} },
  { id: "node-end", label: "跳转节点：结局", hint: "end", keywords: "end 结局", onSelect: () => {} },
];

describe("filterCommandItems", () => {
  it("空 query 返回全量", () => {
    expect(filterCommandItems(items, "")).toHaveLength(3);
    expect(filterCommandItems(items, "  ")).toHaveLength(3);
  });

  it("按 label 与 keywords 大小写不敏感过滤", () => {
    expect(filterCommandItems(items, "RENDER")).toEqual([items[0]]);
    expect(filterCommandItems(items, "序章")).toEqual([items[1]]);
    expect(filterCommandItems(items, "跳转")).toEqual([items[1], items[2]]);
  });

  it("无命中返回空数组", () => {
    expect(filterCommandItems(items, "不存在的东西")).toEqual([]);
  });
});

describe("moveActiveIndex", () => {
  it("上下移动并在两端回绕", () => {
    expect(moveActiveIndex(0, 1, 3)).toBe(1);
    expect(moveActiveIndex(2, 1, 3)).toBe(0);
    expect(moveActiveIndex(0, -1, 3)).toBe(2);
  });

  it("空列表恒为 0", () => {
    expect(moveActiveIndex(5, 1, 0)).toBe(0);
  });
});

describe("clampActiveIndex", () => {
  it("钳制到合法范围", () => {
    expect(clampActiveIndex(9, 3)).toBe(2);
    expect(clampActiveIndex(-1, 3)).toBe(0);
    expect(clampActiveIndex(1, 3)).toBe(1);
  });

  it("空列表为 0", () => {
    expect(clampActiveIndex(2, 0)).toBe(0);
  });
});

describe("CommandPalette", () => {
  it("渲染输入框与全部命令项，首项高亮", () => {
    const html = renderToStaticMarkup(createElement(CommandPalette, { items, onClose: () => {} }));
    expect(html).toContain("搜索节点或工作台");
    expect(html).toContain("渲染工作台");
    expect(html).toContain("跳转节点：序章");
    expect(html).toContain("gs-command-item--active");
  });
});
