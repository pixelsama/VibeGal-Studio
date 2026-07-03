interface RendererSidebarProps {
  rendererIds: string[];
  activeRendererId: string;
  onSelect: (rendererId: string) => void;
}

export function RendererSidebar({ rendererIds, activeRendererId, onSelect }: RendererSidebarProps) {
  return (
    <nav style={sidebarStyle} aria-label="渲染层列表">
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
                color: active ? "#e8edf5" : "#a0a8b4",
                background: active ? "#1a2230" : "transparent",
                borderColor: active ? "#3a6ea5" : "transparent",
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
  background: "#20354b",
  color: "#9fc8e3",
  fontSize: 11,
};

const emptyStyle: React.CSSProperties = {
  padding: "8px 4px",
  color: "#7a8290",
  fontSize: 13,
};
