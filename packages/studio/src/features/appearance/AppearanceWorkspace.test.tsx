import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RendererProps } from "@vibegal/engine";
import { EMPTY_MANIFEST, type ProjectData } from "../../lib/types";
import { AppearanceWorkspace } from "./AppearanceWorkspace";

/**
 * 渲染层加载与 manifest 落盘都走 Tauri/fs，测试里换成探针：
 * - useRendererComponent 返回带 data-ui-part 部件的探针渲染层；
 * - saveManifest 仅作 import 桩（面板交互序列不做 DOM 级测试，保存/冲突路径
 *   由 appearanceTokens.test.ts 的纯函数覆盖）。
 */
const rendererMock = vi.hoisted(() => ({
  trustRequired: false,
  capabilities: ["layout-parts-v1"] as string[] | undefined,
}));

vi.mock("../../lib/tauri", () => ({
  saveManifest: vi.fn(async () => ({ relPath: "content/manifest.json", mtimeMs: 1, size: 1 })),
}));

vi.mock("../preview/useRendererComponent", async () => {
  const React = await import("react");
  return {
    useRendererComponent: () => ({
      renderer: {
        id: "probe",
        name: "Probe",
        contractVersion: 1,
        capabilities: rendererMock.capabilities,
        Component: (props: RendererProps) =>
          React.createElement(
            "div",
            { "data-ui-part": "dialogueBox" },
            props.state.dialogue?.text ?? props.state.narration?.text ?? "空场景",
          ),
      },
      loadError: null,
      loadDiagnostics: [],
      trustRequired: rendererMock.trustRequired,
      trustRenderer: () => {},
    }),
  };
});

function makeProject(uiSkins?: ProjectData["content"]["manifest"]["uiSkins"]): ProjectData {
  return {
    path: "/tmp/fixture-project",
    meta: { name: "Fixture", activeRendererId: "default", createdAt: "0" },
    content: {
      manifest: {
        ...EMPTY_MANIFEST,
        fonts: { serif: { path: "fonts/serif.ttf", family: "Test Serif" } },
        uiSkins: uiSkins ?? {},
      },
      meta: { stage: { width: 1280, height: 720 } },
    },
    rendererIds: ["default"],
  };
}

describe("AppearanceWorkspace", () => {
  beforeEach(() => {
    rendererMock.trustRequired = false;
    rendererMock.capabilities = ["layout-parts-v1"];
  });

  it("空态：项目无 uiSkins 时显示「启用外观编辑」，右侧宫格渲染全场景标题", () => {
    const html = renderToStaticMarkup(
      <AppearanceWorkspace project={makeProject()} rendererId="default" onSaved={() => {}} />,
    );

    expect(html).toContain("启用外观编辑");
    expect(html).toContain("尚未启用外观编辑");
    expect(html).toContain("宫格");
    expect(html).toContain("单场景");
    // 宫格：内置 11 场景同屏（抽查剧情 + 面板两侧）
    for (const title of ["对话", "旁白", "选项", "多立绘", "存档", "CG 画廊", "结局列表"]) {
      expect(html).toContain(title);
    }
    // 探针渲染层确实被挂载（场景台词来自 snapshotScenes 的内置 fixture）
    expect(html).toContain("海平线上的第一缕光");
  });

  it("布局回归：宫格高度链有界，长场景列表可以在列内滚动", () => {
    const html = renderToStaticMarkup(
      <AppearanceWorkspace project={makeProject()} rendererId="default" onSaved={() => {}} />,
    );

    // 根网格行轨道必须封顶在容器高度：隐式 auto 行会被宫格内容撑得比视口高，
    // 再被根 overflow:hidden 裁掉，内部 overflow:auto 永远等不到滚动条。
    expect(html).toContain("grid-template-rows:minmax(0, 1fr)");
    // 预览列是 grid item，默认 min-height:auto 会按内容撑开，必须显式归零，
    // 下方的 flex:1 + min-height:0 + overflow:auto 链才能生效。
    expect(html).toContain("grid-column:1;grid-row:1;min-width:0;min-height:0;height:100%");
  });

  it("分组渲染：有 default skin 时显示七组属性与字体 datalist 候选", () => {
    const project = makeProject({
      default: { name: "默认外观", assets: {}, tokens: { "dialogueBox.x": 120 } },
    });
    const html = renderToStaticMarkup(
      <AppearanceWorkspace project={project} rendererId="default" onSaved={() => {}} />,
    );

    expect(html).toContain("编辑皮肤");
    for (const group of ["对话框", "名字框", "选项区", "选项按钮", "HUD", "菜单窗口", "舞台"]) {
      expect(html).toContain(group);
    }
    // raw token 值进输入框，默认值进 placeholder
    expect(html).toContain('value="120"');
    expect(html).toContain("默认：18"); // dialogueBox.radius
    // 字体候选来自 manifest.fonts
    expect(html).toContain("Test Serif");
  });

  it("无 default skin 时编辑回退到的第一个条目（与渲染器消费规则一致）", () => {
    const project = makeProject({ dark: { assets: {}, tokens: { "hud.visible": 0 } } });
    const html = renderToStaticMarkup(
      <AppearanceWorkspace project={project} rendererId="default" onSaved={() => {}} />,
    );

    expect(html).toContain("dark");
    expect(html).toContain("回退到第一个条目");
  });

  it("单场景视图：渲染层声明 layout-parts-v1 时挂载拖拽 overlay", () => {
    const project = makeProject({ default: { assets: {}, tokens: {} } });
    const html = renderToStaticMarkup(
      <AppearanceWorkspace project={project} rendererId="default" onSaved={() => {}} initialViewMode="single" />,
    );

    expect(html).toContain('aria-label="舞台布局编辑层"');
    expect(html).not.toContain("未声明可拖拽部件");
    expect(html).toContain('data-stage-surface');
    expect(html).toContain('data-ui-part="dialogueBox"');
  });

  it("单场景视图：未声明 capability 时退化为提示态，不挂 overlay", () => {
    rendererMock.capabilities = ["player-ui-v1"];
    const project = makeProject({ default: { assets: {}, tokens: {} } });
    const html = renderToStaticMarkup(
      <AppearanceWorkspace project={project} rendererId="default" onSaved={() => {}} initialViewMode="single" />,
    );

    expect(html).toContain("此渲染层未声明可拖拽部件");
    expect(html).not.toContain('aria-label="舞台布局编辑层"');
  });

  it("单场景视图：无 skin 时不挂 overlay（左侧空态负责引导启用）", () => {
    const html = renderToStaticMarkup(
      <AppearanceWorkspace project={makeProject()} rendererId="default" onSaved={() => {}} initialViewMode="single" />,
    );

    expect(html).toContain("启用外观编辑");
    expect(html).not.toContain('aria-label="舞台布局编辑层"');
    expect(html).not.toContain("未声明可拖拽部件");
  });

  it("渲染层未信任时走信任提示（与 Preview 同一接法）", () => {
    rendererMock.trustRequired = true;
    const html = renderToStaticMarkup(
      <AppearanceWorkspace project={makeProject()} rendererId="default" onSaved={() => {}} />,
    );

    expect(html).toContain("信任并运行项目 renderer");
  });
});
