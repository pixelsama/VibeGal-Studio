import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExternalDiffPanel } from "./ExternalDiffPanel";
import type { DiffRow } from "./externalDiff";
import { StudioI18nProvider } from "../../lib/i18n";

const ROWS: DiffRow[] = [
  { type: "same", text: "夜深了。" },
  { type: "removed", text: "akari: 旧台词" },
  { type: "added", text: "akari: 新台词" },
];

function renderPanel(overrides: Partial<Parameters<typeof ExternalDiffPanel>[0]> = {}) {
  return renderToStaticMarkup(createElement(ExternalDiffPanel, {
    writeConflict: false,
    loading: false,
    rows: ROWS,
    summary: {
      base: "base123",
      local: "3 行草稿",
      external: "disk456",
      externalState: "present",
    },
    saving: false,
    onLoadExternal: () => {},
    onKeepLocal: () => {},
    onCopyConflict: () => {},
    onRetry: () => {},
    ...overrides,
  }));
}

describe("ExternalDiffPanel", () => {
  it("renders diff rows with markers and a summary", () => {
    const html = renderPanel();

    expect(html).toContain('data-region="external-diff-panel"');
    expect(html).toContain("当前草稿");
    expect(html).toContain("外部版本");
    expect(html).toContain("+1 行新增");
    expect(html).toContain("-1 行删除");
    expect(html).toContain('data-diff-type="removed"');
    expect(html).toContain('data-diff-type="added"');
    expect(html).toContain("akari: 旧台词");
    expect(html).toContain("akari: 新台词");
  });

  it("offers explicit safe resolution actions for a plain external update", () => {
    const html = renderPanel();

    expect(html).toContain("载入磁盘版本");
    expect(html).toContain("保留我的修改");
    expect(html).toContain("复制差异后手动处理");
    expect(html).toContain("编辑基线");
    expect(html).toContain("base123");
    expect(html).not.toContain("另存为副本");
  });

  it("labels a deleted disk version and disables loading it", () => {
    const html = renderPanel({
      writeConflict: true,
      summary: {
        base: "base123",
        local: "3 行草稿",
        external: "missing",
        externalState: "deleted",
      },
    });

    expect(html).toContain("已删除");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>载入磁盘版本<\/button>/);
  });

  it("shows related rename paths and watcher burst without claiming a direction", () => {
    const html = renderPanel({
      summary: {
        base: "base123",
        local: "3 行草稿",
        external: "content/nodes/renamed.json",
        externalState: "renamed",
        burstCount: 4,
      },
    });

    expect(html).toContain("已重命名");
    expect(html).toContain("content/nodes/renamed.json");
    expect(html).toContain("合并了 4 个连续事件");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>载入磁盘版本<\/button>/);
  });

  it("shows a fetching placeholder and disables loading while the external version is unavailable", () => {
    const html = renderPanel({ writeConflict: true, loading: true, rows: null });

    expect(html).toContain("正在获取外部版本");
    expect(html).not.toContain('data-diff-type=');
  });

  it("shows an explicit retry instead of an endless loading state after fetch failure", () => {
    const html = renderPanel({
      writeConflict: true,
      loading: false,
      error: "disk unavailable",
      rows: null,
    });

    expect(html).toContain("获取外部版本失败：disk unavailable");
    expect(html).toContain("重试获取");
    expect(html).toContain("复制差异后手动处理");
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>复制差异后手动处理<\/button>/);
    expect(html).not.toContain("正在获取外部版本，稍后这里会显示差异");
  });

  it("renders English conflict chrome while preserving draft text", () => {
    const html = renderToStaticMarkup(createElement(
      StudioI18nProvider,
      { preference: "en" },
      createElement(ExternalDiffPanel, {
        writeConflict: true,
        loading: false,
        rows: ROWS,
        summary: {
          base: "base123",
          local: "3 draft lines",
          external: "disk456",
          externalState: "present",
        },
        saving: false,
        onLoadExternal: () => {},
        onKeepLocal: () => {},
        onCopyConflict: () => {},
        onRetry: () => {},
      }),
    ));

    expect(html).toContain("Save conflict: the file changed externally");
    expect(html).toContain("Load disk version");
    expect(html).toContain("Keep my changes");
    expect(html).toContain("Copy differences for manual resolution");
    expect(html).toContain("akari: 新台词");
    expect(html).not.toContain("保存冲突");
  });
});
