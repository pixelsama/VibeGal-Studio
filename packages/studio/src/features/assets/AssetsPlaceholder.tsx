export function AssetsPlaceholder() {
  return (
    <div style={containerStyle}>
      <div style={titleStyle}>Assets</div>
      <div style={subtitleStyle}>资源管理（即将推出）</div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  width: "100%",
  height: "100%",
  background: "#0e1116",
};

const titleStyle: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 600,
  color: "#d4dae2",
};

const subtitleStyle: React.CSSProperties = {
  fontSize: 14,
  color: "#7a8290",
};
