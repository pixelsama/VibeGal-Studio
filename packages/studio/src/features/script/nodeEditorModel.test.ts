import { describe, expect, it } from "vitest";
import type { FileRevision } from "../../lib/types";
import { isExternalRevisionChange, sameFileRevision } from "./nodeEditorModel";

const base: FileRevision = { relPath: "content/manifest.json", mtimeMs: 1000, size: 42 };

describe("sameFileRevision", () => {
  it("按值比较：不同对象实例但字段一致视为同一 revision", () => {
    expect(sameFileRevision(base, { ...base })).toBe(true);
  });

  it("两侧都有 sha256 时以 sha256 为准", () => {
    const left = { ...base, sha256: "aaa" };
    expect(sameFileRevision(left, { ...base, mtimeMs: 9999, sha256: "aaa" })).toBe(true);
    expect(sameFileRevision(left, { ...base, sha256: "bbb" })).toBe(false);
  });

  it("mtimeMs / size / relPath 任一不同即不同 revision", () => {
    expect(sameFileRevision(base, { ...base, mtimeMs: 2000 })).toBe(false);
    expect(sameFileRevision(base, { ...base, size: 43 })).toBe(false);
    expect(sameFileRevision(base, { ...base, relPath: "content/meta.json" })).toBe(false);
  });

  it("null/undefined 只在两侧都为空时相等", () => {
    expect(sameFileRevision(null, null)).toBe(true);
    expect(sameFileRevision(undefined, undefined)).toBe(true);
    expect(sameFileRevision(null, base)).toBe(false);
    expect(sameFileRevision(base, undefined)).toBe(false);
  });
});

describe("isExternalRevisionChange（Spec 33 §6.1 外部改动检测）", () => {
  it("基准 revision 未知（undefined）时不视为外部改动", () => {
    expect(isExternalRevisionChange(undefined, base)).toBe(false);
    expect(isExternalRevisionChange(undefined, undefined)).toBe(false);
  });

  it("自己保存后的刷新（不同对象实例、同值）不视为外部改动", () => {
    // 回归：FileRevision 是对象，openProject 每次返回新实例；
    // 引用比较会把自己的保存误判为外部改动，清空撤销栈/取消待落盘防抖。
    const savedByUs: FileRevision = { relPath: "content/manifest.json", mtimeMs: 1000, size: 42 };
    const refreshed: FileRevision = { relPath: "content/manifest.json", mtimeMs: 1000, size: 42 };
    expect(savedByUs).not.toBe(refreshed);
    expect(isExternalRevisionChange(savedByUs, refreshed)).toBe(false);
  });

  it("无关文件触发的 watcher 刷新（目标文件未变）不视为外部改动", () => {
    expect(isExternalRevisionChange(base, { ...base })).toBe(false);
  });

  it("外部写盘改变 mtime/size 时视为外部改动", () => {
    expect(isExternalRevisionChange(base, { ...base, mtimeMs: 1001 })).toBe(true);
    expect(isExternalRevisionChange(base, { ...base, size: 100 })).toBe(true);
  });

  it("文件从缺失（null）变为存在视为外部改动", () => {
    expect(isExternalRevisionChange(null, base)).toBe(true);
  });

  it("文件从存在变为缺失（null）视为外部改动", () => {
    expect(isExternalRevisionChange(base, null)).toBe(true);
  });

  it("两侧都为 null（一直缺失）不视为外部改动", () => {
    expect(isExternalRevisionChange(null, null)).toBe(false);
  });
});
