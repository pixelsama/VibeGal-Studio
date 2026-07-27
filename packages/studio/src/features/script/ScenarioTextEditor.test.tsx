import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseScenarioText } from "@vibegal/engine";
import { SCENARIO_STARTER_TEMPLATES, ScenarioTextEditor } from "./ScenarioTextEditor";
import { mapScenarioFrames } from "./scenarioFrames";

function renderEditor(text: string, overrides: { currentLine?: number; implicitPauseLines?: number[] } = {}) {
  const frameMap = mapScenarioFrames(text);
  return renderToStaticMarkup(createElement(ScenarioTextEditor, {
    mode: "scenario",
    text,
    textareaRef: { current: null },
    currentLine: overrides.currentLine ?? 1,
    implicitPauseLines: overrides.implicitPauseLines ?? [],
    instructionIndexByLine: frameMap.instructionIndexByLine,
    instructionCount: frameMap.lineByInstructionIndex.length,
    reorderingEnabled: true,
    lineActionTop: 16,
    commandMenuVisible: false,
    visibleCommands: [],
    parameterMenuVisible: false,
    visibleParameters: [],
    selectedParameterIndex: 0,
    inlineControls: undefined,
    onToggleLineCommandMenu: () => {},
    onInsertCommand: () => {},
    onInsertParameter: () => {},
    onInsertTemplate: () => {},
    onMoveInstruction: () => {},
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
    expect(html).toContain(">1</span>");
  });

  it("marks implicit-pause blank lines in the gutter", () => {
    const html = renderEditor("@bg classroom fade\n\nakari: 早上好。", { implicitPauseLines: [2] });

    expect(html).toContain("data-pause-marker=\"2\"");
    expect(html).toContain("空行 = 一次停顿");
  });

  it("offers drag and keyboard movement only on parsed instruction lines", () => {
    const html = renderEditor("@bg room fade\n@continue\n\nakari: 你好。", { currentLine: 4 });

    expect(html).toContain('aria-label="拖动第 1 条指令"');
    expect(html).toContain('aria-label="拖动第 2 条指令"');
    expect(html).not.toContain('aria-label="拖动第 3 条指令"');
    expect(html).toContain('aria-label="上移当前指令"');
    expect(html).toContain('aria-label="下移当前指令"');
  });

  it("disables movement past the first and last instruction", () => {
    const first = renderEditor("一\n\n二", { currentLine: 1 });
    const last = renderEditor("一\n\n二", { currentLine: 3 });

    expect(first).toMatch(/aria-label="上移当前指令"[^>]*disabled/);
    expect(last).toMatch(/aria-label="下移当前指令"[^>]*disabled/);
  });

  it("hides reordering targets while Scenario text has diagnostics", () => {
    const frameMap = mapScenarioFrames("@bg room\n@unknown x");
    const html = renderToStaticMarkup(createElement(ScenarioTextEditor, {
      mode: "scenario",
      text: "@bg room\n@unknown x",
      textareaRef: { current: null },
      currentLine: 1,
      implicitPauseLines: [],
      instructionIndexByLine: frameMap.instructionIndexByLine,
      instructionCount: 1,
      reorderingEnabled: false,
      lineActionTop: 16,
      commandMenuVisible: false,
      visibleCommands: [],
      parameterMenuVisible: false,
      visibleParameters: [],
      selectedParameterIndex: 0,
      onToggleLineCommandMenu: () => {},
      onInsertCommand: () => {},
      onInsertParameter: () => {},
      onInsertTemplate: () => {},
      onMoveInstruction: () => {},
      onScenarioTextChange: () => {},
      onJsonTextChange: () => {},
      onSyncCursor: () => {},
      onKeyDown: () => {},
      onScroll: () => {},
    }));

    expect(html).not.toContain("拖动第 1 条指令");
    expect(html).not.toContain("上移当前指令");
  });

  it("renders controls beside the active line instead of in the textarea layer", () => {
    const html = renderToStaticMarkup(createElement(ScenarioTextEditor, {
      mode: "scenario",
      text: "@wait 800",
      textareaRef: { current: null },
      currentLine: 1,
      implicitPauseLines: [],
      instructionIndexByLine: [0],
      instructionCount: 1,
      reorderingEnabled: true,
      lineActionTop: 16,
      commandMenuVisible: false,
      visibleCommands: [],
      parameterMenuVisible: false,
      visibleParameters: [],
      selectedParameterIndex: 0,
      inlineControls: createElement("div", { "aria-label": "probe-control" }, "时长"),
      onToggleLineCommandMenu: () => {},
      onInsertCommand: () => {},
      onInsertParameter: () => {},
      onInsertTemplate: () => {},
      onScenarioTextChange: () => {},
      onJsonTextChange: () => {},
      onSyncCursor: () => {},
      onKeyDown: () => {},
      onScroll: () => {},
    }));

    expect(html).toContain('data-region="scenario-inline-controls"');
    expect(html).toContain('aria-label="probe-control"');
  });

  it("renders parameter completion with its active keyboard selection", () => {
    const html = renderToStaticMarkup(createElement(ScenarioTextEditor, {
      mode: "scenario",
      text: "@bg cla",
      textareaRef: { current: null },
      currentLine: 1,
      implicitPauseLines: [],
      instructionIndexByLine: [0],
      instructionCount: 1,
      reorderingEnabled: true,
      lineActionTop: 16,
      commandMenuVisible: false,
      visibleCommands: [],
      parameterMenuVisible: true,
      visibleParameters: [
        { id: "classroom", label: "教室", detail: "classroom" },
        { id: "classroom_evening", label: "黄昏教室", detail: "classroom_evening" },
      ],
      selectedParameterIndex: 1,
      inlineControls: undefined,
      onToggleLineCommandMenu: () => {},
      onInsertCommand: () => {},
      onInsertParameter: () => {},
      onInsertTemplate: () => {},
      onScenarioTextChange: () => {},
      onJsonTextChange: () => {},
      onSyncCursor: () => {},
      onKeyDown: () => {},
      onScroll: () => {},
    }));

    expect(html).toContain('role="listbox"');
    expect(html).toContain('aria-label="剧本参数补全"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("黄昏教室");
    expect(html).toContain("classroom_evening");
  });

  it("renders a syntax highlight layer and disables soft wrap", () => {
    const html = renderEditor("@bg classroom fade");

    expect(html).toContain("data-region=\"scenario-highlight\"");
    expect(html).toContain("@bg");
    expect(html).toContain("wrap=\"off\"");
  });
});
