/**
 * AssetsToolbar —— 资产页工具栏：搜索框 + 导入按钮 + 计数。
 *
 * 导入按钮按当前 section 决定文件类型过滤器。
 * - overview（总览）：显示通用「导入资产」，由扩展名自动分类
 * - character（角色）：隐藏导入（角色是实体，通过角色编辑器加表情）
 * - 其余分类：显示「导入<分类名>」
 */
import type { AssetSection } from "./AssetsSidebar";
import { Button } from "../common/Button";

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
}: AssetsToolbarProps) {
  const importLabel =
    section === "character" || section === "unknown"
      ? null
      : section === "overview"
        ? "导入资产"
        : `导入${sectionLabel(section)}`;

  return (
    <div style={toolbarStyle}>
      <input
        type="text"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="搜索 id 或文件名…"
        aria-label="搜索资产"
        style={searchInputStyle}
      />
      <span style={countStyle}>{count} 项</span>
      <div style={{ flex: 1 }} />
      {importLabel && (
        <Button
          variant="primary"
          style={actionButtonStyle}
          onClick={onImport}
          disabled={disabled}
          title={disabled ? "资源登记表结构异常，修复后才能导入资产" : undefined}
        >
          {importLabel}
        </Button>
      )}
      {orphanCount > 0 && onRegisterOrphans && (
        <Button style={actionButtonStyle} onClick={onRegisterOrphans} disabled={disabled}>
          {`登记 ${orphanCount} 个孤儿`}
        </Button>
      )}
      {danglingCount > 0 && (
        <span style={warningCountStyle}>{`${danglingCount} 个文件缺失登记待清理`}</span>
      )}
      {orphanCount > 0 && onDeleteOrphans && (
        <Button variant="danger" style={actionButtonStyle} onClick={onDeleteOrphans} disabled={disabled}>
          {`删除 ${orphanCount} 个孤儿`}
        </Button>
      )}
    </div>
  );
}

function sectionLabel(section: AssetSection): string {
  switch (section) {
    case "background":
      return "背景";
    case "bgm":
      return "BGM";
    case "sfx":
      return "音效";
    case "voice":
      return "语音";
    case "cg":
      return "CG";
    case "video":
      return "视频";
    case "font":
      return "字体";
    case "ui":
      return "外观资源";
    case "animation":
      return "动画图集";
    default:
      return "资源";
  }
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
