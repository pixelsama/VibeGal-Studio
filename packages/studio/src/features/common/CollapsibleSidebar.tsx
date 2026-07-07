import type { ReactNode } from "react";

interface CollapsibleSidebarProps {
  title: string;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  expandedWidth: number;
  collapsedLabel: string;
  children: ReactNode;
}

export function CollapsibleSidebar({
  title,
  collapsed,
  onCollapsedChange,
  expandedWidth,
  collapsedLabel,
  children,
}: CollapsibleSidebarProps) {
  return (
    <aside
      style={{
        ...shellStyle,
        width: collapsed ? 44 : expandedWidth,
      }}
      aria-label={title}
    >
      <div style={collapsed ? collapsedHeaderStyle : headerStyle}>
        {!collapsed && <div style={titleStyle}>{title}</div>}
        <button
          type="button"
          aria-label={collapsed ? `展开${title}` : `收起${title}`}
          aria-expanded={!collapsed}
          title={collapsed ? `展开${title}` : `收起${title}`}
          onClick={() => onCollapsedChange(!collapsed)}
          style={toggleButtonStyle}
        >
          {collapsed ? "›" : "‹"}
        </button>
      </div>
      {collapsed ? (
        <div aria-hidden="true" style={collapsedLabelStyle}>{collapsedLabel}</div>
      ) : (
        <div style={contentStyle}>{children}</div>
      )}
    </aside>
  );
}

const shellStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flexShrink: 0,
  height: "100%",
  minWidth: 0,
  background: "var(--bg-app)",
  borderRight: "1px solid var(--border)",
  overflow: "hidden",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  minHeight: 42,
  padding: "0 var(--space-2) 0 var(--space-3)",
  borderBottom: "1px solid var(--border)",
};

const collapsedHeaderStyle: React.CSSProperties = {
  ...headerStyle,
  justifyContent: "center",
  padding: 0,
};

const titleStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: "var(--text-base)",
  fontWeight: 600,
  color: "var(--text-primary)",
};

const toggleButtonStyle: React.CSSProperties = {
  width: 26,
  height: 26,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-sm)",
  background: "var(--bg-panel)",
  color: "var(--text-secondary)",
  cursor: "pointer",
  fontSize: "var(--text-xl)",
  lineHeight: 1,
  flexShrink: 0,
};

const contentStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
};

const collapsedLabelStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  writingMode: "vertical-rl",
  color: "var(--text-muted)",
  fontSize: "var(--text-sm)",
  userSelect: "none",
};
