interface BreadcrumbProps {
  view: "graph" | "node";
  selectedNodeTitle: string | null;
  onBackToGraph: () => void;
}

export function Breadcrumb({ view, selectedNodeTitle, onBackToGraph }: BreadcrumbProps) {
  return (
    <div style={containerStyle}>
      <span style={rootLabelStyle}>脚本</span>
      <span style={separatorStyle}>/</span>
      {view === "graph" ? (
        <span style={currentLabelStyle}>流程图</span>
      ) : (
        <>
          <button type="button" onClick={onBackToGraph} style={crumbButtonStyle}>
            流程图
          </button>
          <span style={separatorStyle}>/</span>
          <span style={currentLabelStyle}>{selectedNodeTitle ?? "节点"}</span>
        </>
      )}
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 16px",
  borderBottom: "1px solid var(--border)",
  background: "var(--bg-app)",
};

const rootLabelStyle: React.CSSProperties = {
  color: "var(--text-muted)",
  fontSize: 13,
};

const separatorStyle: React.CSSProperties = {
  color: "var(--text-dim)",
  fontSize: 12,
};

const currentLabelStyle: React.CSSProperties = {
  color: "var(--text-primary)",
  fontSize: 13,
  fontWeight: 600,
};

const crumbButtonStyle: React.CSSProperties = {
  padding: 0,
  background: "transparent",
  border: "none",
  color: "var(--accent-bright)",
  cursor: "pointer",
  fontSize: 13,
};
