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
  cg: { cg_001: { path: "assets/cg/cg_001.png" } },
  videos: { op: { path: "assets/videos/op.mp4" } },
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

  it("renders a remove-only character instruction without materializing missing fields", () => {
    const selection = getScenarioSelection(
      '@instruction {"t":"char","id":"akari","remove":true}',
      0,
    );

    const html = renderToStaticMarkup(createElement(ScenarioInspector, {
      selection,
      manifest,
      diagnostics: [],
      onReplaceInstruction: () => {},
    }));

    expect(selection.instruction).toEqual({ t: "char", id: "akari", remove: true });
    expect(html).toContain("角色");
    expect(html).toContain("default");
    expect(html).toContain("center");
  });

  it("renders resource pickers for bgm, sfx and voice commands", () => {
    const bgm = renderToStaticMarkup(createElement(ScenarioInspector, {
      selection: getScenarioSelection("@bgm daily", 0),
      manifest,
      diagnostics: [],
      onReplaceInstruction: () => {},
    }));
    const sfx = renderToStaticMarkup(createElement(ScenarioInspector, {
      selection: getScenarioSelection("@sfx knock", 0),
      manifest,
      diagnostics: [],
      onReplaceInstruction: () => {},
    }));
    const voice = renderToStaticMarkup(createElement(ScenarioInspector, {
      selection: getScenarioSelection("@voice akari_001", 0),
      manifest,
      diagnostics: [],
      onReplaceInstruction: () => {},
    }));

    expect(bgm).toContain("背景音乐");
    expect(bgm).toContain("daily");
    expect(sfx).toContain("音效");
    expect(voice).toContain("语音");
  });

  it("renders parameter fields for wait, effect, transition, unlock and pause commands", () => {
    const wait = renderToStaticMarkup(createElement(ScenarioInspector, {
      selection: getScenarioSelection("@wait 800", 0),
      manifest,
      diagnostics: [],
      onReplaceInstruction: () => {},
    }));
    const effect = renderToStaticMarkup(createElement(ScenarioInspector, {
      selection: getScenarioSelection("@effect shake", 0),
      manifest,
      diagnostics: [],
      onReplaceInstruction: () => {},
    }));
    const transition = renderToStaticMarkup(createElement(ScenarioInspector, {
      selection: getScenarioSelection("@transition fade_in", 0),
      manifest,
      diagnostics: [],
      onReplaceInstruction: () => {},
    }));
    const unlock = renderToStaticMarkup(createElement(ScenarioInspector, {
      selection: getScenarioSelection("@unlock endings true_end", 0),
      manifest,
      diagnostics: [],
      onReplaceInstruction: () => {},
    }));
    const pause = renderToStaticMarkup(createElement(ScenarioInspector, {
      selection: getScenarioSelection("@pause", 0),
      manifest,
      diagnostics: [],
      onReplaceInstruction: () => {},
    }));

    expect(wait).toContain("等待");
    expect(wait).toContain("毫秒");
    expect(wait).toContain("800");
    expect(effect).toContain("画面效果");
    expect(effect).toContain("shake");
    expect(transition).toContain("转场");
    expect(transition).toContain("fade_in");
    expect(unlock).toContain("解锁");
    expect(unlock).toContain("true_end");
    expect(pause).toContain("停顿");
    expect(pause).not.toContain("该命令可直接在剧本文本中编辑");
  });

  it("renders media pickers for showCg and playVideo commands", () => {
    const showCg = renderToStaticMarkup(createElement(ScenarioInspector, {
      selection: getScenarioSelection("@showCg cg_001", 0),
      manifest,
      diagnostics: [],
      onReplaceInstruction: () => {},
    }));
    const playVideo = renderToStaticMarkup(createElement(ScenarioInspector, {
      selection: getScenarioSelection("@playVideo op true", 0),
      manifest,
      diagnostics: [],
      onReplaceInstruction: () => {},
    }));

    expect(showCg).toContain("CG");
    expect(showCg).toContain("cg_001");
    expect(showCg).not.toContain("该命令可直接在剧本文本中编辑");
    expect(playVideo).toContain("视频");
    expect(playVideo).toContain("op");
    expect(playVideo).toContain("可跳过");
    expect(playVideo).not.toContain("该命令可直接在剧本文本中编辑");
  });

  it("renders node summary when no editable line is selected", () => {
    const html = renderToStaticMarkup(createElement(ScenarioInspector, {
      selection: getScenarioSelection("", 0),
      manifest,
      diagnostics: [{ line: 1, message: "测试诊断" }],
      onReplaceInstruction: () => {},
    }));

    // 空闲态不再重复外层 BottomSheet 栏的"节点摘要"标题
    expect(html).not.toContain("节点摘要");
    expect(html).toContain("测试诊断");
  });
});

describe("ScenarioNodeLayout", () => {
  it("renders editor, preview and inspector regions", () => {
    const html = renderToStaticMarkup(createElement(ScenarioNodeLayout, {
      editor: createElement("div", null, "editor"),
      preview: createElement("div", null, "preview"),
      inspector: createElement("div", null, "inspector"),
      onToggleInspectorPane: () => {},
    }));

    expect(html).toContain("data-region=\"scenario-editor\"");
    expect(html).toContain("data-region=\"node-preview\"");
    expect(html).toContain("data-region=\"scenario-inspector\"");
    // 节点摘要沉底面板默认展开
    expect(html).toContain("data-sheet-state=\"expanded\"");
    expect(html).toContain("节点摘要");
    // 常驻竖轨承载 Inspector 开关，展开态 aria-expanded=true
    expect(html).toContain("aria-label=\"切换 Inspector 面板\"");
    expect(html).toContain("aria-expanded=\"true\"");
    expect(html).toContain("minmax(0, 1fr) minmax(360px, 42%) 30px");
  });

  it("marks the inspector pane collapsed through explicit layout props", () => {
    const html = renderToStaticMarkup(createElement(ScenarioNodeLayout, {
      editor: createElement("div", null, "editor"),
      preview: createElement("div", null, "preview"),
      inspector: createElement("div", null, "inspector"),
      inspectorCollapsed: true,
      inspectorPaneWidth: 420,
      onToggleInspectorPane: () => {},
    }));

    expect(html).toContain("data-node-inspector-state=\"collapsed\"");
    expect(html).toContain("aria-hidden=\"true\"");
    // 收起后面板列宽归零，只留 30px 竖轨
    expect(html).toContain("minmax(0, 1fr) 0px 30px");
    expect(html).toContain("aria-expanded=\"false\"");
  });
});
