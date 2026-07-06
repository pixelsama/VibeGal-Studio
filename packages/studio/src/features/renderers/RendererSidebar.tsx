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
  gap: 4,
  width: "100%",
  height: "100%",
  boxSizing: "border-box",
  padding: "10px 8px",
  overflowY: "auto",
};

const toolbarStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 6,
  marginBottom: 8,
};

const compactBtnStyle: React.CSSProperties = {
  minHeight: 30,
  padding: "0 10px",
  fontSize: 12,
};

const itemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  minHeight: 34,
  padding: "7px 9px",
  borderRadius: 6,
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
  fontSize: 13,
};

const activeBadgeStyle: React.CSSProperties = {
  flexShrink: 0,
  padding: "1px 6px",
  borderRadius: 999,
  background: "var(--bg-accent-soft)",
  color: "var(--accent-bright)",
  fontSize: 11,
};

const emptyStyle: React.CSSProperties = {
  padding: "8px 4px",
  color: "var(--text-muted)",
  fontSize: 13,
};
