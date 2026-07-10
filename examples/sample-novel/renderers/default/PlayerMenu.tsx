import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { PLAYER_MENU_PAGES, type PlayerMenuPage } from "./playerUiModel";

export interface PlayerNotice {
  tone: "success" | "warning" | "error";
  message: string;
  code?: string;
}

interface PlayerMenuProps {
  page: PlayerMenuPage;
  busy: boolean;
  notice: PlayerNotice | null;
  onPageChange: (page: PlayerMenuPage) => void;
  onClose: () => void;
  children: ReactNode;
}

export function PlayerMenu({ page, busy, notice, onPageChange, onClose, children }: PlayerMenuProps) {
  const stop = (event: MouseEvent) => event.stopPropagation();
  return (
    <div
      data-vibegal-modal="true"
      data-player-menu={page}
      role="dialog"
      aria-modal="true"
      aria-label="玩家菜单"
      onClick={stop}
      style={overlayStyle}
    >
      <section style={menuStyle}>
        <header style={headerStyle}>
          <nav aria-label="玩家菜单页面" style={tabsStyle}>
            {PLAYER_MENU_PAGES.map((item) => (
              <button
                key={item.id}
                type="button"
                data-menu-page={item.id}
                aria-current={page === item.id ? "page" : undefined}
                disabled={busy}
                onClick={() => onPageChange(item.id)}
                style={tabStyle(page === item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <button
            type="button"
            aria-label="关闭玩家菜单"
            title="关闭"
            disabled={busy}
            onClick={onClose}
            style={closeButtonStyle}
          >
            ×
          </button>
        </header>

        {notice && (
          <div role={notice.tone === "error" ? "alert" : "status"} style={noticeStyle(notice.tone)}>
            {notice.code && <code style={codeStyle}>{notice.code}</code>}
            <span>{notice.message}</span>
          </div>
        )}

        <div style={bodyStyle}>{children}</div>
      </section>
      <style>{responsiveCss}</style>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  destructive = false,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      data-vibegal-confirm="true"
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => event.stopPropagation()}
      style={confirmOverlayStyle}
    >
      <section style={confirmStyle}>
        <h2 style={confirmTitleStyle}>{title}</h2>
        <p style={confirmMessageStyle}>{message}</p>
        <div style={confirmActionsStyle}>
          <button type="button" disabled={busy} onClick={onCancel} style={secondaryButtonStyle}>
            取消
          </button>
          <button type="button" data-confirm-action="confirm" autoFocus disabled={busy} onClick={onConfirm} style={commandButtonStyle(destructive)}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

export function SystemPanel({ busy, onReturn, onRestart }: { busy: boolean; onReturn: () => void; onRestart: () => void }) {
  return (
    <div style={systemStyle}>
      <div>
        <h2 style={sectionTitleStyle}>系统</h2>
      </div>
      <div style={systemActionsStyle}>
        <button type="button" disabled={busy} onClick={onReturn} style={primaryButtonStyle}>
          返回游戏
        </button>
        <button type="button" disabled={busy} onClick={onRestart} style={dangerButtonStyle}>
          重新开始
        </button>
      </div>
    </div>
  );
}

const overlayStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 100,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  boxSizing: "border-box",
  background: "rgba(0, 0, 0, 0.72)",
  cursor: "default",
  containerType: "size",
};

const menuStyle: CSSProperties = {
  width: "min(1080px, 100%)",
  height: "min(640px, 100%)",
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "auto auto minmax(0, 1fr)",
  overflow: "hidden",
  border: "1px solid rgba(255, 255, 255, 0.22)",
  borderRadius: 6,
  background: "rgba(20, 21, 23, 0.97)",
  color: "#f4f4f2",
  boxShadow: "0 22px 70px rgba(0, 0, 0, 0.55)",
  fontFamily: "system-ui, sans-serif",
  letterSpacing: 0,
};

const headerStyle: CSSProperties = {
  minHeight: 54,
  display: "flex",
  alignItems: "stretch",
  justifyContent: "space-between",
  gap: 12,
  padding: "0 12px",
  borderBottom: "1px solid rgba(255, 255, 255, 0.13)",
};

const tabsStyle: CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "stretch",
  overflowX: "auto",
};

function tabStyle(active: boolean): CSSProperties {
  return {
    minWidth: 116,
    padding: "0 16px",
    border: 0,
    borderBottom: active ? "3px solid #76d8c7" : "3px solid transparent",
    background: active ? "rgba(118, 216, 199, 0.1)" : "transparent",
    color: active ? "#d9fff8" : "rgba(255, 255, 255, 0.68)",
    font: "600 14px/1 system-ui, sans-serif",
    letterSpacing: 0,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}

const closeButtonStyle: CSSProperties = {
  width: 42,
  height: 42,
  alignSelf: "center",
  flex: "0 0 42px",
  border: "1px solid rgba(255, 255, 255, 0.18)",
  borderRadius: 4,
  background: "transparent",
  color: "#fff",
  font: "300 28px/1 system-ui, sans-serif",
  cursor: "pointer",
};

const bodyStyle: CSSProperties = {
  minHeight: 0,
  overflow: "auto",
  padding: 18,
  overscrollBehavior: "contain",
};

function noticeStyle(tone: PlayerNotice["tone"]): CSSProperties {
  const colors = tone === "error"
    ? { border: "#e58282", background: "rgba(123, 37, 37, 0.32)" }
    : tone === "warning"
      ? { border: "#e2b764", background: "rgba(112, 77, 20, 0.28)" }
      : { border: "#6ecab8", background: "rgba(28, 98, 86, 0.27)" };
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "9px 18px",
    borderBottom: `1px solid ${colors.border}`,
    background: colors.background,
    color: "#fff",
    fontSize: 13,
  };
}

const codeStyle: CSSProperties = {
  padding: "2px 5px",
  borderRadius: 3,
  background: "rgba(0, 0, 0, 0.28)",
  fontSize: 11,
  whiteSpace: "nowrap",
};

const confirmOverlayStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 130,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  background: "rgba(0, 0, 0, 0.68)",
};

const confirmStyle: CSSProperties = {
  width: "min(440px, 100%)",
  border: "1px solid rgba(255, 255, 255, 0.26)",
  borderRadius: 6,
  padding: 22,
  background: "#202123",
  color: "#fff",
  boxShadow: "0 18px 60px rgba(0, 0, 0, 0.6)",
};

const confirmTitleStyle: CSSProperties = { margin: 0, fontSize: 20, lineHeight: 1.3, letterSpacing: 0 };
const confirmMessageStyle: CSSProperties = { margin: "12px 0 20px", color: "rgba(255, 255, 255, 0.72)", fontSize: 14, lineHeight: 1.6 };
const confirmActionsStyle: CSSProperties = { display: "flex", justifyContent: "flex-end", gap: 10 };

const baseCommandStyle: CSSProperties = {
  minHeight: 38,
  borderRadius: 4,
  padding: "8px 16px",
  color: "#fff",
  font: "600 13px/1 system-ui, sans-serif",
  cursor: "pointer",
};

const secondaryButtonStyle: CSSProperties = {
  ...baseCommandStyle,
  border: "1px solid rgba(255, 255, 255, 0.24)",
  background: "transparent",
};

function commandButtonStyle(destructive: boolean): CSSProperties {
  return destructive ? dangerButtonStyle : primaryButtonStyle;
}

const primaryButtonStyle: CSSProperties = {
  ...baseCommandStyle,
  border: "1px solid #77d7c5",
  background: "#236f63",
};

const dangerButtonStyle: CSSProperties = {
  ...baseCommandStyle,
  border: "1px solid #e58c8c",
  background: "#783b3b",
};

const systemStyle: CSSProperties = {
  minHeight: "100%",
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
  gap: 32,
};
const systemActionsStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 10 };
const sectionTitleStyle: CSSProperties = { margin: 0, fontSize: 20, letterSpacing: 0 };

const responsiveCss = `
@container (max-height: 600px) {
  [data-player-menu] { padding: 12px !important; }
  [data-player-menu] > section { height: 100% !important; }
}
@container (max-width: 760px) {
  [data-player-menu] { padding: 10px !important; }
  [data-player-menu] [data-menu-page] { min-width: 96px !important; padding: 0 10px !important; }
}
`;
