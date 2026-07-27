import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Instruction } from "@vibegal/engine";
import {
  getScenarioSelection,
  replaceScenarioSelectionInstruction,
  ScenarioInlineControls,
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
  audio: { bgm: { daily: "assets/audio/daily.mp3" }, sfx: {}, voice: { akari_001: "assets/audio/akari_001.ogg" } },
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

describe("ScenarioInlineControls", () => {
  it("renders compact high-frequency controls beside the active line", () => {
    const say = renderToStaticMarkup(createElement(ScenarioInlineControls, {
      instruction: { t: "say", who: "akari", expr: "smile", text: "你好", voice: "akari_001", ms: 900 } as Instruction,
      manifest,
      onChange: () => {},
    }));
    const character = renderToStaticMarkup(createElement(ScenarioInlineControls, {
      instruction: { t: "char", id: "akari", expr: "smile", pos: "left", clear: true } as Instruction,
      manifest,
      onChange: () => {},
    }));
    const state = renderToStaticMarkup(createElement(ScenarioInlineControls, {
      instruction: { t: "set", key: "has_key", value: true } as Instruction,
      manifest,
      variables: { version: 1, variables: { has_key: { type: "boolean", default: false, nullable: false, scope: "run", label: "拿到钥匙" } } },
      onChange: () => {},
    }));

    expect(say).toContain('aria-label="当前行可视化控件"');
    expect(say).toContain("表情");
    expect(say).toContain("本句语音");
    expect(say).toContain("akari_001");
    expect(say).toContain("停顿");
    expect(character).toContain("位置");
    expect(character).toContain("清场");
    expect(character).toContain("退场");
    expect(state).toContain("改变故事状态");
    expect(state).toContain("拿到钥匙");
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
    // set 指令改成作者动作：「把 X 设为 Y」，不再暴露「变量名/变量值/赋值方式」。
    expect(set).toContain("改变故事状态");
    expect(set).toContain('aria-label="要改变的故事状态"');
    expect(set).not.toContain("赋值方式");
  });

  it("renders compact current-line text fields for prose", () => {
    const say = renderToStaticMarkup(createElement(ScenarioInspector, {
      selection: getScenarioSelection("akari(voice=akari_001): 早上好。", 0),
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
    expect(say).toContain("本句语音");
    expect(say).toContain("akari_001");
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
    expect(transition).toContain("淡入");
    expect(transition).toContain('value="fade_in"');
    expect(unlock).toContain("解锁");
    expect(unlock).toContain("true_end");
    expect(pause).toContain("停顿");
    expect(pause).not.toContain("该命令可直接在剧本文本中编辑");
  });

  it("renders the complete common-parameter forms without sending authors to JSON", () => {
    const say = renderToStaticMarkup(createElement(ScenarioInspector, {
      selection: getScenarioSelection("akari(smile, 1200ms): 早上好。", 0),
      manifest,
      diagnostics: [],
      onReplaceInstruction: () => {},
    }));
    const narrate = renderToStaticMarkup(createElement(ScenarioInspector, {
      selection: getScenarioSelection("@narrate 900ms 天亮了。", 0),
      manifest,
      diagnostics: [],
      onReplaceInstruction: () => {},
    }));
    const bg = renderToStaticMarkup(createElement(ScenarioInspector, {
      selection: getScenarioSelection("@bg classroom dissolve 1250ms", 0),
      manifest,
      diagnostics: [],
      onReplaceInstruction: () => {},
    }));
    const bgm = renderToStaticMarkup(createElement(ScenarioInspector, {
      selection: getScenarioSelection("@bgm daily 750ms once", 0),
      manifest,
      diagnostics: [],
      onReplaceInstruction: () => {},
    }));
    const char = renderToStaticMarkup(createElement(ScenarioInspector, {
      selection: getScenarioSelection("@char akari smile left slide 650ms clear out", 0),
      manifest,
      diagnostics: [],
      onReplaceInstruction: () => {},
    }));
    const effect = renderToStaticMarkup(createElement(ScenarioInspector, {
      selection: getScenarioSelection("@effect shake 8.5 450ms", 0),
      manifest,
      diagnostics: [],
      onReplaceInstruction: () => {},
    }));
    const transition = renderToStaticMarkup(createElement(ScenarioInspector, {
      selection: getScenarioSelection("@transition fade_in 1300ms", 0),
      manifest,
      diagnostics: [],
      onReplaceInstruction: () => {},
    }));

    expect(say).toContain("表情");
    expect(say).toContain("自动播放停顿");
    expect(say).toContain('value="1200"');
    expect(narrate).toContain("自动播放停顿");
    expect(narrate).toContain('value="900"');
    expect(bg).toContain("转场时长");
    expect(bg).toContain('value="1250"');
    expect(bgm).toContain("淡入时长");
    expect(bgm).toContain('value="750"');
    expect(bgm).toContain("循环播放");
    expect(bgm).toContain('role="switch"');
    expect(bgm).not.toContain('checked=""');
    expect(char).toContain("登场前清空其他角色");
    expect(char).toContain("让角色退场");
    expect(char.match(/role="switch"/g)).toHaveLength(2);
    expect(char.match(/checked=""/g)).toHaveLength(2);
    expect(effect).toContain("效果强度");
    expect(effect).toContain('max="20"');
    expect(effect).toContain('value="8.5"');
    expect(effect).toContain("持续时长");
    expect(transition).toContain("转场时长");
    expect(transition).toContain('value="1300"');
    expect([say, narrate, bg, bgm, char, effect, transition].join("\n")).not.toContain("切到 JSON");
  });

  it("writes complete form parameters back as readable scenario syntax", () => {
    const saySelection = getScenarioSelection("akari: 早上好。", 0);
    const narrateSelection = getScenarioSelection("天亮了。", 0);
    const bgSelection = getScenarioSelection("@bg classroom", 0);
    const bgmSelection = getScenarioSelection("@bgm daily", 0);
    const charSelection = getScenarioSelection("@char akari", 0);
    const effectSelection = getScenarioSelection("@effect shake", 0);
    const transitionSelection = getScenarioSelection("@transition fade_in", 0);

    expect(replaceScenarioSelectionInstruction(
      "akari: 早上好。",
      saySelection,
      { t: "say", who: "akari", expr: "smile", text: "早上好。", ms: 1200 } as Instruction,
    )).toBe("akari(smile, 1200ms): 早上好。");
    expect(replaceScenarioSelectionInstruction(
      "天亮了。",
      narrateSelection,
      { t: "narrate", text: "天亮了。", ms: 900 } as Instruction,
    )).toBe("@narrate 900ms 天亮了。");
    expect(replaceScenarioSelectionInstruction(
      "@bg classroom",
      bgSelection,
      { t: "bg", id: "classroom", trans: "dissolve", ms: 1250 } as Instruction,
    )).toBe("@bg classroom dissolve 1250ms");
    expect(replaceScenarioSelectionInstruction(
      "@bgm daily",
      bgmSelection,
      { t: "bgm", id: "daily", fade: 750, loop: false } as Instruction,
    )).toBe("@bgm daily 750ms once");
    expect(replaceScenarioSelectionInstruction(
      "@char akari",
      charSelection,
      { t: "char", id: "akari", expr: "smile", pos: "left", trans: "slide", ms: 650, clear: true, remove: true } as Instruction,
    )).toBe("@char akari smile left slide 650ms clear out");
    expect(replaceScenarioSelectionInstruction(
      "@effect shake",
      effectSelection,
      { t: "effect", type: "shake", intensity: 8.5, ms: 450 } as Instruction,
    )).toBe("@effect shake 8.5 450ms");
    expect(replaceScenarioSelectionInstruction(
      "@transition fade_in",
      transitionSelection,
      { t: "transition", type: "fade_in", ms: 1300 } as Instruction,
    )).toBe("@transition fade_in 1300ms");
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
    // 常驻竖轨承载属性面板开关，展开态 aria-expanded=true
    expect(html).toContain("aria-label=\"切换属性面板\"");
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
