import type { CSSProperties } from "react";
import { Button } from "../common/Button";
import { summarizeDiff, type DiffRow } from "./externalDiff";
import {
  useStudioI18n,
  type StudioMessageKey,
} from "../../lib/i18n";

export interface ExternalConflictSummary {
  base: string;
  local: string;
  external: string;
  externalState: "present" | "deleted" | "renamed";
  burstCount?: number;
}

/**
 * 外部更新/写入冲突的确认面板：展示 base/local/external 三方摘要和
 * 当前草稿 vs 外部版本的行级 diff，再让用户明确选择安全解决动作。
 */
export function ExternalDiffPanel({
  writeConflict,
  loading,
  error,
  rows,
  summary,
  saving,
  onLoadExternal,
  onKeepLocal,
  onCopyConflict,
  onRetry,
}: {
  writeConflict: boolean;
  loading: boolean;
  error?: string | null;
  rows: DiffRow[] | null;
  summary: ExternalConflictSummary;
  saving: boolean;
  onLoadExternal: () => void;
  onKeepLocal: () => void;
  onCopyConflict: () => void;
  onRetry: () => void;
}) {
  const { t } = useStudioI18n();
  const diffSummary = rows ? summarizeDiff(rows) : null;
  return (
    <div data-region="external-diff-panel" style={panelStyle}>
      <div style={headerStyle}>
        <div style={titleStyle}>
          {writeConflict ? t("script.externalDiff.conflictTitle") : t("script.externalDiff.updateTitle")}
        </div>
        <div style={summaryStyle}>
          {loading
            ? t("script.externalDiff.fetching")
            : error
              ? t("script.externalDiff.fetchFailed", { detail: error })
              : diffSummary && (diffSummary.added > 0 || diffSummary.removed > 0)
                ? t("script.externalDiff.summary", {
                  added: diffSummary.added,
                  removed: diffSummary.removed,
                })
                : t("script.externalDiff.revisionOnly")}
        </div>
      </div>
      <div data-region="external-conflict-summary" style={threeWaySummaryStyle}>
        <ConflictSummaryItem label={t("script.externalDiff.base")} value={summary.base} />
        <ConflictSummaryItem label={t("script.externalDiff.localDraft")} value={summary.local} />
        <ConflictSummaryItem
          label={t("script.externalDiff.externalVersion")}
          value={summary.external}
          state={t(externalStateMessageKey(summary.externalState))}
        />
        {(summary.burstCount ?? 0) > 1 && (
          <ConflictSummaryItem
            label={t("script.externalDiff.watcherBurst")}
            value={t("script.externalDiff.watcherBurstCount", { count: summary.burstCount ?? 0 })}
          />
        )}
      </div>
      {loading ? (
        <div style={placeholderStyle}>{t("script.externalDiff.fetchingHint")}</div>
      ) : error ? (
        <div role="alert" style={errorStyle}>{t("script.externalDiff.fetchFailed", { detail: error })}</div>
      ) : (
        <>
          <div style={legendStyle}>
            <span style={removedLegendStyle}>{t("script.externalDiff.localDraft")}</span>
            <span style={addedLegendStyle}>{t("script.externalDiff.externalVersion")}</span>
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
        <Button
          variant="primary"
          onClick={onLoadExternal}
          disabled={saving || loading || Boolean(error) || summary.externalState !== "present"}
        >
          {t("script.externalDiff.loadExternal")}
        </Button>
        <Button
          onClick={onKeepLocal}
          disabled={saving || loading || Boolean(error)}
        >
          {t("script.externalDiff.keepLocal")}
        </Button>
        <Button
          onClick={onCopyConflict}
          disabled={saving || loading || (!rows && !error)}
        >
          {t("script.externalDiff.copyConflict")}
        </Button>
        {error && (
          <Button onClick={onRetry} disabled={saving || loading}>
            {t("script.externalDiff.retry")}
          </Button>
        )}
      </div>
    </div>
  );
}

function externalStateMessageKey(
  state: ExternalConflictSummary["externalState"],
): StudioMessageKey {
  if (state === "deleted") return "script.externalDiff.state.deleted";
  if (state === "renamed") return "script.externalDiff.state.renamed";
  return "script.externalDiff.state.present";
}

function ConflictSummaryItem({
  label,
  value,
  state,
}: {
  label: string;
  value: string;
  state?: string;
}) {
  return (
    <div style={summaryItemStyle}>
      <span style={summaryLabelStyle}>{label}</span>
      <span style={summaryValueStyle}>{state ? `${state} · ${value}` : value}</span>
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

const threeWaySummaryStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "var(--space-2)",
};

const summaryItemStyle: CSSProperties = {
  display: "grid",
  gap: "var(--space-1)",
  padding: "var(--space-2)",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-sm)",
  background: "var(--bg-inset)",
  minWidth: 0,
};

const summaryLabelStyle: CSSProperties = {
  color: "var(--text-muted)",
  fontSize: "var(--text-xs)",
};

const summaryValueStyle: CSSProperties = {
  color: "var(--text-secondary)",
  fontFamily: "var(--font-mono, monospace)",
  fontSize: "var(--text-xs)",
  overflowWrap: "anywhere",
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

const errorStyle: CSSProperties = {
  ...placeholderStyle,
  color: "var(--status-error-text)",
  borderColor: "var(--status-error)",
};

const actionsStyle: CSSProperties = {
  display: "flex",
  gap: "var(--space-2)",
};
