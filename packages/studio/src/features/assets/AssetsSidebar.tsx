/**
 * AssetsSidebar —— 资产页左侧分类边栏。
 *
 * 顶部导航已在项目顶部（Render/Script/Assets），资产页内部用左侧边栏
 * 做资产类型切换，避免双层顶部 Tab。
 *
 * Spec 33 E7：分类按媒体类型分组（视觉/音频/其他），组头可折叠（默认展开）；
 * overview 独立成组无组头。「角色」作为真实分类留在视觉组内，不再是模式开关。
 */
import { useState } from "react";
import type { AssetKind } from "../../lib/types";
import { useStudioI18n, type StudioMessageKey, type StudioTranslator } from "../../lib/i18n";

/** 边栏可选的分类项。"overview" = 总览（不过滤），其余对应 AssetKind。 */
export type AssetSection = "overview" | AssetKind;

export interface AssetSectionGroup {
  id: string;
  /** null = 无组头（overview 独立组）。 */
  labelKey: StudioMessageKey | null;
  sections: { id: AssetSection; labelKey: StudioMessageKey }[];
}

export const SECTION_GROUPS: AssetSectionGroup[] = [
  { id: "overview", labelKey: null, sections: [{ id: "overview", labelKey: "assets.section.overview" }] },
  {
    id: "visual",
    labelKey: "assets.group.visual",
    sections: [
      { id: "background", labelKey: "assets.section.background" },
      { id: "character", labelKey: "assets.section.character" },
      { id: "cg", labelKey: "assets.section.cg" },
      { id: "ui", labelKey: "assets.section.ui" },
      { id: "animation", labelKey: "assets.section.animation" },
    ],
  },
  {
    id: "audio",
    labelKey: "assets.group.audio",
    sections: [
      { id: "bgm", labelKey: "assets.section.bgm" },
      { id: "sfx", labelKey: "assets.section.sfx" },
      { id: "voice", labelKey: "assets.section.voice" },
    ],
  },
  {
    id: "other",
    labelKey: "assets.group.other",
    sections: [
      { id: "video", labelKey: "assets.section.video" },
      { id: "font", labelKey: "assets.section.font" },
    ],
  },
];

/** 平铺视图（从分组结构派生），供 assetSectionLabel 与既有调用方保持同一数据源。 */
export const SECTIONS: { id: AssetSection; labelKey: StudioMessageKey }[] =
  SECTION_GROUPS.flatMap((group) => group.sections);

export function assetSectionLabel(section: AssetSection, t: StudioTranslator): string {
  const definition = SECTIONS.find((candidate) => candidate.id === section);
  return definition ? t(definition.labelKey) : t("assets.section.unknown");
}

interface AssetsSidebarProps {
  active: AssetSection;
  onSelect: (section: AssetSection) => void;
}

export function AssetsSidebar({ active, onSelect }: AssetsSidebarProps) {
  const { t } = useStudioI18n();
  // 组折叠状态（默认全部展开）；纯本地展示状态，不持久化。
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  return (
    <nav style={sidebarStyle} aria-label={t("assets.categories")}>
      {SECTION_GROUPS.map((group) => {
        const isCollapsed = collapsed[group.id] ?? false;
        return (
          <div key={group.id}>
            {group.labelKey ? (
              <button
                type="button"
                style={groupHeaderStyle}
                onClick={() => setCollapsed((current) => ({ ...current, [group.id]: !isCollapsed }))}
                aria-expanded={!isCollapsed}
              >
                <span style={arrowStyle}>{isCollapsed ? "▸" : "▾"}</span>
                {t(group.labelKey)}
              </button>
            ) : undefined}
            {!isCollapsed && group.sections.map((section) => {
              const isActive = section.id === active;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => onSelect(section.id)}
                  style={{
                    ...itemStyle,
                    color: isActive ? "var(--text-bright)" : "var(--text-muted)",
                    background: isActive ? "var(--bg-active)" : "transparent",
                  }}
                  aria-current={isActive ? "page" : undefined}
                >
                  {t(section.labelKey)}
                </button>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

const sidebarStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  width: "100%",
  height: "100%",
  boxSizing: "border-box",
  padding: "var(--space-3) var(--space-2)",
  gap: 2,
  overflowY: "auto",
};

const groupHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-1)",
  width: "100%",
  textAlign: "left",
  fontSize: "var(--text-xs)",
  fontWeight: 600,
  letterSpacing: 0.5,
  textTransform: "uppercase",
  color: "var(--text-muted)",
  padding: "var(--space-2) var(--space-3)",
  border: "none",
  background: "transparent",
  cursor: "pointer",
};

const arrowStyle: React.CSSProperties = {
  fontSize: "var(--text-xs)",
  width: 12,
  display: "inline-block",
  color: "var(--text-faint)",
};

const itemStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  fontSize: "var(--text-base)",
  padding: "var(--space-2) var(--space-3)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid transparent",
  background: "transparent",
  color: "var(--text-muted)",
  cursor: "pointer",
};
