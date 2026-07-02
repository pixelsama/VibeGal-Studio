import type { GraphIssue } from "../../lib/types";

interface GraphIssuesPanelProps {
  issues: GraphIssue[];
  onSelectNode: (id: string) => void;
  onSelectEdge: (id: string) => void;
}

export function GraphIssuesPanel({ issues, onSelectNode, onSelectEdge }: GraphIssuesPanelProps) {
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warn");

  return (
    <div style={panelStyle}>
      <div style={panelHeaderStyle}>
        <span>Graph Issues</span>
        {issues.length > 0 && <span style={countStyle}>{errors.length} error / {warnings.length} warn</span>}
      </div>
      <div style={contentStyle}>
        {issues.length === 0 ? (
          <div style={okStyle}>✓ 图结构正常</div>
        ) : (
          <>
            <IssueGroup title="Errors" issues={errors} onSelectNode={onSelectNode} onSelectEdge={onSelectEdge} />
            <IssueGroup title="Warnings" issues={warnings} onSelectNode={onSelectNode} onSelectEdge={onSelectEdge} />
          </>
        )}
      </div>
    </div>
  );
}

function IssueGroup({
  title,
  issues,
  onSelectNode,
  onSelectEdge,
}: {
  title: string;
  issues: GraphIssue[];
  onSelectNode: (id: string) => void;
  onSelectEdge: (id: string) => void;
}) {
  if (issues.length === 0) return null;

  return (
    <section style={groupStyle}>
      <div style={groupTitleStyle}>{title}</div>
      {issues.map((issue, index) => {
        const targetLabel = issue.nodeId ? `node ${issue.nodeId}` : issue.edgeId ? `edge ${issue.edgeId}` : issue.code;
        return (
          <button
            key={`${issue.code}-${issue.nodeId ?? issue.edgeId ?? index}`}
            type="button"
            onClick={() => {
              if (issue.nodeId) onSelectNode(issue.nodeId);
              else if (issue.edgeId) onSelectEdge(issue.edgeId);
            }}
            style={{
              ...issueButtonStyle,
              borderColor: issue.severity === "error" ? "#5a2b2b" : "#594823",
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
              <span style={targetStyle}>{targetLabel}</span>
            </span>
          </button>
        );
      })}
    </section>
  );
}

const panelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  background: "#0e1116",
};

const panelHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "12px 16px",
  borderTop: "1px solid #232a38",
  borderBottom: "1px solid #232a38",
  fontSize: 13,
  fontWeight: 600,
  color: "#d4dae2",
};

const countStyle: React.CSSProperties = {
  color: "#7a8290",
  fontSize: 11,
  fontWeight: 500,
};

const contentStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: 12,
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
