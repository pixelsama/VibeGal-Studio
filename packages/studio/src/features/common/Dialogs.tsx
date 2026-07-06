import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "./Button";

type DialogGlobalKeyAction = "close" | "none";
type DialogTabTrapTarget = { type: "container" } | { type: "focusable"; index: number } | { type: "none" };

export function dialogGlobalKeyAction(key: string): DialogGlobalKeyAction {
  return key === "Escape" ? "close" : "none";
}

export function dialogTabTrapTarget(
  focusableCount: number,
  currentIndex: number,
  shiftKey: boolean,
): DialogTabTrapTarget {
  if (focusableCount <= 0) return { type: "container" };
  if (focusableCount === 1) return { type: "focusable", index: 0 };
  if (currentIndex < 0) return { type: "focusable", index: shiftKey ? focusableCount - 1 : 0 };
  if (shiftKey && currentIndex === 0) return { type: "focusable", index: focusableCount - 1 };
  if (!shiftKey && currentIndex === focusableCount - 1) return { type: "focusable", index: 0 };
  return { type: "none" };
}

/**
 * 自绘模态弹窗，替换原生 window.confirm / prompt / alert。
 *
 * 三种：
 *   - ConfirmDialog：确认 / 取消（可标 danger）
 *   - PromptDialog：单行输入（重命名、新建 id 等）
 *   - AlertDialog：单按钮提示（错误 / 通知）
 *
 * 全部支持 Esc 关闭、遮罩空白处点击关闭；Enter 交给当前聚焦控件的原生行为处理。
 */
interface ConfirmDialogProps {
  message: ReactNode;
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
  return (
    <Overlay onClose={onClose}>
      <DialogSurface role="alertdialog" onClose={onClose}>
        <div style={dialogMessageStyle}>{message}</div>
        <div style={dialogActionsStyle}>
          <Button variant="secondary" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            autoFocus
            data-dialog-initial-focus="true"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogSurface>
    </Overlay>
  );
}

/**
 * 单行输入弹窗（重命名节点、新建/复制渲染层等）。替换 prompt()。
 *
 * 提供受控 input + 默认值 + 预填选中，Enter 确认 / Esc 取消。
 * 默认要求「非空且不同于初值」才能提交（适合重命名）；
 * allowUnchanged 为 true 时只要非空即可提交（适合预填了合理默认值的新建/复制）。
 */
interface PromptDialogProps {
  title: string;
  label?: string;
  initialValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 允许提交与初值相同的值（默认 false）。 */
  allowUnchanged?: boolean;
  onConfirm: (value: string) => void;
  onClose: () => void;
}

export function PromptDialog({
  title,
  label,
  initialValue = "",
  confirmLabel = "确定",
  cancelLabel = "取消",
  allowUnchanged = false,
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
  const canSubmit = trimmed.length > 0 && (allowUnchanged || trimmed !== initialValue.trim());

  return (
    <Overlay onClose={onClose}>
      <DialogSurface role="dialog" onClose={onClose}>
        <div style={dialogTitleStyle}>{title}</div>
        {label && <label style={dialogLabelStyle}>{label}</label>}
        <input
          ref={inputRef}
          value={value}
          data-dialog-initial-focus="true"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && canSubmit) {
              onConfirm(trimmed);
              onClose();
            }
          }}
          style={promptInputStyle}
        />
        <div style={dialogActionsStyle}>
          <Button variant="secondary" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button
            variant="primary"
            disabled={!canSubmit}
            onClick={() => {
              onConfirm(trimmed);
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogSurface>
    </Overlay>
  );
}

/**
 * 单按钮提示弹窗，替换 window.alert。用于展示错误或一次性通知。
 */
interface AlertDialogProps {
  message: ReactNode;
  title?: string;
  confirmLabel?: string;
  danger?: boolean;
  onClose: () => void;
}

export function AlertDialog({ message, title, confirmLabel = "知道了", danger = false, onClose }: AlertDialogProps) {
  return (
    <Overlay onClose={onClose}>
      <DialogSurface role="alertdialog" onClose={onClose}>
        {title && <div style={dialogTitleStyle}>{title}</div>}
        <div style={{ ...dialogMessageStyle, color: danger ? "var(--status-error-text)" : "var(--text-primary)" }}>
          {message}
        </div>
        <div style={dialogActionsStyle}>
          <Button variant="primary" autoFocus data-dialog-initial-focus="true" onClick={onClose}>
            {confirmLabel}
          </Button>
        </div>
      </DialogSurface>
    </Overlay>
  );
}

/** 全屏遮罩：点击遮罩空白处关闭，但不拦截对话框内部点击。 */
function Overlay({ children, onClose }: { children: ReactNode; onClose: () => void }) {
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

function DialogSurface({
  children,
  onClose,
  role,
}: {
  children: ReactNode;
  onClose: () => void;
  role: "alertdialog" | "dialog";
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(getActiveElement());

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.contains(document.activeElement)) return;
    focusElement(getInitialFocusElement(dialog) ?? dialog);
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (dialogGlobalKeyAction(event.key) !== "close") return;
      event.preventDefault();
      onClose();
    };

    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  useEffect(() => {
    return () => {
      const previousFocus = previousFocusRef.current;
      if (previousFocus?.isConnected) focusElement(previousFocus);
    };
  }, []);

  return (
    <div
      ref={dialogRef}
      role={role}
      aria-modal="true"
      tabIndex={-1}
      style={dialogStyle}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;

        const focusableElements = getFocusableDialogElements(event.currentTarget);
        const activeElement = getActiveElement();
        const currentIndex = activeElement ? focusableElements.indexOf(activeElement) : -1;
        const target = dialogTabTrapTarget(focusableElements.length, currentIndex, event.shiftKey);

        if (target.type === "none") return;
        event.preventDefault();

        if (target.type === "container") {
          focusElement(event.currentTarget);
          return;
        }

        const targetElement = focusableElements[target.index];
        if (targetElement) focusElement(targetElement);
      }}
    >
      {children}
    </div>
  );
}

const focusableDialogSelector = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function getActiveElement(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

function getFocusableDialogElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(focusableDialogSelector)).filter(isElementFocusable);
}

function getInitialFocusElement(dialog: HTMLElement): HTMLElement | null {
  const focusableElements = getFocusableDialogElements(dialog);
  const requestedElement = dialog.querySelector<HTMLElement>("[data-dialog-initial-focus='true']");
  if (requestedElement && focusableElements.includes(requestedElement)) return requestedElement;
  return focusableElements[0] ?? null;
}

function isElementFocusable(element: HTMLElement): boolean {
  if (element.tabIndex < 0) return false;
  if (element.getAttribute("aria-hidden") === "true") return false;

  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function focusElement(element: HTMLElement) {
  element.focus({ preventScroll: true });
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1100,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "var(--overlay)",
};

const dialogStyle: React.CSSProperties = {
  minWidth: 340,
  maxWidth: 440,
  padding: 20,
  background: "var(--bg-panel)",
  border: "1px solid var(--border-input)",
  borderRadius: 12,
  boxShadow: "0 16px 40px var(--overlay-strong)",
};

const dialogTitleStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  color: "var(--text-bright)",
  marginBottom: 14,
};

const dialogMessageStyle: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1.6,
  color: "var(--text-primary)",
  marginBottom: 18,
};

const dialogLabelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  color: "var(--text-muted)",
  marginBottom: 6,
};

const promptInputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "9px 11px",
  borderRadius: 8,
  border: "1px solid var(--border-input)",
  background: "var(--bg-inset)",
  color: "var(--text-bright)",
  fontSize: 14,
  outline: "none",
  marginBottom: 18,
};

const dialogActionsStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
};
