import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ShortcutsHelpDialog,
  isShortcutsHelpToggle,
  shortcutKeysForPlatform,
} from "./ShortcutsHelpDialog";

describe("isShortcutsHelpToggle", () => {
  const base = { key: "?", ctrlKey: false, metaKey: false, altKey: false, targetIsEditable: false };

  it("裸按 ? 触发", () => {
    expect(isShortcutsHelpToggle(base)).toBe(true);
  });

  it("输入控件内不触发", () => {
    expect(isShortcutsHelpToggle({ ...base, targetIsEditable: true })).toBe(false);
  });

  it("带修饰键不触发", () => {
    expect(isShortcutsHelpToggle({ ...base, ctrlKey: true })).toBe(false);
    expect(isShortcutsHelpToggle({ ...base, metaKey: true })).toBe(false);
    expect(isShortcutsHelpToggle({ ...base, altKey: true })).toBe(false);
  });

  it("其他键不触发", () => {
    expect(isShortcutsHelpToggle({ ...base, key: "/" })).toBe(false);
    expect(isShortcutsHelpToggle({ ...base, key: "k" })).toBe(false);
  });
});

describe("shortcutKeysForPlatform", () => {
  it("macOS 上 Ctrl 显示为 ⌘", () => {
    expect(shortcutKeysForPlatform(["Ctrl", "S"], "macos")).toEqual(["⌘", "S"]);
  });

  it("其他平台保持原样", () => {
    expect(shortcutKeysForPlatform(["Ctrl", "S"], "windows")).toEqual(["Ctrl", "S"]);
    expect(shortcutKeysForPlatform(["Ctrl", "S"], "unknown")).toEqual(["Ctrl", "S"]);
  });
});

describe("ShortcutsHelpDialog", () => {
  it("渲染分组与快捷键条目", () => {
    const html = renderToStaticMarkup(createElement(ShortcutsHelpDialog, { onClose: () => {} }));
    expect(html).toContain("键盘快捷键");
    expect(html).toContain("命令面板");
    expect(html).toContain("撤销");
    expect(html).toContain("Ctrl");
    expect(html).toContain("gs-kbd");
  });
});
