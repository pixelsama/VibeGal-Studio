import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NovelState, RendererProps, RendererManifest } from "@vibegal/engine";
import type { ProjectData } from "../../lib/types";
import type { FixtureScene } from "../../export/snapshotScenes";
import {
  SceneFixtureView,
  fixtureSceneIdFromPath,
  fixtureScenesForPreview,
  setFixtureUiHintGlobal,
} from "./SceneFixtureView";

/** 与引擎 createInitialState 同形的最小合法快照。 */
function minimalState(): NovelState {
  return {
    vars: {},
    background: null,
    backgroundTrans: "fade",
    backgroundMs: 1000,
    sprites: [],
    speaker: null,
    dialogue: null,
    narration: null,
    choice: null,
    effects: [],
    transitions: [],
    audio: { bgm: null, sfx: [], voice: null },
    flags: {
      isWaiting: false,
      isAutoPlay: false,
      skipMode: "off",
      isRecording: false,
      chapterIndex: 0,
      progress: { current: 0, total: 0 },
    },
    currentCueMs: null,
  };
}

const project: ProjectData = {
  path: "/tmp/fixture-project",
  meta: { name: "Fixture", activeRendererId: "default", createdAt: "0" },
  content: {
    manifest: {
      characters: {
        heroine: { name: "测试角色", color: "#ffcc00", sprites: { default: "c.png" } },
      },
      backgrounds: { sky: "bg.png" },
      audio: { bgm: {}, sfx: {}, voice: {} },
      cg: {},
      videos: {},
      fonts: {},
      uiSkins: {},
      animationAtlases: {},
      unlocks: {
        cg: { cg_rooftop: { assetId: "cg_001", title: "Rooftop" } },
        music: {},
        replay: {},
        endings: {},
      },
    },
    meta: {},
  },
  rendererIds: ["default"],
  fixtures: [
    {
      path: "content/fixtures/dawn-reunion.json",
      value: {
        title: "黎明重逢",
        state: { dialogue: { text: "自定义场景台词", typedLen: 7, fullyRevealed: true } },
      },
    },
    // 坏 fixture（缺 state）：跳过，不进场景列表
    { path: "content/fixtures/broken.json", value: { title: "无状态" } },
  ],
};

/** 记录 props 的探针渲染层：把收到的 props 存下来供断言。 */
function probeRenderer(captured: RendererProps[]): RendererManifest {
  return {
    id: "probe",
    name: "Probe",
    contractVersion: 1,
    Component: (props: RendererProps) => {
      captured.push(props);
      return <div>{props.state.dialogue?.text ?? props.state.narration?.text ?? "空场景"}</div>;
    },
  };
}

describe("fixtureSceneIdFromPath", () => {
  it("取文件名去掉 .json（POSIX 与 Windows 路径分隔符都支持）", () => {
    expect(fixtureSceneIdFromPath("content/fixtures/dawn-reunion.json")).toBe("dawn-reunion");
    expect(fixtureSceneIdFromPath("content\\fixtures\\win.json")).toBe("win");
    expect(fixtureSceneIdFromPath("solo.json")).toBe("solo");
  });
});

describe("fixtureScenesForPreview", () => {
  it("内置场景（4 剧情 + 7 面板）在前，项目自定义 fixtures 归一化后接在后面", () => {
    const scenes = fixtureScenesForPreview(project);
    expect(scenes).toHaveLength(12);
    expect(scenes.map((scene) => scene.id)).toEqual([
      "dialogue", "narration", "choice", "sprites",
      "save", "history", "settings",
      "gallery-cg", "gallery-replay", "gallery-music", "gallery-endings",
      "dawn-reunion",
    ]);
    const custom = scenes.at(-1)!;
    expect(custom.title).toBe("黎明重逢");
    expect(custom.state).toEqual({
      dialogue: { text: "自定义场景台词", typedLen: 7, fullyRevealed: true },
    });
  });

  it("项目无 fixtures 时只有内置场景", () => {
    const { fixtures: _fixtures, ...withoutFixtures } = project;
    expect(fixtureScenesForPreview(withoutFixtures)).toHaveLength(11);
  });
});

describe("setFixtureUiHintGlobal", () => {
  beforeEach(() => {
    (globalThis as { window?: unknown }).window = {};
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("有 uiHint 时写入 window.__VIBEGAL_FIXTURE_UI__，无 uiHint 时删除该全局", () => {
    const target = window as { __VIBEGAL_FIXTURE_UI__?: unknown };

    setFixtureUiHintGlobal({ panel: "gallery-cg" });
    expect(target.__VIBEGAL_FIXTURE_UI__).toEqual({ panel: "gallery-cg" });

    setFixtureUiHintGlobal({ panel: "save" });
    expect(target.__VIBEGAL_FIXTURE_UI__).toEqual({ panel: "save" });

    setFixtureUiHintGlobal(undefined);
    expect(target.__VIBEGAL_FIXTURE_UI__).toBeUndefined();
    expect("__VIBEGAL_FIXTURE_UI__" in target).toBe(false);
  });
});

describe("SceneFixtureView", () => {
  beforeEach(() => {
    (globalThis as { window?: unknown }).window = {};
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("把渲染层挂载到 fixture state，并注入 persistent/backlog 映射出的内存 runtime", () => {
    const scene: FixtureScene = {
      id: "gallery-cg",
      title: "CG 画廊",
      state: { ...minimalState(), dialogue: { text: "面板底景台词", typedLen: 6, fullyRevealed: true } },
      persistent: { unlock: { cg: ["cg_rooftop"], music: [], replay: [], endings: [] } },
      uiHint: { panel: "gallery-cg" },
      backlog: [
        { id: "b1", storyPoint: { nodeId: "n1", instructionId: "l1" }, speakerName: "测试角色", text: "历史台词" },
      ],
    };
    const captured: RendererProps[] = [];

    const html = renderToStaticMarkup(
      <SceneFixtureView project={project} renderer={probeRenderer(captured)} scene={scene} />,
    );

    expect(html).toContain("面板底景台词");
    expect(captured).toHaveLength(1);
    const props = captured[0];
    expect(props.state).toBe(scene.state);
    expect(props.contentBase).toBe("/tmp/fixture-project/content");
    // 静态场景的 controls 全部 no-op
    expect(() => props.controls.advance()).not.toThrow();
    // persistent 瘦身快照 → runtime unlock；backlog → history 服务
    expect(props.runtime?.persistent.getUnlocks()).toEqual({
      cg: ["cg_rooftop"],
      music: [],
      replay: [],
      endings: [],
    });
    expect(props.runtime?.history.getBacklog().map((entry) => entry.text)).toEqual(["历史台词"]);
    // gallery 服务经 manifest 注册表 + unlock 集合工作
    expect(props.runtime?.gallery.listCg().map((entry) => entry.id)).toEqual(["cg_rooftop"]);
  });

  it("无 uiHint 的场景：渲染期间不触碰 uiHint 全局（注入是父组件事件处理器的职责）", () => {
    const scene: FixtureScene = { id: "dialogue", title: "对话", state: minimalState() };
    renderToStaticMarkup(
      <SceneFixtureView project={project} renderer={probeRenderer([])} scene={scene} />,
    );
    const target = window as { __VIBEGAL_FIXTURE_UI__?: unknown };
    expect(target.__VIBEGAL_FIXTURE_UI__).toBeUndefined();
  });
});
