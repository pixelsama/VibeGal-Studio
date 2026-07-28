import type { CSSProperties, ReactNode } from "react";
import { Button } from "../common/Button";
import type { NodeEditorMode } from "./nodeEditorModel";
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
  draftCopyPath,
  onModeToggle,
  onOpenExternalDiff,
  onSaveDraftCopy,
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
  status: string;
  draftCopyPath: string | null;
  onModeToggle: (mode: NodeEditorMode) => void;
  onOpenExternalDiff: () => void;
  onSaveDraftCopy: () => void;
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
      <Button onClick={() => onModeToggle("scenario")} disabled={saving} style={modeButtonStyle}>{t("script.editor.mode.scenario")}</Button>
      <Button onClick={() => onModeToggle("json")} disabled={saving} style={modeButtonStyle}>{t("script.editor.mode.json")}</Button>
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
          <Button onClick={onSaveDraftCopy} disabled={saving} style={warnButtonStyle}>
            {t("script.editor.saveCopy")}
          </Button>
        </>
      )}
      {status && (
        <StatusText tone={/失败|问题|failed?|problem/i.test(status) ? "error" : "ok"}>
          {status}
        </StatusText>
      )}
      {draftCopyPath && <span style={statusTextStyle}>{draftCopyPath}</span>}
      <Button variant="primary" onClick={onSave} disabled={saving || !canSave} style={saveButtonStyle}>
        {saving ? t("script.editor.saving") : t("script.editor.save")}
      </Button>
    </div>
  );
}

function StatusText({ tone, children }: { tone: "warn" | "error" | "ok"; children: ReactNode }) {
  const color = tone === "warn"
    ? "var(--status-warn-text)"
    : tone === "error"
      ? "var(--status-error-text)"
      : "var(--status-ok-text)";
  return <span style={{ ...statusTextStyle, color }}>{children}</span>;
}

const toolbarStyle: CSSProperties = {
  display: "flex",
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
};

const titleStyle: CSSProperties = {
  fontSize: "var(--text-md)",
  fontWeight: 600,
  color: "var(--text-bright)",
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

const warnButtonStyle: CSSProperties = {
  fontSize: "var(--text-sm)",
  color: "var(--status-warn-text)",
  borderColor: "var(--status-warn)",
};

const saveButtonStyle: CSSProperties = {
  padding: "var(--space-2) var(--space-4)",
  flexShrink: 0,
};
