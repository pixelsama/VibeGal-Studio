import type { ReactNode } from "react";

export function CenteredMessage({ children, mono = false }: { children: ReactNode; mono?: boolean }) {
  return (
    <div style={shellStyle}>
      <div
        style={{
          ...contentStyle,
          fontFamily: mono ? "ui-monospace, monospace" : "inherit",
        }}
      >
        {children}
      </div>
    </div>
  );
}

const shellStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  overflow: "auto",
  padding: "var(--space-6)",
};

const contentStyle: React.CSSProperties = {
  margin: "auto",
  maxWidth: "min(760px, 100%)",
  color: "var(--text-primary)",
  whiteSpace: "pre-wrap",
  textAlign: "center",
  lineHeight: 1.8,
  fontSize: "var(--text-md)",
};
