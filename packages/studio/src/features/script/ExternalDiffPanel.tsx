import type { CSSProperties } from "react";
import { Button } from "../common/Button";
import { summarizeDiff, type DiffRow } from "./externalDiff";

/**
 * 外部更新/写入冲突的确认面板：先展示"当前草稿 vs 外部版本"的行级 diff，
 * 再让用户决定载入外部版本、另存草稿副本或继续编辑。
 */
export function ExternalDiffPanel({
  writeConflict,
  loading,
  rows,
  saving,
  onLoadExternal,
  onSaveDraftCopy,
  onDismiss,
}: {
  writeConflict: boolean;
  loading: boolean;
  rows: DiffRow[] | null;
  saving: boolean;
  onLoadExternal: () => void;
  onSaveDraftCopy: () => void;
  onDismiss: () => void;
}) {
  const summary = rows ? summarizeDiff(rows) : null;
  return (
    <div data-region="external-diff-panel" style={panelStyle}>
      <div style={headerStyle}>
        <div style={titleStyle}>
          {writeConflict ? "保存冲突：文件已被外部修改" : "文件已被外部更新"}
        </div>
        <div style={summaryStyle}>
          {loading
            ? "正在获取外部版本…"
            : summary && (summary.added > 0 || summary.removed > 0)
              ? `+${summary.added} 行新增 / -${summary.removed} 行删除（相对当前草稿）`
              : "文本内容一致，仅文件版本变化"}
        </div>
      </div>
      {loading ? (
        <div style={placeholderStyle}>正在获取外部版本，稍后这里会显示差异…</div>
      ) : (
        <>
          <div style={legendStyle}>
            <span style={removedLegendStyle}>- 当前草稿</span>
            <span style={addedLegendStyle}>+ 外部版本</span>
          </div>
          <div data-region="external-diff-body" style={bodyStyle}>
            {(rows ?? []).map((row, index) => (
              <div key={index} data-diff-type={row.type} style={rowStyle(row.type)}>
                <span style={markerStyle}>{row.type === "added" ? "+" : row.type === "removed" ? "-" : " "}</span>
                <span>{row.text || " "}</span>
              </div>
            ))}
          </div>
        </>
      )}
      <div style={actionsStyle}>
        <Button variant="primary" onClick={onLoadExternal} disabled={saving || loading}>
          载入外部版本
        </Button>
        {writeConflict && (
          <Button onClick={onSaveDraftCopy} disabled={saving}>
            另存为副本
          </Button>
        )}
        <Button onClick={onDismiss} disabled={saving}>
          继续编辑
        </Button>
      </div>
    </div>
  );
}

function rowStyle(type: DiffRow["type"]): CSSProperties {
  const base: CSSProperties = {
    display: "flex",
    gap: "var(--space-2)",
    padding: "0 var(--space-2)",
    whiteSpace: "pre",
    lineHeight: 1.5,
  };
  if (type === "added") {
    return {
      ...base,
      background: "color-mix(in srgb, var(--status-ok) 16%, transparent)",
      color: "var(--status-ok-text)",
    };
  }
  if (type === "removed") {
    return {
      ...base,
      background: "color-mix(in srgb, var(--status-error) 16%, transparent)",
      color: "var(--status-error-text)",
    };
  }
  return { ...base, color: "var(--text-secondary)" };
}

const panelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
  padding: "var(--space-3) var(--space-4)",
  borderBottom: "1px solid var(--border-warn)",
  background: "var(--bg-panel)",
  flexShrink: 0,
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "var(--space-3)",
  flexWrap: "wrap",
};

const titleStyle: CSSProperties = {
  fontSize: "var(--text-md)",
  fontWeight: 600,
  color: "var(--status-warn-text)",
};

const summaryStyle: CSSProperties = {
  fontSize: "var(--text-sm)",
  color: "var(--text-muted)",
};

const legendStyle: CSSProperties = {
  display: "flex",
  gap: "var(--space-4)",
  fontSize: "var(--text-xs)",
};

const removedLegendStyle: CSSProperties = {
  color: "var(--status-error-text)",
};

const addedLegendStyle: CSSProperties = {
  color: "var(--status-ok-text)",
};

const bodyStyle: CSSProperties = {
  maxHeight: 240,
  overflow: "auto",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-sm)",
  background: "var(--bg-inset)",
  fontFamily: "var(--font-mono, monospace)",
  fontSize: "var(--text-sm)",
  padding: "var(--space-1) 0",
};

const markerStyle: CSSProperties = {
  flexShrink: 0,
  width: "1em",
  textAlign: "center",
  userSelect: "none",
};

const placeholderStyle: CSSProperties = {
  padding: "var(--space-4)",
  fontSize: "var(--text-sm)",
  color: "var(--text-muted)",
  border: "1px dashed var(--border)",
  borderRadius: "var(--radius-sm)",
};

const actionsStyle: CSSProperties = {
  display: "flex",
  gap: "var(--space-2)",
};
