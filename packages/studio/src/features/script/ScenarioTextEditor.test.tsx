import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseScenarioText } from "@vibegal/engine";
import { SCENARIO_STARTER_TEMPLATES, ScenarioTextEditor } from "./ScenarioTextEditor";

function renderEditor(text: string) {
  return renderToStaticMarkup(createElement(ScenarioTextEditor, {
    mode: "scenario",
    text,
    textareaRef: { current: null },
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
});
