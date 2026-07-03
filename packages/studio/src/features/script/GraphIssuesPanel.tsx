import { useEffect, useState } from "react";
import type { GraphIssue } from "../../lib/types";

interface GraphIssuesPanelProps {
  issues: GraphIssue[];
  onSelectNode: (id: string) => void;
  onSelectEdge: (id: string) => void;
}

export function GraphIssuesPanel({ issues, onSelectNode, onSelectEdge }: GraphIssuesPanelProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const errors = issues.filter((issue) => issue.severity === "error");
  const hasIssues = issues.length > 0;
  const hasErrors = errors.length > 0;
  const label = hasIssues ? `图结构有 ${issues.length} 个问题` : "图结构正常";

  return (
    <div style={indicatorShellStyle}>
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={() => setDialogOpen(true)}
        style={indicatorButtonStyle(hasIssues, hasErrors)}
      >
        <span style={indicatorIconStyle}>{hasIssues ? "!" : "✓"}</span>
        {hasIssues && <span style={indicatorBadgeStyle(hasErrors)}>{issues.length}</span>}
      </button>
      {dialogOpen && (
        <GraphIssuesDialog
          issues={issues}
          onSelectNode={onSelectNode}
          onSelectEdge={onSelectEdge}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </div>
  );
}

export function GraphIssuesDialog({
  issues,
  onSelectNode,
  onSelectEdge,
  onClose,
}: GraphIssuesPanelProps & { onClose: () => void }) {
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warn");

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      style={overlayStyle}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="Graph Issues" style={dialogStyle}>
        <div style={dialogHeaderStyle}>
          <div>
            <div style={dialogTitleStyle}>Graph Issues</div>
            <div style={dialogMetaStyle}>
              {issues.length > 0 ? `${errors.length} error / ${warnings.length} warn` : "图结构正常"}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭 Graph Issues" style={closeButtonStyle}>
            ×
          </button>
        </div>
        <div style={dialogContentStyle}>
          {issues.length === 0 ? (
            <div style={okStyle}>✓ 图结构正常</div>
          ) : (
            <>
              <IssueGroup
                title="Errors"
                issues={errors}
                onSelectNode={onSelectNode}
                onSelectEdge={onSelectEdge}
                onClose={onClose}
              />
              <IssueGroup
                title="Warnings"
                issues={warnings}
                onSelectNode={onSelectNode}
                onSelectEdge={onSelectEdge}
                onClose={onClose}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function IssueGroup({
  title,
  issues,
  onSelectNode,
  onSelectEdge,
  onClose,
}: {
  title: string;
  issues: GraphIssue[];
  onSelectNode: (id: string) => void;
  onSelectEdge: (id: string) => void;
  onClose: () => void;
}) {
  if (issues.length === 0) return null;

  return (
    <section style={groupStyle}>
      <div style={groupTitleStyle}>{title}</div>
      {issues.map((issue, index) => {
        const targetLabel = issue.nodeId ? `node ${issue.nodeId}` : issue.edgeId ? `edge ${issue.edgeId}` : issue.code;
        return (
          <IssueCard
            key={`${issue.code}-${issue.nodeId ?? issue.edgeId ?? index}`}
            issue={issue}
            targetLabel={targetLabel}
            onSelectNode={onSelectNode}
            onSelectEdge={onSelectEdge}
            onClose={onClose}
          />
        );
      })}
    </section>
  );
}

function IssueCard({
  issue,
  targetLabel,
  onSelectNode,
  onSelectEdge,
  onClose,
}: {
  issue: GraphIssue;
  targetLabel: string;
  onSelectNode: (id: string) => void;
  onSelectEdge: (id: string) => void;
  onClose: () => void;
}) {
  const canSelectTarget = Boolean(issue.nodeId || issue.edgeId);

  return (
    <button
      type="button"
      onClick={() => {
        if (issue.nodeId) {
          onSelectNode(issue.nodeId);
          onClose();
        } else if (issue.edgeId) {
          onSelectEdge(issue.edgeId);
          onClose();
        }
      }}
      style={{
        ...issueButtonStyle,
        borderColor: issue.severity === "error" ? "#5a2b2b" : "#594823",
        cursor: canSelectTarget ? "pointer" : "default",
      }}
    >
      <span
        style={{
          ...severityDotStyle,
          background: issue.severity === "error" ? "#d66a6a" : "#d49b4d",
        }}
      />
      <span style={issueTextStyle}>
        <span style={issueCodeStyle}>{issue.code}</span>
        <span>{issue.message}</span>
        {issue.file && <span style={targetStyle}>{issue.file}</span>}
        {issue.jsonPath && <span style={targetStyle}>{issue.jsonPath}</span>}
        <span style={targetStyle}>{targetLabel}</span>
      </span>
    </button>
  );
}

const indicatorShellStyle: React.CSSProperties = {
  position: "absolute",
  right: 18,
  bottom: 18,
  zIndex: 30,
};

function indicatorButtonStyle(hasIssues: boolean, hasErrors: boolean): React.CSSProperties {
  const color = !hasIssues ? "#4caf7a" : hasErrors ? "#d66a6a" : "#d49b4d";
  const background = !hasIssues ? "#11231a" : hasErrors ? "#271616" : "#241d12";
  return {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 38,
    height: 38,
    borderRadius: 999,
    border: `1px solid ${color}`,
    background,
    color,
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.45)",
    cursor: "pointer",
  };
}

const indicatorIconStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 800,
  lineHeight: 1,
};

function indicatorBadgeStyle(hasErrors: boolean): React.CSSProperties {
  return {
    position: "absolute",
    top: -6,
    right: -6,
    minWidth: 18,
    height: 18,
    padding: "0 5px",
    borderRadius: 999,
    border: "1px solid #0b0e14",
    background: hasErrors ? "#d66a6a" : "#d49b4d",
    color: "#0b0e14",
    fontSize: 11,
    fontWeight: 800,
    lineHeight: "18px",
    textAlign: "center",
    boxSizing: "border-box",
  };
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1100,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  background: "rgba(0, 0, 0, 0.5)",
};

const dialogStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  width: "min(720px, calc(100vw - 48px))",
  maxHeight: "min(680px, calc(100vh - 48px))",
  background: "#141922",
  border: "1px solid #2f394a",
  borderRadius: 12,
  boxShadow: "0 16px 40px rgba(0, 0, 0, 0.6)",
  overflow: "hidden",
};

const dialogHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 18,
  padding: "16px 18px",
  borderBottom: "1px solid #232a38",
};

const dialogTitleStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: "#e8edf5",
};

const dialogMetaStyle: React.CSSProperties = {
  marginTop: 4,
  color: "#7a8290",
  fontSize: 12,
};

const closeButtonStyle: React.CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 8,
  border: "1px solid #2f394a",
  background: "#0e1116",
  color: "#a0a8b4",
  cursor: "pointer",
  fontSize: 18,
  lineHeight: 1,
};

const dialogContentStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 14,
  padding: 16,
  overflowY: "auto",
};

const okStyle: React.CSSProperties = {
  color: "#93d3b0",
  fontSize: 13,
};

const groupStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const groupTitleStyle: React.CSSProperties = {
  color: "#7a8290",
  fontSize: 11,
  textTransform: "uppercase",
};

const issueButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
  width: "100%",
  padding: 10,
  borderRadius: 8,
  border: "1px solid",
  background: "#141922",
  color: "#d4dae2",
  cursor: "pointer",
  textAlign: "left",
};

const severityDotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 999,
  marginTop: 5,
  flexShrink: 0,
};

const issueTextStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  minWidth: 0,
  fontSize: 12,
  lineHeight: 1.35,
  flex: 1,
};

const issueCodeStyle: React.CSSProperties = {
  color: "#9fc8e3",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 11,
};

const targetStyle: React.CSSProperties = {
  color: "#7a8290",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 11,
  wordBreak: "break-all",
};
