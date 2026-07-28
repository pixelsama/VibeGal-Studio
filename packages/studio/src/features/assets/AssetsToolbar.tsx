/**
 * AssetsToolbar —— 资产页工具栏：搜索框 + 导入按钮 + 计数。
 *
 * 导入按钮按当前 section 决定文件类型过滤器。
 * - overview（总览）：显示通用「导入资产」，由扩展名自动分类
 * - character（角色）：隐藏导入（角色是实体，通过角色编辑器加表情）
 * - 其余分类：显示「导入<分类名>」
 */
import type { AssetSection } from "./AssetsSidebar";
import { assetSectionLabel } from "./AssetsSidebar";
import { Button } from "../common/Button";
import { translateZhCN, type StudioTranslator } from "../../lib/i18n";

interface AssetsToolbarProps {
  section: AssetSection;
  search: string;
  onSearch: (value: string) => void;
  onImport: () => void;
  count: number;
  orphanCount?: number;
  danglingCount?: number;
  onRegisterOrphans?: () => void;
  onDeleteOrphans?: () => void;
  disabled?: boolean;
  t?: StudioTranslator;
}

export function AssetsToolbar({
  section,
  search,
  onSearch,
  onImport,
  count,
  orphanCount = 0,
  danglingCount = 0,
  onRegisterOrphans,
  onDeleteOrphans,
  disabled = false,
  t = translateZhCN,
}: AssetsToolbarProps) {
  const importLabel =
    section === "character" || section === "unknown"
      ? null
      : section === "overview"
        ? t("assets.import")
        : t("assets.importSection", { section: assetSectionLabel(section, t) });

  return (
    <div style={toolbarStyle}>
      <input
        type="text"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder={t("assets.searchPlaceholder")}
        aria-label={t("assets.searchLabel")}
        style={searchInputStyle}
      />
      <span style={countStyle}>{t("assets.count", { count })}</span>
      <div style={{ flex: 1 }} />
      {importLabel && (
        <Button
          variant="primary"
          style={actionButtonStyle}
          onClick={onImport}
          disabled={disabled}
          title={disabled ? t("assets.importDisabled") : undefined}
        >
          {importLabel}
        </Button>
      )}
      {orphanCount > 0 && onRegisterOrphans && (
        <Button style={actionButtonStyle} onClick={onRegisterOrphans} disabled={disabled}>
          {t("assets.registerOrphans", { count: orphanCount })}
        </Button>
      )}
      {danglingCount > 0 && (
        <span style={warningCountStyle}>{t("assets.danglingCount", { count: danglingCount })}</span>
      )}
      {orphanCount > 0 && onDeleteOrphans && (
        <Button variant="danger" style={actionButtonStyle} onClick={onDeleteOrphans} disabled={disabled}>
          {t("assets.deleteOrphans", { count: orphanCount })}
        </Button>
      )}
    </div>
  );
}

const toolbarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  padding: "var(--space-2) 14px",
  borderBottom: `1px solid var(--border)`,
};

const searchInputStyle: React.CSSProperties = {
  width: 220,
  fontSize: "var(--text-sm)",
  padding: "5px var(--space-2)",
  borderRadius: "var(--radius-sm)",
  border: `1px solid var(--border-input)`,
  background: "var(--bg-app)",
  color: "var(--text-primary)",
  outline: "none",
};

const countStyle: React.CSSProperties = {
  fontSize: "var(--text-sm)",
  color: "var(--text-muted)",
};

const warningCountStyle: React.CSSProperties = {
  fontSize: "var(--text-xs)",
  color: "var(--status-warn-text)",
};

/* 按钮颜色/悬停/禁用统一走 .gs-btn；这里只覆盖字号。 */
const actionButtonStyle: React.CSSProperties = {
  fontSize: "var(--text-sm)",
};
