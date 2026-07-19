/**
 * SkinAssetsSection —— 外观工作台「贴图」分组（Spec 19 §4.5）。
 *
 * 展示生效 skin 的 `assets` 槽位：缩略图 + 槽位名 + 路径，V1 只读
 * （就地换图留后续）。折叠的高级区，用原生 <details>：内容始终渲染进 DOM
 * （便于 SSR/测试断言），浏览器负责开合。
 *
 * 已知限制（spec §4.5）：渲染层契约不声明消费哪些贴图槽，这里只能做槽位级
 * 通用展示，做不到零件级映射。
 *
 * 缩略图复用资产页的 convertFileSrc 机制（assetPreview.resolveAssetUrl，
 * 相对 content 根解析）。
 */
import { previewKind, resolveAssetUrl } from "../assets/assetPreview";

interface SkinAssetsSectionProps {
  projectPath: string;
  /** 生效 skin 的 assets 槽位表（槽位名 → 相对 content 根的路径） */
  assets: Record<string, string>;
}

export function SkinAssetsSection({ projectPath, assets }: SkinAssetsSectionProps) {
  const entries = Object.entries(assets);
  return (
    <details style={sectionStyle} aria-label="贴图">
      <summary style={summaryStyle}>
        贴图{entries.length > 0 ? `（${entries.length}）` : ""}
      </summary>
      {entries.length === 0 ? (
        <p style={emptyStyle}>
          当前外观没有贴图槽。需要界面贴图时，先到「资产」页导入外观资源。
        </p>
      ) : (
        <ul style={listStyle}>
          {entries.map(([slot, path]) => (
            <li key={slot} style={itemStyle}>
              {previewKind(path) === "image" ? (
                <img src={resolveAssetUrl(projectPath, path)} alt={slot} style={thumbStyle} />
              ) : (
                <span style={thumbPlaceholderStyle} aria-hidden="true">文件</span>
              )}
              <span style={slotNameStyle} title={slot}>{slot}</span>
              <code style={pathStyle} title={path}>{path}</code>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

const sectionStyle: React.CSSProperties = {
  margin: "0 var(--space-3) var(--space-4)",
  padding: "var(--space-2) 0 0",
  borderTop: "1px solid var(--border)",
  fontSize: "var(--text-sm)",
};

const summaryStyle: React.CSSProperties = {
  cursor: "pointer",
  fontWeight: 600,
  color: "var(--text-secondary)",
  userSelect: "none",
};

const emptyStyle: React.CSSProperties = {
  margin: "var(--space-2) 0 0",
  color: "var(--text-muted)",
  lineHeight: 1.6,
};

const listStyle: React.CSSProperties = {
  listStyle: "none",
  margin: "var(--space-2) 0 0",
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
};

const itemStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "40px minmax(0, auto) minmax(0, 1fr)",
  alignItems: "center",
  gap: "var(--space-2)",
  minWidth: 0,
};

const thumbStyle: React.CSSProperties = {
  width: 40,
  height: 40,
  objectFit: "contain",
  borderRadius: "var(--radius-xs)",
  border: "1px solid var(--border)",
  background: "var(--bg-inset)",
};

const thumbPlaceholderStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 40,
  height: 40,
  borderRadius: "var(--radius-xs)",
  border: "1px solid var(--border)",
  background: "var(--bg-inset)",
  color: "var(--text-muted)",
  fontSize: "var(--text-xs)",
};

const slotNameStyle: React.CSSProperties = {
  color: "var(--text-primary)",
  fontWeight: 600,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const pathStyle: React.CSSProperties = {
  color: "var(--text-muted)",
  fontSize: "var(--text-xs)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
