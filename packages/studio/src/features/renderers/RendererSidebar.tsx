import { Button } from "../common/Button";

interface RendererSidebarProps {
  rendererIds: string[];
  activeRendererId: string;
  onSelect: (rendererId: string) => void;
  onCreate?: () => void;
  onDuplicate?: (rendererId: string) => void;
  onRename?: (rendererId: string) => void;
  onDelete?: (rendererId: string) => void;
}

export function RendererSidebar({
  rendererIds,
  activeRendererId,
  onSelect,
  onCreate,
  onDuplicate,
  onRename,
  onDelete,
}: RendererSidebarProps) {
  return (
    <nav style={sidebarStyle} aria-label="渲染层列表">
      <div style={toolbarStyle}>
        <Button variant="secondary" style={compactBtnStyle} onClick={onCreate}>新建</Button>
        <Button variant="secondary" style={compactBtnStyle} onClick={() => onDuplicate?.(activeRendererId)} disabled={!activeRendererId}>复制</Button>
        <Button variant="secondary" style={compactBtnStyle} onClick={() => onRename?.(activeRendererId)} disabled={!activeRendererId}>重命名</Button>
        <Button variant="secondary" style={{ ...compactBtnStyle, color: "var(--status-error-text)" }} onClick={() => onDelete?.(activeRendererId)} disabled={!activeRendererId}>删除</Button>
      </div>
      {rendererIds.length === 0 ? (
        <div style={emptyStyle}>暂无渲染层</div>
      ) : (
        rendererIds.map((id) => {
          const active = id === activeRendererId;
          return (
            <button
              key={id}
              type="button"
              data-renderer-id={id}
              onClick={() => onSelect(id)}
              aria-current={active ? "page" : undefined}
              style={{
                ...itemStyle,
                color: active ? "var(--text-bright)" : "var(--text-secondary)",
                background: active ? "var(--bg-active)" : "transparent",
                borderColor: active ? "var(--accent)" : "transparent",
              }}
            >
              <span style={itemNameStyle}>{id}</span>
              {active && <span style={activeBadgeStyle}>当前</span>}
            </button>
          );
        })
      )}
    </nav>
  );
}

const sidebarStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-1)",
  width: "100%",
  height: "100%",
  boxSizing: "border-box",
  padding: "var(--space-3) var(--space-2)",
  overflowY: "auto",
};

const toolbarStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: "var(--space-1)",
  marginBottom: "var(--space-2)",
};

const compactBtnStyle: React.CSSProperties = {
  minHeight: "var(--control-lg)",
  padding: "0 var(--space-3)",
  fontSize: "var(--text-sm)",
};

const itemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  width: "100%",
  minHeight: 34,
  padding: "var(--space-2) var(--space-2)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid transparent",
  background: "transparent",
  cursor: "pointer",
  textAlign: "left",
};

const itemNameStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: "var(--text-base)",
};

const activeBadgeStyle: React.CSSProperties = {
  flexShrink: 0,
  padding: "1px var(--space-1)",
  borderRadius: "var(--radius-pill)",
  background: "var(--bg-accent-soft)",
  color: "var(--accent-bright)",
  fontSize: "var(--text-xs)",
};

const emptyStyle: React.CSSProperties = {
  padding: "var(--space-2) var(--space-1)",
  color: "var(--text-muted)",
  fontSize: "var(--text-base)",
};
