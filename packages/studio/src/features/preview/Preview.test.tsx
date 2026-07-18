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

describe("Preview 场景刷", () => {
  beforeEach(() => {
    (globalThis as { window?: unknown }).window = {};
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("剧情播放模式（默认）：player 驱动，工具条不含场景下拉，行为与现状一致", () => {
    const html = renderToStaticMarkup(<Preview project={project} rendererId="default" />);

    expect(html).toContain("剧情模式台词");
    expect(html).toContain("剧情播放");
    expect(html).toContain("场景刷");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("海平线上的第一缕光");
  });

  it("场景刷模式：渲染 fixture 场景（内置第一个场景），场景下拉含内置面板与自定义 fixture", () => {
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
    // RuntimeStateInspector 显示 fixture state（第一个背景 id）
    expect(html).toContain("sky");
  });

  it("场景刷模式默认场景无 uiHint：渲染后 uiHint 全局保持 undefined", () => {
    renderToStaticMarkup(
      <Preview project={project} rendererId="default" initialPreviewMode="fixtures" />,
    );
    const target = window as { __VIBEGAL_FIXTURE_UI__?: unknown };
    expect(target.__VIBEGAL_FIXTURE_UI__).toBeUndefined();
  });
});
