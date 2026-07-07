import type { CSSProperties, ReactNode } from "react";
import type { NodeEditorMode } from "./nodeEditorModel";
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
  onLoadExternal,
  onSaveDraftCopy,
  onSave,
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
  onLoadExternal: () => void;
  onSaveDraftCopy: () => void;
  onSave: () => void;
}) {
  return (
    <div style={toolbarStyle}>
      <div style={titleGroupStyle}>
        <div style={titleStyle}>{title}</div>
        <div style={metaStyle}>{file}</div>
      </div>
      <div style={toolbarSpacerStyle} />
      <button type="button" onClick={() => onModeToggle("scenario")} style={toggleButtonStyle}>剧本</button>
      <button type="button" onClick={() => onModeToggle("json")} style={toggleButtonStyle}>JSON</button>
      {dirty && <StatusText tone="warn">未保存</StatusText>}
      {diagnosticsCount > 0 && <StatusText tone="error">剧本有 {diagnosticsCount} 个问题</StatusText>}
      {hasExternalUpdate && !writeConflict && (
        <button type="button" onClick={onLoadExternal} style={loadButtonStyle}>
          外部已更新，点击载入
        </button>
      )}
      {writeConflict && (
        <>
          <button type="button" onClick={onLoadExternal} style={loadButtonStyle}>
            载入外部版本
          </button>
          <button type="button" onClick={onSaveDraftCopy} disabled={saving} style={loadButtonStyle}>
            另存为副本
          </button>
        </>
      )}
      {status && (
        <StatusText tone={status.includes("失败") || status.includes("问题") ? "error" : "ok"}>
          {status}
        </StatusText>
      )}
      {draftCopyPath && <span style={statusTextStyle}>{draftCopyPath}</span>}
      <button type="button" onClick={onSave} disabled={saving || !canSave} style={saveButtonStyle}>
        {saving ? "保存中…" : "保存"}
      </button>
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

const toggleButtonStyle: CSSProperties = {
  padding: "var(--space-2) var(--space-2)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-input)",
  background: "var(--bg-panel)",
  color: "var(--text-secondary)",
  cursor: "pointer",
  fontSize: "var(--text-sm)",
};

const loadButtonStyle: CSSProperties = {
  ...toggleButtonStyle,
  color: "var(--status-warn-text)",
  borderColor: "var(--status-warn)",
};

const saveButtonStyle: CSSProperties = {
  padding: "var(--space-2) var(--space-4)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--accent)",
  background: "var(--accent)",
  color: "var(--text-on-accent)",
  cursor: "pointer",
  fontSize: "var(--text-base)",
  flexShrink: 0,
};
