import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SECTION_GROUPS, SECTIONS, assetSectionLabel, AssetsSidebar } from "./AssetsSidebar";
import { StudioI18nProvider } from "../../lib/i18n";

describe("AssetsSidebar groups (spec 33 E7)", () => {
  it("renders group headers with every category visible by default", () => {
    const html = renderToStaticMarkup(createElement(
      StudioI18nProvider,
      { preference: "zh-CN" },
      createElement(AssetsSidebar, { active: "overview", onSelect: () => {} }),
    ));

    // 组头
    expect(html).toContain("总览");
    expect(html).toContain("视觉");
    expect(html).toContain("音频");
    expect(html).toContain("其他");
    // 初始全部展开：所有分类可见
    for (const section of SECTIONS) {
      expect(html).toContain(section.labelKey === "assets.section.character" ? "角色" : "");
    }
    expect(html).toContain("背景");
    expect(html).toContain("角色");
    expect(html).toContain("BGM");
    expect(html).toContain("音效");
    expect(html).toContain("语音");
    expect(html).toContain("CG");
    expect(html).toContain("视频");
    expect(html).toContain("字体");
    expect(html).toContain("外观资源");
    expect(html).toContain("动画图集");
  });

  it("declares every section exactly once across the groups", () => {
    const flat = SECTION_GROUPS.flatMap((group) => group.sections.map((section) => section.id));
    expect(new Set(flat).size).toBe(flat.length);
    expect(flat.sort()).toEqual(SECTIONS.map((section) => section.id).sort());
  });

  it("keeps character inside the visual group", () => {
    const visual = SECTION_GROUPS.find((group) => group.id === "visual");
    expect(visual?.sections.map((section) => section.id)).toContain("character");
  });

  it("resolves section labels through the grouped structure", () => {
    // 恒等翻译函数：断言 assetSectionLabel 返回正确的 labelKey（解析路径正确）。
    const identity = (key: string) => key;
    expect(assetSectionLabel("background", identity as never)).toBe("assets.section.background");
    expect(assetSectionLabel("video", identity as never)).toBe("assets.section.video");
    expect(assetSectionLabel("character", identity as never)).toBe("assets.section.character");
  });
});
