import { useStudioI18n } from "../../lib/i18n";

interface BreadcrumbProps {
  view: "graph" | "node";
  selectedNodeTitle: string | null;
  onBackToGraph: () => void;
}

export function Breadcrumb({ view, selectedNodeTitle, onBackToGraph }: BreadcrumbProps) {
  const { t } = useStudioI18n();
  return (
    <div style={containerStyle}>
      <span style={rootLabelStyle}>{t("script.breadcrumb.root")}</span>
      <span style={separatorStyle}>/</span>
      {view === "graph" ? (
        <span style={currentLabelStyle}>{t("script.breadcrumb.flowchart")}</span>
      ) : (
        <>
          <button type="button" onClick={onBackToGraph} style={crumbButtonStyle}>
            {t("script.breadcrumb.flowchart")}
          </button>
          <span style={separatorStyle}>/</span>
          <span style={currentLabelStyle}>{selectedNodeTitle ?? t("script.breadcrumb.node")}</span>
        </>
      )}
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  padding: "var(--space-2) var(--space-4)",
  borderBottom: "1px solid var(--border)",
  background: "var(--bg-app)",
};

const rootLabelStyle: React.CSSProperties = {
  color: "var(--text-muted)",
  fontSize: "var(--text-base)",
};

const separatorStyle: React.CSSProperties = {
  color: "var(--text-dim)",
  fontSize: "var(--text-sm)",
};

const currentLabelStyle: React.CSSProperties = {
  color: "var(--text-primary)",
  fontSize: "var(--text-base)",
  fontWeight: 600,
};

const crumbButtonStyle: React.CSSProperties = {
  padding: 0,
  background: "transparent",
  border: "none",
  color: "var(--accent-bright)",
  cursor: "pointer",
  fontSize: "var(--text-base)",
};
