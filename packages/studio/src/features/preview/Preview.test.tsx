import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RendererProps } from "@vibegal/engine";
import type { ProjectData } from "../../lib/types";
import { Preview } from "./Preview";

/**
 * 预览的引擎 player 与渲染层加载都走 Tauri/fs，测试里换成探针：
 * player 喂一句固定台词，渲染层把它读到的 state 文本直接渲染出来。
 */
vi.mock("./useProjectPlayer", () => ({
  useProjectPlayer: () => {
    const state = {
      vars: {},
      background: null,
      backgroundTrans: "fade",
      backgroundMs: 1000,
      sprites: [],
      speaker: null,
      dialogue: { text: "剧情模式台词", typedLen: 6, fullyRevealed: true },
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
    return {
      state,
      error: null,
      rendererProps: {
        state,
        manifest: {},
        contentBase: "/tmp/fixture-project/content",
        stage: { width: 1280, height: 720 },
        controls: {},
        runtime: undefined,
      },
      media: null,
      closeMedia: () => {},
      skipVideo: () => {},
      startDebugSession: () => {},
      setDebugVariable: () => {},
      resetDebugVariables: () => {},
    };
  },
}));

vi.mock("./useRendererComponent", () => ({
  useRendererComponent: () => ({
    renderer: {
      id: "probe",
      name: "Probe",
      contractVersion: 1,
      Component: (props: RendererProps) => (
        <div>{props.state.dialogue?.text ?? props.state.narration?.text ?? "空场景"}</div>
      ),
    },
    loadError: null,
    loadDiagnostics: [],
    trustRequired: false,
    trustRenderer: () => {},
  }),
}));

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
      unlocks: { cg: {}, music: {}, replay: {}, endings: {} },
    },
    meta: {},
    variables: { version: 1, variables: { affection: { type: "number", default: 0, nullable: false, scope: "run" } } },
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
  ],
};

describe("Preview 场景快照", () => {
  beforeEach(() => {
    (globalThis as { window?: unknown }).window = {};
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("剧情播放模式（默认）：player 驱动，只显示调试起点而不显示场景下拉", () => {
    const html = renderToStaticMarkup(<Preview project={project} rendererId="default" />);

    expect(html).toContain("剧情模式台词");
    expect(html).toContain("剧情播放");
    expect(html).toContain("场景快照");
    expect(html).not.toContain("场景刷");
    expect(html).toContain('aria-label="调试起点"');
    expect(html).toContain('aria-label="调试指令"');
    expect(html).toContain("从这里试演");
    expect(html).not.toContain('aria-label="场景"');
    expect(html).not.toContain("海平线上的第一缕光");
  });

  it("舞台默认独占：检查面板与试演假设都按需打开", () => {
    const html = renderToStaticMarkup(<Preview project={project} rendererId="default" />);

    // 两个入口都在工具条上，但内容默认不占地方。
    expect(html).toContain("剧情检查");
    expect(html).toContain("假设前情");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("gs-inspection");
    expect(html).not.toContain('aria-label="试算 affection"');
    // 舞台列不为侧栏预留宽度。
    expect(html).toContain("grid-template-columns:minmax(0, 1fr)");
    // 运行中不再提供直接改值的入口。
    expect(html).not.toContain("重置变量");
  });

  it("场景快照模式：渲染 fixture 场景（内置第一个场景），场景下拉含内置面板与自定义 fixture", () => {
    const html = renderToStaticMarkup(
      <Preview project={project} rendererId="default" initialPreviewMode="fixtures" />,
    );

    // 默认选中第一个内置场景 dialogue；player 的剧情状态不再上屏
    expect(html).toContain("海平线上的第一缕光，比记忆里任何一次都要亮。");
    expect(html).not.toContain("剧情模式台词");
    // 场景下拉：7 个内置面板场景 + 项目自定义 fixture 合并进列表
    expect(html).toContain("<select");
    for (const title of ["存档", "历史", "设置", "CG 画廊", "场景回放", "音乐室", "结局列表", "黎明重逢"]) {
      expect(html).toContain(title);
    }
    // 场景快照的状态检视器同样按需打开，默认不挤压舞台。
    expect(html).not.toContain("sky");
    expect(html).toContain("剧情检查");
  });

  it("场景快照模式默认场景带 story 语义 uiHint（Spec 21：剧情 fixture 不卡标题门）", () => {
    renderToStaticMarkup(
      <Preview project={project} rendererId="default" initialPreviewMode="fixtures" />,
    );
    const target = window as { __VIBEGAL_FIXTURE_UI__?: unknown };
    expect(target.__VIBEGAL_FIXTURE_UI__).toEqual({ screen: "story" });
  });
});
