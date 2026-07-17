import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseScenarioText } from "@vibegal/engine";
import { SCENARIO_STARTER_TEMPLATES, ScenarioTextEditor } from "./ScenarioTextEditor";

function renderEditor(text: string, overrides: { currentLine?: number; implicitPauseLines?: number[] } = {}) {
  return renderToStaticMarkup(createElement(ScenarioTextEditor, {
    mode: "scenario",
    text,
    textareaRef: { current: null },
    currentLine: overrides.currentLine ?? 1,
    implicitPauseLines: overrides.implicitPauseLines ?? [],
    lineActionTop: 16,
    commandMenuVisible: false,
    visibleCommands: [],
    onToggleLineCommandMenu: () => {},
    onInsertCommand: () => {},
    onInsertTemplate: () => {},
    onScenarioTextChange: () => {},
    onJsonTextChange: () => {},
    onSyncCursor: () => {},
    onKeyDown: () => {},
    onScroll: () => {},
  }));
}

describe("ScenarioTextEditor empty guide", () => {
  it("offers starter templates when the scenario text is empty", () => {
    const html = renderEditor("");

    expect(html).toContain("从模板开始");
    for (const template of SCENARIO_STARTER_TEMPLATES) {
      expect(html).toContain(template.label);
    }
  });

  it("hides the starter templates once the node has content", () => {
    const html = renderEditor("夜深了。");

    expect(html).not.toContain("从模板开始");
  });

  it("keeps every starter template parseable by the scenario DSL", () => {
    for (const template of SCENARIO_STARTER_TEMPLATES) {
      const parsed = parseScenarioText(template.text);
      expect(parsed.ok, `template "${template.label}" should parse`).toBe(true);
    }
  });

  it("renders a line-number gutter with the + button on the current line", () => {
    const html = renderEditor("夜深了。\nakari: 早上好。", { currentLine: 2 });

    expect(html).toContain("data-region=\"scenario-gutter\"");
    expect(html).toContain("aria-label=\"插入当前行命令\"");
    expect(html).toContain(">1</div>");
  });

  it("marks implicit-pause blank lines in the gutter", () => {
    const html = renderEditor("@bg classroom fade\n\nakari: 早上好。", { implicitPauseLines: [2] });

    expect(html).toContain("data-pause-marker=\"2\"");
    expect(html).toContain("空行 = 一次停顿");
  });

  it("renders a syntax highlight layer and disables soft wrap", () => {
    const html = renderEditor("@bg classroom fade");

    expect(html).toContain("data-region=\"scenario-highlight\"");
    expect(html).toContain("@bg");
    expect(html).toContain("wrap=\"off\"");
  });
});
