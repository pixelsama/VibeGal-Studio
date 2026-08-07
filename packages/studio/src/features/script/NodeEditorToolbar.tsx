import type { CSSProperties, ReactNode } from "react";
import { Button } from "../common/Button";
import type { NodeEditorMode } from "./nodeEditorModel";
import type { StatusMessage } from "./statusMessage";
import {
  translateZhCN,
  type StudioTranslator,
} from "../../lib/i18n";

export function NodeEditorToolbar({
  title,
  file,
  dirty,
  diagnosticsCount,
  hasExternalUpdate,
  writeConflict,
  saving,
  canSave,
  status,
  mode,
  onModeToggle,
  onOpenExternalDiff,
  onCopyConflict,
  onSave,
  t = translateZhCN,
}: {
  title: string;
  file: string;
  dirty: boolean;
  diagnosticsCount: number;
  hasExternalUpdate: boolean;
  writeConflict: boolean;
  saving: boolean;
  canSave: boolean;
  status: StatusMessage | null;
  mode: NodeEditorMode;
  onModeToggle: (mode: NodeEditorMode) => void;
  onOpenExternalDiff: () => void;
  onCopyConflict: () => void;
  onSave: () => void;
  t?: StudioTranslator;
}) {
  return (
    <div style={toolbarStyle}>
      <div style={titleGroupStyle}>
        <div style={titleStyle}>{title}</div>
        <div style={metaStyle}>{file}</div>
      </div>
      <div style={toolbarSpacerStyle} />
      <Button onClick={() => onModeToggle("scenario")} disabled={saving} aria-pressed={mode === "scenario"} style={{ ...modeButtonStyle, ...(mode === "scenario" ? modeActiveStyle : null) }}>{t("script.editor.mode.scenario")}</Button>
      <Button onClick={() => onModeToggle("json")} disabled={saving} aria-pressed={mode === "json"} style={{ ...modeButtonStyle, ...(mode === "json" ? modeActiveStyle : null) }}>{t("script.editor.mode.json")}</Button>
      {dirty && <StatusText tone="warn">{t("script.editor.unsaved")}</StatusText>}
      {diagnosticsCount > 0 && <StatusText tone="error">{t("script.editor.problems", { count: diagnosticsCount })}</StatusText>}
      {hasExternalUpdate && !writeConflict && (
        <Button onClick={onOpenExternalDiff} disabled={saving} style={warnButtonStyle}>
          {t("script.editor.externalUpdated")}
        </Button>
      )}
      {writeConflict && (
        <>
          <Button onClick={onOpenExternalDiff} disabled={saving} style={warnButtonStyle}>
            {t("script.editor.conflictDiff")}
          </Button>
          <Button onClick={onCopyConflict} disabled={saving} style={warnButtonStyle}>
            {t("script.editor.copyConflict")}
          </Button>
        </>
      )}
      {status && (
        <StatusText tone={status.severity}>
          {status.message}
        </StatusText>
      )}
      <Button
        variant="primary"
        onClick={onSave}
        disabled={saving || !canSave || hasExternalUpdate || writeConflict}
        style={saveButtonStyle}
      >
        {saving ? t("script.editor.saving") : t("script.editor.save")}
      </Button>
    </div>
  );
}

function StatusText({ tone, children }: { tone: "warn" | "error" | "ok" | "info"; children: ReactNode }) {
  const color = tone === "warn"
    ? "var(--status-warn-text)"
    : tone === "error"
      ? "var(--status-error-text)"
      : tone === "info"
        ? "var(--text-secondary)"
        : "var(--status-ok-text)";
  return <span style={{ ...statusTextStyle, color }}>{children}</span>;
}

const toolbarStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "var(--space-3)",
  padding: "var(--space-2) var(--space-4)",
  borderBottom: "1px solid var(--border)",
  background: "var(--bg-app)",
};

const titleGroupStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-1)",
  minWidth: 0,
  overflow: "hidden",
};

const titleStyle: CSSProperties = {
  fontSize: "var(--text-md)",
  fontWeight: 600,
  color: "var(--text-bright)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const metaStyle: CSSProperties = {
  fontSize: "var(--text-sm)",
  color: "var(--text-muted)",
  wordBreak: "break-all",
};

const toolbarSpacerStyle: CSSProperties = {
  flex: 1,
};

const statusTextStyle: CSSProperties = {
  fontSize: "var(--text-sm)",
};

/* 按钮颜色/悬停/禁用统一走 .gs-btn；这里只覆盖字号等布局差异。 */
const modeButtonStyle: CSSProperties = {
  fontSize: "var(--text-sm)",
  color: "var(--text-secondary)",
  padding: "var(--space-2)",
};

/* 激活的模式按钮：accent 色字 + 下边框，与 .gs-tab--active 节奏一致。 */
const modeActiveStyle: CSSProperties = {
  color: "var(--accent-bright)",
  borderColor: "var(--accent)",
};

const warnButtonStyle: CSSProperties = {
  fontSize: "var(--text-sm)",
  color: "var(--status-warn-text)",
  borderColor: "var(--status-warn)",
};

const saveButtonStyle: CSSProperties = {
  padding: "var(--space-2) var(--space-4)",
  flexShrink: 0,
};
