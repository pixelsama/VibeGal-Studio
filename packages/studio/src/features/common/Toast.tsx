import { useEffect } from "react";
import { X } from "lucide-react";

export type ToastKind = "success" | "error" | "info";

export interface ToastInput {
  kind: ToastKind;
  message: string;
  detail?: string;
  /**
   * false = stay until dismissed. Undefined keeps errors sticky and lets
   * success/info messages disappear after the default delay.
   */
  autoDismissMs?: number | false;
}

export interface ToastMessage extends ToastInput {
  id: number;
}

interface ToastProps {
  toast: ToastMessage | null;
  onClose: () => void;
}

export function Toast({ toast, onClose }: ToastProps) {
  useEffect(() => {
    if (!toast) return;
    const delay = toast.autoDismissMs ?? (toast.kind === "error" ? false : 4200);
    if (delay === false) return;
    const timer = window.setTimeout(onClose, delay);
    return () => window.clearTimeout(timer);
  }, [toast, onClose]);

  if (!toast) return null;

  const tone = toneForKind(toast.kind);
  const role = toast.kind === "error" ? "alert" : "status";

  return (
    <div
      role={role}
      aria-live={toast.kind === "error" ? "assertive" : "polite"}
      className="gs-anim-toast"
      style={{
        ...toastStyle,
        borderColor: tone.border,
        background: tone.background,
      }}
    >
      <div style={accentStyle(tone.accent)} />
      <div style={contentStyle}>
        <div style={{ ...messageStyle, color: tone.text }}>{toast.message}</div>
        {toast.detail && <div style={detailStyle}>{toast.detail}</div>}
      </div>
      <button type="button" aria-label="关闭消息" onClick={onClose} className="gs-chip-btn" style={closeLayoutStyle}>
        <X size={13} />
      </button>
    </div>
  );
}

function toneForKind(kind: ToastKind): {
  accent: string;
  background: string;
  border: string;
  text: string;
} {
  switch (kind) {
    case "success":
      return {
        accent: "var(--status-ok)",
        background: "var(--bg-panel)",
        border: "var(--border-ok)",
        text: "var(--status-ok-text)",
      };
    case "error":
      return {
        accent: "var(--status-error)",
        background: "var(--bg-error-soft)",
        border: "var(--border-error)",
        text: "var(--status-error-text)",
      };
    case "info":
      return {
        accent: "var(--accent)",
        background: "var(--bg-panel)",
        border: "var(--border-input)",
        text: "var(--text-bright)",
      };
  }
}

const toastStyle: React.CSSProperties = {
  position: "absolute",
  right: 16,
  bottom: 16,
  zIndex: 80,
  display: "grid",
  gridTemplateColumns: "4px minmax(0, 1fr) auto",
  alignItems: "stretch",
  width: "min(420px, calc(100% - 32px))",
  minHeight: 48,
  overflow: "hidden",
  border: "1px solid var(--border-input)",
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--shadow-pop)",
};

function accentStyle(background: string): React.CSSProperties {
  return { background };
}

const contentStyle: React.CSSProperties = {
  minWidth: 0,
  padding: "var(--space-2) var(--space-3)",
};

const messageStyle: React.CSSProperties = {
  fontSize: "var(--text-base)",
  fontWeight: 650,
  lineHeight: 1.35,
};

const detailStyle: React.CSSProperties = {
  marginTop: "var(--space-1)",
  color: "var(--text-secondary)",
  fontSize: "var(--text-sm)",
  lineHeight: 1.45,
  whiteSpace: "pre-line",
  wordBreak: "break-word",
};

const closeLayoutStyle: React.CSSProperties = {
  alignSelf: "start",
  margin: "var(--space-2)",
};
