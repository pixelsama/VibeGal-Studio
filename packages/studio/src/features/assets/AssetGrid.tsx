/**
 * AssetGrid —— 资产网格容器。
 *
 * 接收已过滤的卡片列表（AssetCard / DanglingCard），按响应式网格排列。
 * 空态显示提示文案。
 */
import type { ReactNode } from "react";

interface AssetGridProps {
  children: ReactNode;
  emptyHint: string;
}

export function AssetGrid({ children, emptyHint }: AssetGridProps) {
  const childCount = Array.isArray(children) ? children.filter(Boolean).length : children ? 1 : 0;
  if (childCount === 0) {
    return <div style={emptyStyle}>{emptyHint}</div>;
  }
  return <div style={gridStyle}>{children}</div>;
}

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(168px, 1fr))",
  gap: 14,
  padding: "var(--space-4)",
  alignContent: "start",
};

const emptyStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "100%",
  height: "100%",
  color: "var(--text-muted)",
  fontSize: "var(--text-base)",
};
