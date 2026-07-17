/**
 * StatusPanel —— 通用右下角状态指示器 + 问题弹窗。
 *
 * 从 script/GraphIssuesPanel 抽取，保留可选的图结构目标字段（nodeId/edgeId），
 * 并通过 props 注入领域文案与可选的「跳转/额外标签」回调。
 * 流程图页与资产页共用此组件，保证视觉与交互一致。
 *
 * 约定：父容器需 position: relative，本指示器用 absolute 锚定到右下角。
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Check, X } from "lucide-react";

/** 通用问题项。nodeId/edgeId 仅供图结构问题定位使用。 */
export interface StatusIssue {
  severity: "error" | "warn";
  /** 问题来源，用作弹窗分组键（如 "graph" / "asset" / "manifest"）。无则归入「其他」 */
  source?: string;
  code: string;
  message: string;
  file?: string;
  jsonPath?: string;
  nodeId?: string;
  edgeId?: string;
}

export interface StatusPanelProps {
  issues: StatusIssue[];
  /** 正常时的按钮文案 / title，如 "项目正常" */
  okLabel: string;
  /** 有问题时的按钮文案，参数为问题总数，如 (n) => `项目有 ${n} 个问题` */
  notOkLabel: (count: number) => string;
  /** 弹窗标题，如 "Project Issues" */
  dialogTitle: string;
  /** 弹窗的 aria-label */
  dialogAriaLabel: string;
  /** 弹窗内正常态副标题，如 "项目正常"；不传则用 okLabel */
  emptyDescription?: string;
  /** 点击某条问题卡片时的回调（可选，无则卡片不可点击） */
  onIssueClick?: (issue: StatusIssue) => void;
  /** 指定哪些问题卡片可点击；不传则只要有 onIssueClick 就全部可点击 */
  isIssueClickable?: (issue: StatusIssue) => boolean;
  /** 渲染每张卡片的额外标签，可选 */
  issueExtra?: (issue: StatusIssue) => ReactNode;
  /** 把 source id 映射成分组标题（如 "graph" → "图结构"）。不传则直接显示 source 原值 */
  sourceLabel?: (source: string) => string;
}

export function StatusPanel({
  issues,
  okLabel,
  notOkLabel,
  dialogTitle,
  dialogAriaLabel,
  emptyDescription,
  onIssueClick,
  isIssueClickable,
  issueExtra,
  sourceLabel,
}: StatusPanelProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const errors = issues.filter((issue) => issue.severity === "error");
  const hasIssues = issues.length > 0;
  const hasErrors = errors.length > 0;
  const label = hasIssues ? notOkLabel(issues.length) : okLabel;

  return (
    <div style={indicatorShellStyle}>
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={() => setDialogOpen(true)}
        className="gs-status-indicator"
        style={indicatorButtonStyle(hasIssues, hasErrors)}
      >
        <span style={indicatorIconStyle(hasIssues)}>{hasIssues ? "!" : "✓"}</span>
        {hasIssues && <span style={indicatorCountStyle}>{issues.length}</span>}
      </button>
      {dialogOpen && (
        <StatusDialog
          issues={issues}
          okLabel={okLabel}
          emptyDescription={emptyDescription}
          dialogTitle={dialogTitle}
          dialogAriaLabel={dialogAriaLabel}
          onIssueClick={onIssueClick}
          isIssueClickable={isIssueClickable}
          issueExtra={issueExtra}
          sourceLabel={sourceLabel}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </div>
  );
}

export interface StatusDialogProps {
  issues: StatusIssue[];
  okLabel: string;
  emptyDescription?: string;
  dialogTitle: string;
  dialogAriaLabel: string;
  onIssueClick?: (issue: StatusIssue) => void;
  isIssueClickable?: (issue: StatusIssue) => boolean;
  issueExtra?: (issue: StatusIssue) => ReactNode;
  sourceLabel?: (source: string) => string;
  onClose: () => void;
}

/**
 * 按 source 分组问题：保持首次出现顺序，组内 error 优先于 warn（稳定排序）。
 * 无 source 的归入「其他」。
 */
function groupBySource(
  issues: StatusIssue[],
  sourceLabel?: (source: string) => string,
): { title: string; issues: StatusIssue[] }[] {
  const order: string[] = [];
  const buckets = new Map<string, StatusIssue[]>();
  for (const issue of issues) {
    const rawSource = issue.source ?? "其他";
    const key = sourceLabel ? sourceLabel(issue.source ?? "其他") : rawSource;
    if (!buckets.has(key)) {
      order.push(key);
      buckets.set(key, []);
    }
    buckets.get(key)!.push(issue);
  }
  // 组内 error 优先（稳定：同 severity 保持原顺序）
  for (const list of buckets.values()) {
    list.sort((a, b) => {
      if (a.severity === b.severity) return 0;
      return a.severity === "error" ? -1 : 1;
    });
  }
  return order.map((title) => ({ title, issues: buckets.get(title)! }));
}

export function StatusDialog({
  issues,
  okLabel,
  emptyDescription,
  dialogTitle,
  dialogAriaLabel,
  onIssueClick,
  isIssueClickable,
  issueExtra,
  sourceLabel,
  onClose,
}: StatusDialogProps) {
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warn");
  const groups = issues.length > 0 ? groupBySource(issues, sourceLabel) : [];

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="gs-anim-fade"
      style={overlayStyle}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={dialogAriaLabel} className="gs-anim-pop" style={dialogStyle}>
        <div style={dialogHeaderStyle}>
          <div>
            <div style={dialogTitleStyle}>{dialogTitle}</div>
            <div style={dialogMetaStyle}>
              {issues.length > 0 ? `${errors.length} error / ${warnings.length} warn` : emptyDescription ?? okLabel}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label={`关闭 ${dialogTitle}`} className="gs-chip-btn">
            <X size={14} />
          </button>
        </div>
        <div style={dialogContentStyle}>
          {issues.length === 0 ? (
            <div style={{ ...okStyle, display: "inline-flex", alignItems: "center", gap: "var(--space-1)" }}>
              <Check size={14} />
              {emptyDescription ?? okLabel}
            </div>
          ) : (
            groups.map((group) => (
              <IssueGroup
                key={group.title}
                title={group.title}
                issues={group.issues}
                onIssueClick={onIssueClick}
                isIssueClickable={isIssueClickable}
                issueExtra={issueExtra}
                onClose={onClose}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function IssueGroup({
  title,
  issues,
  onIssueClick,
  isIssueClickable,
  issueExtra,
  onClose,
}: {
  title: string;
  issues: StatusIssue[];
  onIssueClick?: (issue: StatusIssue) => void;
  isIssueClickable?: (issue: StatusIssue) => boolean;
  issueExtra?: (issue: StatusIssue) => ReactNode;
  onClose: () => void;
}) {
  if (issues.length === 0) return null;

  return (
    <section style={groupStyle}>
      <div style={groupTitleStyle}>{title}</div>
      {issues.map((issue, index) => (
        <IssueCard
          key={`${issue.code}-${issue.file ?? ""}-${issue.jsonPath ?? ""}-${index}`}
          issue={issue}
          onIssueClick={onIssueClick}
          isIssueClickable={isIssueClickable}
          issueExtra={issueExtra}
          onClose={onClose}
        />
      ))}
    </section>
  );
}

function IssueCard({
  issue,
  onIssueClick,
  isIssueClickable,
  issueExtra,
  onClose,
}: {
  issue: StatusIssue;
  onIssueClick?: (issue: StatusIssue) => void;
  isIssueClickable?: (issue: StatusIssue) => boolean;
  issueExtra?: (issue: StatusIssue) => ReactNode;
  onClose: () => void;
}) {
  const clickable = Boolean(onIssueClick && (!isIssueClickable || isIssueClickable(issue)));

  return (
    <button
      type="button"
      className={clickable ? "gs-issue-card gs-issue-card--clickable" : "gs-issue-card"}
      onClick={() => {
        if (clickable && onIssueClick) {
          onIssueClick(issue);
          onClose();
        }
      }}
      style={{
        borderColor: issue.severity === "error" ? "var(--border-error)" : "var(--border-warn)",
        cursor: clickable ? "pointer" : "default",
      }}
    >
      <span
        style={{
          ...severityDotStyle,
          background: issue.severity === "error" ? "var(--status-error)" : "var(--status-warn)",
        }}
      />
      <span style={issueTextStyle}>
        <span style={issueHeadStyle}>
          <span style={severityTagStyle(issue.severity)}>
            {issue.severity === "error" ? "Error" : "Warning"}
          </span>
          <span style={issueCodeStyle}>{issue.code}</span>
        </span>
        <span>{issue.message}</span>
        {issue.file && <span style={targetStyle}>{issue.file}</span>}
        {issue.jsonPath && <span style={targetStyle}>{issue.jsonPath}</span>}
        {issueExtra && <span style={targetStyle}>{issueExtra(issue)}</span>}
      </span>
    </button>
  );
}

// ── 样式（数值与原 GraphIssuesPanel 完全一致，保证视觉统一） ──
// 指示器按钮的静态样式与 hover 在 .gs-status-indicator（index.css），
// 这里只保留按状态变化的颜色 / 尺寸 / 透明度。

const indicatorShellStyle: React.CSSProperties = {
  position: "absolute",
  right: 10,
  bottom: 10,
  zIndex: 30,
};

function indicatorButtonStyle(hasIssues: boolean, hasErrors: boolean): React.CSSProperties {
  const color = !hasIssues ? "var(--status-ok-text)" : hasErrors ? "var(--status-error-text)" : "var(--status-warn-text)";
  return {
    minWidth: hasIssues ? 34 : 24,
    padding: hasIssues ? "0 var(--space-1)" : 0,
    color,
    opacity: hasIssues ? 1 : 0.72,
  };
}

function indicatorIconStyle(hasIssues: boolean): React.CSSProperties {
  return {
    fontSize: hasIssues ? "var(--text-base)" : "var(--text-sm)",
    fontWeight: 700,
    lineHeight: 1,
  };
}

const indicatorCountStyle: React.CSSProperties = {
  fontSize: "var(--text-xs)",
  fontWeight: 700,
  lineHeight: 1,
};

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1100,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "var(--space-6)",
  background: "var(--overlay)",
};

const dialogStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  width: "min(720px, calc(100vw - 48px))",
  maxHeight: "min(680px, calc(100vh - 48px))",
  background: "var(--bg-panel)",
  border: "1px solid var(--border-input)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-modal)",
  overflow: "hidden",
};

const dialogHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 18,
  padding: "var(--space-4) var(--space-4)",
  borderBottom: "1px solid var(--border)",
};

const dialogTitleStyle: React.CSSProperties = {
  fontSize: "var(--text-lg)",
  fontWeight: 700,
  color: "var(--text-bright)",
};

const dialogMetaStyle: React.CSSProperties = {
  marginTop: "var(--space-1)",
  color: "var(--text-muted)",
  fontSize: "var(--text-sm)",
};

const dialogContentStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 14,
  padding: "var(--space-4)",
  overflowY: "auto",
};

const okStyle: React.CSSProperties = {
  color: "var(--status-ok-text)",
  fontSize: "var(--text-base)",
};

const groupStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
};

const groupTitleStyle: React.CSSProperties = {
  color: "var(--text-muted)",
  fontSize: "var(--text-xs)",
  textTransform: "uppercase",
};

const severityDotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: "var(--radius-pill)",
  marginTop: 5,
  flexShrink: 0,
};

const issueTextStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-1)",
  minWidth: 0,
  fontSize: "var(--text-sm)",
  lineHeight: 1.35,
  flex: 1,
};

/** 卡片头部：severity 标签 + code 并排 */
const issueHeadStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
};

/** severity 文字标签：error 红、warn 琥珀，让来源分组下 severity 可辨 */
function severityTagStyle(severity: "error" | "warn"): React.CSSProperties {
  return {
    fontSize: "var(--text-xs)",
    fontWeight: 700,
    padding: "1px var(--space-1)",
    borderRadius: "var(--radius-xs)",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    background: severity === "error" ? "var(--bg-tag-error)" : "var(--bg-tag-warn)",
    color: severity === "error" ? "var(--status-error)" : "var(--status-warn)",
  };
}

const issueCodeStyle: React.CSSProperties = {
  color: "var(--accent-bright)",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: "var(--text-xs)",
};

const targetStyle: React.CSSProperties = {
  color: "var(--text-muted)",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: "var(--text-xs)",
  wordBreak: "break-all",
};
