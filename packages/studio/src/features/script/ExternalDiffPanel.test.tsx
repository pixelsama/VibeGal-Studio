import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExternalDiffPanel } from "./ExternalDiffPanel";
import type { DiffRow } from "./externalDiff";

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
    saving: false,
    onLoadExternal: () => {},
    onSaveDraftCopy: () => {},
    onDismiss: () => {},
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

  it("offers load and dismiss actions for a plain external update", () => {
    const html = renderPanel();

    expect(html).toContain("载入外部版本");
    expect(html).toContain("继续编辑");
    expect(html).not.toContain("另存为副本");
  });

  it("adds the draft-copy action in a write conflict", () => {
    const html = renderPanel({ writeConflict: true });

    expect(html).toContain("保存冲突");
    expect(html).toContain("另存为副本");
  });

  it("shows a fetching placeholder and disables loading while the external version is unavailable", () => {
    const html = renderPanel({ writeConflict: true, loading: true, rows: null });

    expect(html).toContain("正在获取外部版本");
    expect(html).not.toContain('data-diff-type=');
  });
});
