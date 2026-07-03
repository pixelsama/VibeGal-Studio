import { useEffect, useRef, useState } from "react";

/**
 * 自绘确认弹窗，替换 window.confirm。
 *
 * 用法：
 *   const [confirm, setConfirm] = useState<null | { message; onConfirm }>(null);
 *   setConfirm({ message: "确定删除？", onConfirm: () => doDelete() });
 *   {confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}
 */
interface ConfirmDialogProps {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  message,
  confirmLabel = "确定",
  cancelLabel = "取消",
  danger = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Enter") {
        onConfirm();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose, onConfirm]);

  return (
    <Overlay onClose={onClose}>
      <div role="alertdialog" style={dialogStyle}>
        <div style={dialogMessageStyle}>{message}</div>
        <div style={dialogActionsStyle}>
          <button type="button" onClick={onClose} style={cancelBtnStyle}>
            {cancelLabel}
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => {
              onConfirm();
              onClose();
            }}
            style={danger ? dangerBtnStyle : confirmBtnStyle}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/**
 * 自绘输入弹窗（用于重命名节点等）。替换 prompt()。
 *
 * 提供受控 input + 默认值 + 预填选中，Enter 确认 / Esc 取消。
 * 空值不允许提交（提交按钮禁用）。
 */
interface PromptDialogProps {
  title: string;
  label?: string;
  initialValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: (value: string) => void;
  onClose: () => void;
}

export function PromptDialog({
  title,
  label,
  initialValue = "",
  confirmLabel = "确定",
  cancelLabel = "取消",
  onConfirm,
  onClose,
}: PromptDialogProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0 && trimmed !== initialValue.trim();

  return (
    <Overlay onClose={onClose}>
      <div role="dialog" style={dialogStyle}>
        <div style={dialogTitleStyle}>{title}</div>
        {label && <label style={dialogLabelStyle}>{label}</label>}
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && canSubmit) {
              onConfirm(trimmed);
              onClose();
            }
            if (event.key === "Escape") onClose();
          }}
          style={promptInputStyle}
        />
        <div style={dialogActionsStyle}>
          <button type="button" onClick={onClose} style={cancelBtnStyle}>
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => {
              onConfirm(trimmed);
              onClose();
            }}
            style={canSubmit ? confirmBtnStyle : { ...confirmBtnStyle, opacity: 0.4, cursor: "not-allowed" }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/** 全屏遮罩：点击遮罩空白处关闭，但不拦截对话框内部点击。 */
function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      style={overlayStyle}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {children}
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1100,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(0, 0, 0, 0.5)",
};

const dialogStyle: React.CSSProperties = {
  minWidth: 340,
  maxWidth: 440,
  padding: 20,
  background: "#141922",
  border: "1px solid #2f394a",
  borderRadius: 12,
  boxShadow: "0 16px 40px rgba(0, 0, 0, 0.6)",
};

const dialogTitleStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  color: "#e8edf5",
  marginBottom: 14,
};

const dialogMessageStyle: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1.6,
  color: "#d4dae2",
  marginBottom: 18,
};

const dialogLabelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  color: "#7a8290",
  marginBottom: 6,
};

const promptInputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "9px 11px",
  borderRadius: 8,
  border: "1px solid #2f394a",
  background: "#0b0e14",
  color: "#e8edf5",
  fontSize: 14,
  outline: "none",
  marginBottom: 18,
};

const dialogActionsStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
};

const cancelBtnStyle: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 8,
  border: "1px solid #2a3242",
  background: "#1a2431",
  color: "#a0a8b4",
  cursor: "pointer",
  fontSize: 13,
};

const confirmBtnStyle: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 8,
  border: "1px solid #3a6ea5",
  background: "#3a6ea5",
  color: "#fff",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};

const dangerBtnStyle: React.CSSProperties = {
  ...confirmBtnStyle,
  border: "1px solid #a04848",
  background: "#a04848",
};
