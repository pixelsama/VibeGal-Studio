import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SECTION_GROUPS, SECTIONS, assetSectionLabel, AssetsSidebar, countAssetsBySection, type AssetSection } from "./AssetsSidebar";
import { StudioI18nProvider } from "../../lib/i18n";
import type { AssetEntry } from "../../lib/types";

function renderSidebar(props: { counts?: Partial<Record<AssetSection, number>> } = {}) {
  return renderToStaticMarkup(createElement(
    StudioI18nProvider,
    { preference: "zh-CN" },
    createElement(AssetsSidebar, { active: "overview", onSelect: () => {}, counts: props.counts }),
  ));
}

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

describe("AssetsSidebar visual hierarchy (icons + count badges)", () => {
  it("renders an icon for every section row and chevrons on expanded group headers", () => {
    const html = renderSidebar();
    const expectedIcons = [
      "lucide-layout-grid", // overview
      "lucide-image", // background
      "lucide-user", // character
      "lucide-layers", // cg
      "lucide-palette", // ui
      "lucide-film", // animation
      "lucide-music", // bgm
      "lucide-volume-2", // sfx
      "lucide-mic", // voice
      "lucide-video", // video
      "lucide-type", // font
    ];
    for (const iconClass of expectedIcons) {
      expect(html).toContain(iconClass);
    }
    // 三个命名分组默认展开 → 三个向下箭头（overview 独立组无组头）
    expect(html.match(/lucide-chevron-down/g)?.length).toBe(3);
  });

  it("shows count badges only for sections present in counts", () => {
    const html = renderSidebar({ counts: { overview: 3, background: 2, bgm: 1 } });
    expect(html.match(/data-count-badge/g)?.length).toBe(3);
    expect(html).toContain(">3</span>");
    expect(html).toContain(">2</span>");
    expect(html).toContain(">1</span>");
  });

  it("renders no count badges when counts are omitted", () => {
    expect(renderSidebar()).not.toContain("data-count-badge");
  });

  it("counts on-disk assets per section with overview as the total", () => {
    const onDisk: AssetEntry[] = [
      { relPath: "assets/backgrounds/a.png", size: 1, kind: "background" },
      { relPath: "assets/backgrounds/b.png", size: 2, kind: "background" },
      { relPath: "assets/audio/bgm/theme.mp3", size: 3, kind: "bgm" },
      { relPath: "assets/misc/readme.txt", size: 4, kind: "unknown" },
    ];
    // unknown 计入 overview 总数，但不落到任何分类徽标。
    expect(countAssetsBySection(onDisk)).toEqual({ overview: 4, background: 2, bgm: 1 });
    expect(countAssetsBySection([])).toEqual({ overview: 0 });
  });
});
