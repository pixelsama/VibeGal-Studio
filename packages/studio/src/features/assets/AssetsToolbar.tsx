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
  disabled?: boolean;
}

export function AssetsToolbar({ section, search, onSearch, onImport, count, disabled = false }: AssetsToolbarProps) {
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
  gap: 10,
  padding: "10px 14px",
  borderBottom: "1px solid #232a38",
};

const searchInputStyle: React.CSSProperties = {
  width: 220,
  fontSize: 12,
  padding: "5px 9px",
  borderRadius: 6,
  border: "1px solid #2f394a",
  background: "#0e1116",
  color: "#d4dae2",
  outline: "none",
};

const countStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#7a8290",
};

const importBtnStyle: React.CSSProperties = {
  fontSize: 12,
  padding: "5px 12px",
  borderRadius: 6,
  border: "1px solid #2f394a",
  background: "#1a2230",
  color: "#e8edf5",
  cursor: "pointer",
};
