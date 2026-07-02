interface BreadcrumbProps {
  view: "graph" | "node";
  selectedNodeTitle: string | null;
  onBackToGraph: () => void;
}

export function Breadcrumb({ view, selectedNodeTitle, onBackToGraph }: BreadcrumbProps) {
  return (
    <div style={containerStyle}>
      <span style={rootLabelStyle}>Script</span>
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
  borderBottom: "1px solid #232a38",
  background: "#0e1116",
};

const rootLabelStyle: React.CSSProperties = {
  color: "#7a8290",
  fontSize: 13,
};

const separatorStyle: React.CSSProperties = {
  color: "#4f5867",
  fontSize: 12,
};

const currentLabelStyle: React.CSSProperties = {
  color: "#d4dae2",
  fontSize: 13,
  fontWeight: 600,
};

const crumbButtonStyle: React.CSSProperties = {
  padding: 0,
  background: "transparent",
  border: "none",
  color: "#9fc8e3",
  cursor: "pointer",
  fontSize: 13,
};
