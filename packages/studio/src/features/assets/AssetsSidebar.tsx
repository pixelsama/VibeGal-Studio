/**
 * AssetsSidebar —— 资产页左侧分类边栏。
 *
 * 顶部导航已在项目顶部（Render/Script/Assets），资产页内部用左侧边栏
 * 做资产类型切换，避免双层顶部 Tab。
 */
import type { AssetKind } from "../../lib/types";
import { useStudioI18n, type StudioMessageKey, type StudioTranslator } from "../../lib/i18n";

/** 边栏可选的分类项。"overview" = 总览（不过滤），其余对应 AssetKind。 */
export type AssetSection = "overview" | AssetKind;

export const SECTIONS: { id: AssetSection; labelKey: StudioMessageKey }[] = [
  { id: "overview", labelKey: "assets.section.overview" },
  { id: "background", labelKey: "assets.section.background" },
  { id: "character", labelKey: "assets.section.character" },
  { id: "bgm", labelKey: "assets.section.bgm" },
  { id: "sfx", labelKey: "assets.section.sfx" },
  { id: "voice", labelKey: "assets.section.voice" },
  { id: "cg", labelKey: "assets.section.cg" },
  { id: "video", labelKey: "assets.section.video" },
  { id: "font", labelKey: "assets.section.font" },
  { id: "ui", labelKey: "assets.section.ui" },
  { id: "animation", labelKey: "assets.section.animation" },
];

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
  return (
    <nav style={sidebarStyle} aria-label={t("assets.categories")}>
      {SECTIONS.map((section, index) => {
        const isActive = section.id === active;
        const showDivider = index === 1 || index === 3 || index === 6;
        return (
          <div key={section.id}>
            {showDivider && <div style={dividerStyle} />}
            <button
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

const dividerStyle: React.CSSProperties = {
  height: 1,
  margin: "var(--space-1) var(--space-1)",
  background: "var(--border)",
};
