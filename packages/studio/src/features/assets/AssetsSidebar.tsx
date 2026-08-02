/**
 * AssetsSidebar —— 资产页左侧分类边栏。
 *
 * 顶部导航已在项目顶部（Render/Script/Assets），资产页内部用左侧边栏
 * 做资产类型切换，避免双层顶部 Tab。
 *
 * Spec 33 E7：分类按媒体类型分组（视觉/音频/其他），组头可折叠（默认展开）；
 * overview 独立成组无组头。「角色」作为真实分类留在视觉组内，不再是模式开关。
 *
 * 视觉层级（2026-08）：每个分类行带 lucide 图标，命名分组的子项右缩进，
 * 组头降格为小号弱色 caption（组间留间距）；调用方可通过 counts 传数量徽标
 * （见 countAssetsBySection），缺省的分类不显示徽标。
 */
import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileQuestion,
  Film,
  Image,
  Layers,
  LayoutGrid,
  Mic,
  Music,
  Palette,
  Type,
  User,
  Video,
  Volume2,
  type LucideIcon,
} from "lucide-react";
import type { AssetEntry, AssetKind } from "../../lib/types";
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

/** 每个分类行的 lucide 图标。"unknown" 不在分组里，仅为类型完备兜底。 */
const SECTION_ICONS: Record<AssetSection, LucideIcon> = {
  overview: LayoutGrid,
  background: Image,
  character: User,
  cg: Layers,
  ui: Palette,
  animation: Film,
  bgm: Music,
  sfx: Volume2,
  voice: Mic,
  video: Video,
  font: Type,
  unknown: FileQuestion,
};

export function assetSectionLabel(section: AssetSection, t: StudioTranslator): string {
  const definition = SECTIONS.find((candidate) => candidate.id === section);
  return definition ? t(definition.labelKey) : t("assets.section.unknown");
}

/**
 * 统计磁盘资产在各分类下的数量，供边栏徽标使用。
 * overview = 总数（含无法识别的文件）；kind 为 "unknown" 的条目不落到任何分类。
 */
export function countAssetsBySection(onDisk: AssetEntry[]): Partial<Record<AssetSection, number>> {
  const counts: Partial<Record<AssetSection, number>> = { overview: onDisk.length };
  for (const entry of onDisk) {
    if (entry.kind === "unknown") continue;
    counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
  }
  return counts;
}

interface AssetsSidebarProps {
  active: AssetSection;
  onSelect: (section: AssetSection) => void;
  /**
   * 各分类的数量徽标（通常由 countAssetsBySection 派生）。
   * 整个 prop 缺省 → 不渲染徽标；某分类为 undefined → 该行不显示徽标。
   */
  counts?: Partial<Record<AssetSection, number>>;
}

export function AssetsSidebar({ active, onSelect, counts }: AssetsSidebarProps) {
  const { t } = useStudioI18n();
  // 组折叠状态（默认全部展开）；纯本地展示状态，不持久化。
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  return (
    <nav style={sidebarStyle} aria-label={t("assets.categories")}>
      {SECTION_GROUPS.map((group, groupIndex) => {
        const isCollapsed = collapsed[group.id] ?? false;
        const hasHeader = group.labelKey != null;
        return (
          <div key={group.id} style={groupIndex > 0 ? groupSpacingStyle : undefined}>
            {group.labelKey ? (
              <button
                type="button"
                style={groupHeaderStyle}
                onClick={() => setCollapsed((current) => ({ ...current, [group.id]: !isCollapsed }))}
                aria-expanded={!isCollapsed}
              >
                {isCollapsed
                  ? <ChevronRight size={12} aria-hidden="true" style={chevronStyle} />
                  : <ChevronDown size={12} aria-hidden="true" style={chevronStyle} />}
                {t(group.labelKey)}
              </button>
            ) : undefined}
            {!isCollapsed && group.sections.map((section) => {
              const isActive = section.id === active;
              const Icon = SECTION_ICONS[section.id];
              const count = counts?.[section.id];
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => onSelect(section.id)}
                  style={{
                    ...itemStyle,
                    paddingLeft: hasHeader ? INDENTED_ITEM_PADDING_LEFT : undefined,
                    color: isActive ? "var(--text-bright)" : "var(--text-muted)",
                    background: isActive ? "var(--bg-active)" : "transparent",
                  }}
                  aria-current={isActive ? "page" : undefined}
                >
                  <Icon size={14} aria-hidden="true" style={sectionIconStyle} />
                  <span style={itemLabelStyle}>{t(section.labelKey)}</span>
                  {count !== undefined && (
                    <span
                      data-count-badge
                      style={{ ...countBadgeStyle, color: isActive ? "inherit" : "var(--text-dim)" }}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

/** 命名分组子项的缩进：基础 padding 之外再右移一级，与组头形成层级。 */
const INDENTED_ITEM_PADDING_LEFT = "calc(var(--space-3) + 12px)";

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

const groupSpacingStyle: React.CSSProperties = {
  marginTop: "var(--space-3)",
};

const groupHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-1)",
  width: "100%",
  textAlign: "left",
  fontSize: "var(--text-xs)",
  fontWeight: 500,
  letterSpacing: 0.5,
  textTransform: "uppercase",
  color: "var(--text-muted)",
  padding: "var(--space-1) var(--space-3)",
  border: "none",
  background: "transparent",
  cursor: "pointer",
};

const chevronStyle: React.CSSProperties = {
  flexShrink: 0,
  color: "var(--text-dim)",
};

const itemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
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

const sectionIconStyle: React.CSSProperties = {
  flexShrink: 0,
};

const itemLabelStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const countBadgeStyle: React.CSSProperties = {
  flexShrink: 0,
  fontSize: "var(--text-xs)",
  fontVariantNumeric: "tabular-nums",
};
