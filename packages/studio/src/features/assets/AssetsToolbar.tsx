/**
 * AssetsToolbar —— 资产页工具栏：搜索框 + 导入按钮 + 计数。
 *
 * 导入按钮按当前 section 决定文件类型过滤器。
 * - overview（总览）：纯浏览视图，隐藏导入（从具体分类进入才能确定导入类型）
 * - character（角色）：隐藏导入（角色是实体，通过角色编辑器加表情）
 * - 其余分类：显示「导入<分类名>」
 */
import type { AssetSection } from "./AssetsSidebar";

interface AssetsToolbarProps {
  section: AssetSection;
  search: string;
  onSearch: (value: string) => void;
  onImport: () => void;
  count: number;
  orphanCount?: number;
  danglingCount?: number;
  onRegisterOrphans?: () => void;
  onRemoveDanglingRefs?: () => void;
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
  onRemoveDanglingRefs,
  onDeleteOrphans,
  disabled = false,
}: AssetsToolbarProps) {
  const importLabel =
    section === "overview" || section === "character"
      ? null
      : `导入${sectionLabel(section)}`;

  return (
    <div style={toolbarStyle}>
      <input
        type="text"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="搜索 id 或文件名…"
        style={searchInputStyle}
      />
      <span style={countStyle}>{count} 项</span>
      <div style={{ flex: 1 }} />
      {importLabel && (
        <button
          type="button"
          style={{
            ...importBtnStyle,
            opacity: disabled ? 0.48 : 1,
            cursor: disabled ? "not-allowed" : "pointer",
          }}
          onClick={onImport}
          disabled={disabled}
          title={disabled ? "manifest 结构异常，修复后才能导入资产" : undefined}
        >
          {importLabel}
        </button>
      )}
      {orphanCount > 0 && onRegisterOrphans && (
        <button type="button" style={secondaryBtnStyle} onClick={onRegisterOrphans} disabled={disabled}>
          {`登记 ${orphanCount} 个孤儿`}
        </button>
      )}
      {danglingCount > 0 && onRemoveDanglingRefs && (
        <button type="button" style={secondaryBtnStyle} onClick={onRemoveDanglingRefs} disabled={disabled}>
          {`清理 ${danglingCount} 个悬空引用`}
        </button>
      )}
      {orphanCount > 0 && onDeleteOrphans && (
        <button type="button" style={dangerBtnStyle} onClick={onDeleteOrphans} disabled={disabled}>
          {`删除 ${orphanCount} 个孤儿`}
        </button>
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

const importBtnStyle: React.CSSProperties = {
  fontSize: "var(--text-sm)",
  padding: "5px var(--space-3)",
  borderRadius: "var(--radius-sm)",
  border: `1px solid var(--border-input)`,
  background: "var(--bg-active)",
  color: "var(--text-bright)",
  cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  fontSize: "var(--text-sm)",
  padding: "5px var(--space-2)",
  borderRadius: "var(--radius-sm)",
  border: `1px solid var(--border-input)`,
  background: "var(--bg-panel)",
  color: "var(--text-secondary)",
  cursor: "pointer",
};

const dangerBtnStyle: React.CSSProperties = {
  ...secondaryBtnStyle,
  color: "var(--status-error-text)",
};
