import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Instruction } from "@vibegal/engine";
import {
  getScenarioSelection,
  replaceScenarioSelectionInstruction,
  ScenarioInspector,
  ScenarioNodeLayout,
} from "./scenarioEditor";
import type { Manifest } from "../../lib/types";

const manifest: Manifest = {
  characters: {
    akari: {
      name: "明里",
      color: "#ffffff",
      sprites: {
        default: "assets/characters/akari/default.png",
        smile: "assets/characters/akari/smile.png",
      },
    },
  },
  backgrounds: {
    classroom: "assets/backgrounds/classroom.png",
  },
  audio: { bgm: { daily: "assets/audio/daily.mp3" }, sfx: {}, voice: {} },
};

describe("scenario editor helpers", () => {
  it("selects a say line and replaces it with normalized scenario text", () => {
    const text = "@bg classroom fade\nakari: 早上好。";
    const selection = getScenarioSelection(text, text.indexOf("akari"));

    expect(selection.kind).toBe("say");
    expect(replaceScenarioSelectionInstruction(
      text,
      selection,
      { t: "say", who: "akari", expr: "default", text: "今天也很安静。" } as Instruction,
    )).toBe("@bg classroom fade\nakari: 今天也很安静。");
  });

  it("marks legacy choice blocks invalid because branches live in node exits", () => {
    const text = `@choice
- 开门 -> open_door
- 装作没听见 -> ignore`;
    const selection = getScenarioSelection(text, text.indexOf("装作"));

    expect(selection.kind).toBe("invalid");
    expect(selection.message).toContain("分支选项已移到流程图出口");
  });
});

describe("ScenarioInspector", () => {
  it("renders controls for selected say, bg, char and set commands", () => {
    const say = renderToStaticMarkup(createElement(ScenarioInspector, {
      selection: getScenarioSelection("akari: 早上好。", 0),
      manifest,
      diagnostics: [],
      onReplaceInstruction: () => {},
    }));
    const bg = renderToStaticMarkup(createElement(ScenarioInspector, {
      selection: getScenarioSelection("@bg classroom fade", 0),
      manifest,
      diagnostics: [],
      onReplaceInstruction: () => {},
    }));
    const char = renderToStaticMarkup(createElement(ScenarioInspector, {
      selection: getScenarioSelection("@char akari smile left", 0),
      manifest,
      diagnostics: [],
      onReplaceInstruction: () => {},
    }));
    const set = renderToStaticMarkup(createElement(ScenarioInspector, {
      selection: getScenarioSelection("@set has_key true", 0),
      manifest,
      diagnostics: [],
      onReplaceInstruction: () => {},
    }));

    expect(say).toContain("台词");
    expect(say).toContain("角色");
    expect(bg).toContain("背景");
    expect(bg).toContain("转场");
    expect(char).toContain("位置槽");
    expect(set).toContain("变量名");
    expect(set).toContain("变量值");
  });

  it("renders compact current-line text fields for prose", () => {
    const say = renderToStaticMarkup(createElement(ScenarioInspector, {
      selection: getScenarioSelection("akari: 早上好。", 0),
      manifest,
      diagnostics: [],
      onReplaceInstruction: () => {},
    }));
    const narrate = renderToStaticMarkup(createElement(ScenarioInspector, {
      selection: getScenarioSelection("新的故事从这里开始。", 0),
      manifest,
      diagnostics: [],
      onReplaceInstruction: () => {},
    }));

    expect(say).toContain("当前行文本");
    expect(say).toContain("早上好。");
    expect(say).not.toContain("textarea");
    expect(narrate).toContain("当前行文本");
    expect(narrate).toContain("新的故事从这里开始。");
    expect(narrate).not.toContain("textarea");
  });

  it("renders node summary when no editable line is selected", () => {
    const html = renderToStaticMarkup(createElement(ScenarioInspector, {
      selection: getScenarioSelection("", 0),
      manifest,
      diagnostics: [{ line: 1, message: "测试诊断" }],
      onReplaceInstruction: () => {},
    }));

    expect(html).toContain("节点摘要");
    expect(html).toContain("测试诊断");
  });
});

describe("ScenarioNodeLayout", () => {
  it("renders editor, preview and inspector regions", () => {
    const html = renderToStaticMarkup(createElement(ScenarioNodeLayout, {
      editor: createElement("div", null, "editor"),
      preview: createElement("div", null, "preview"),
      inspector: createElement("div", null, "inspector"),
    }));

    expect(html).toContain("data-region=\"scenario-editor\"");
    expect(html).toContain("data-region=\"node-preview\"");
    expect(html).toContain("data-region=\"scenario-inspector\"");
  });

  it("marks the inspector pane collapsed through explicit layout props", () => {
    const html = renderToStaticMarkup(createElement(ScenarioNodeLayout, {
      editor: createElement("div", null, "editor"),
      preview: createElement("div", null, "preview"),
      inspector: createElement("div", null, "inspector"),
      inspectorCollapsed: true,
      inspectorPaneWidth: 420,
    }));

    expect(html).toContain("data-node-inspector-state=\"collapsed\"");
    expect(html).toContain("aria-hidden=\"true\"");
    expect(html).toContain("minmax(0, 1fr) 0px");
  });
});
