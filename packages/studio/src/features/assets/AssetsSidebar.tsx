/**
 * AssetsSidebar —— 资产页左侧分类边栏。
 *
 * 顶部导航已在项目顶部（Render/Script/Assets），资产页内部用左侧边栏
 * 做资产类型切换，避免双层顶部 Tab。
 */
import type { AssetKind } from "../../lib/types";

/** 边栏可选的分类项。"overview" = 总览（不过滤），其余对应 AssetKind。 */
export type AssetSection = "overview" | AssetKind;

export const SECTIONS: { id: AssetSection; label: string }[] = [
  { id: "overview", label: "总览" },
  { id: "background", label: "背景" },
  { id: "character", label: "角色" },
  { id: "bgm", label: "BGM" },
  { id: "sfx", label: "音效" },
  { id: "voice", label: "语音" },
  { id: "cg", label: "CG" },
  { id: "video", label: "视频" },
  { id: "font", label: "字体" },
  { id: "ui", label: "UI Skin" },
  { id: "animation", label: "动画图集" },
];

interface AssetsSidebarProps {
  active: AssetSection;
  onSelect: (section: AssetSection) => void;
}

export function AssetsSidebar({ active, onSelect }: AssetsSidebarProps) {
  return (
    <nav style={sidebarStyle} aria-label="资产分类">
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
              {section.label}
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
