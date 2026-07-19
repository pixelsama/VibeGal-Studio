import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { PLAYER_MENU_PAGES, type PlayerMenuPage } from "./playerUiModel";
import type { MenuWindowTokens } from "./useUiTokens";
import {
  dangerPillButton,
  palette,
  primaryPillButton,
  secondaryPillButton,
  solidDangerPillButton,
} from "./uiTheme";

export interface PlayerNotice {
  tone: "success" | "warning" | "error";
  message: string;
  code?: string;
}

interface PlayerMenuProps {
  page: PlayerMenuPage;
  busy: boolean;
  notice: PlayerNotice | null;
  /** 菜单窗口几何（data-ui-part="menuWindow" 的可拖拽部件，Spec 17） */
  window: MenuWindowTokens;
  onPageChange: (page: PlayerMenuPage) => void;
  onClose: () => void;
  children: ReactNode;
}

export function PlayerMenu({ page, busy, notice, window, onPageChange, onClose, children }: PlayerMenuProps) {
  const stop = (event: MouseEvent) => event.stopPropagation();
  const pageTitle = PLAYER_MENU_PAGES.find((item) => item.id === page)?.label ?? page;
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
      <section data-ui-part="menuWindow" style={menuStyle(window)}>
        {/* 左侧导航栏：纵向胶囊条目，激活 = 白底樱粉 */}
        <aside style={sidebarStyle}>
          <div style={sidebarBrandStyle}>MENU</div>
          <nav aria-label="玩家菜单页面" style={navStyle}>
            {PLAYER_MENU_PAGES.map((item) => (
              <button
                key={item.id}
                type="button"
                data-menu-page={item.id}
                aria-current={page === item.id ? "page" : undefined}
                disabled={busy}
                onClick={() => onPageChange(item.id)}
                style={navItemStyle(page === item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* 右侧内容区：标题栏 + 通知条 + 面板体 */}
        <div style={contentStyle}>
          <header style={headerStyle}>
            <h2 style={pageTitleStyle}>{pageTitle}</h2>
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
        </div>
      </section>
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
          <button type="button" disabled={busy} onClick={onCancel} style={secondaryPillButton}>
            取消
          </button>
          <button
            type="button"
            data-confirm-action="confirm"
            autoFocus
            disabled={busy}
            onClick={onConfirm}
            style={destructive ? solidDangerPillButton : primaryPillButton}
          >
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
        <p style={systemHintStyle}>返回当前剧情，或从头开始整个故事。</p>
      </div>
      <div style={systemActionsStyle}>
        <button type="button" disabled={busy} onClick={onReturn} style={primaryPillButton}>
          返回游戏
        </button>
        <button type="button" disabled={busy} onClick={onRestart} style={dangerPillButton}>
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
  background: "rgba(16, 18, 28, 0.45)",
  backdropFilter: "blur(6px)",
  WebkitBackdropFilter: "blur(6px)",
  cursor: "default",
};

export function menuStyle(window: MenuWindowTokens): CSSProperties {
  return {
    position: "absolute",
    left: window.x,
    top: window.y,
    width: window.width,
    height: window.height,
    maxWidth: `calc(100% - ${Math.max(0, window.x)}px)`,
    maxHeight: `calc(100% - ${Math.max(0, window.y)}px)`,
    // 几何 token 语义 = 部件边框盒（与 Studio 拖拽 overlay 的选框一致）
    boxSizing: "border-box",
    minHeight: 0,
    display: "grid",
    gridTemplateColumns: "184px minmax(0, 1fr)",
    overflow: "hidden",
    border: "1px solid rgba(255, 255, 255, 0.6)",
    borderRadius: 20,
    background: palette.panelWhite,
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    color: palette.ink,
    boxShadow: "0 24px 80px rgba(12, 15, 28, 0.45)",
    fontFamily: "inherit",
  };
}

const sidebarStyle: CSSProperties = {
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: "18px 12px",
  background: palette.card,
  borderRight: `1px solid ${palette.hairline}`,
};

const sidebarBrandStyle: CSSProperties = {
  padding: "0 10px 10px",
  color: palette.inkFaint,
  font: "700 11px/1 ui-monospace, monospace",
  letterSpacing: "3px",
};

const navStyle: CSSProperties = {
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  gap: 4,
  overflowY: "auto",
};

function navItemStyle(active: boolean): CSSProperties {
  return {
    display: "block",
    width: "100%",
    padding: "10px 12px",
    border: 0,
    borderRadius: 12,
    background: active ? "#fff" : "transparent",
    boxShadow: active ? "0 2px 10px rgba(24, 28, 48, 0.08)" : "none",
    color: active ? palette.accent : palette.inkSoft,
    fontWeight: active ? 700 : 500,
    fontSize: 13,
    fontFamily: "inherit",
    textAlign: "left",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}

const contentStyle: CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "auto auto minmax(0, 1fr)",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "16px 22px 12px",
  borderBottom: `1px solid ${palette.hairline}`,
};

const pageTitleStyle: CSSProperties = {
  margin: 0,
  color: palette.ink,
  fontSize: 18,
  fontWeight: 700,
  letterSpacing: "0.5px",
};

const closeButtonStyle: CSSProperties = {
  width: 34,
  height: 34,
  flex: "0 0 34px",
  border: `1px solid ${palette.hairline}`,
  borderRadius: 999,
  background: palette.card,
  color: palette.ink,
  font: "300 20px/1 system-ui, sans-serif",
  cursor: "pointer",
};

const bodyStyle: CSSProperties = {
  minHeight: 0,
  overflow: "auto",
  padding: 20,
  overscrollBehavior: "contain",
};

function noticeStyle(tone: PlayerNotice["tone"]): CSSProperties {
  const colors = tone === "error"
    ? { border: "#f3b9b5", background: "#fdecec" }
    : tone === "warning"
      ? { border: "#f0d9a8", background: "#fdf3e0" }
      : { border: "#a9e5cf", background: "#e2f7ef" };
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "9px 22px",
    borderBottom: `1px solid ${colors.border}`,
    background: colors.background,
    color: palette.ink,
    fontSize: 13,
  };
}

const codeStyle: CSSProperties = {
  padding: "2px 5px",
  borderRadius: 4,
  background: "rgba(58, 63, 85, 0.08)",
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
  background: "rgba(16, 18, 28, 0.5)",
  backdropFilter: "blur(4px)",
  WebkitBackdropFilter: "blur(4px)",
};

const confirmStyle: CSSProperties = {
  width: "min(440px, 100%)",
  border: "1px solid rgba(255, 255, 255, 0.6)",
  borderRadius: 18,
  padding: 24,
  background: palette.panelWhite,
  color: palette.ink,
  boxShadow: "0 18px 60px rgba(12, 15, 28, 0.4)",
};

const confirmTitleStyle: CSSProperties = { margin: 0, fontSize: 19, lineHeight: 1.3 };
const confirmMessageStyle: CSSProperties = { margin: "12px 0 20px", color: palette.inkSoft, fontSize: 14, lineHeight: 1.6 };
const confirmActionsStyle: CSSProperties = { display: "flex", justifyContent: "flex-end", gap: 10 };

const systemStyle: CSSProperties = {
  minHeight: "100%",
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
  gap: 32,
};
const systemActionsStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 10 };
const sectionTitleStyle: CSSProperties = { margin: 0, color: palette.ink, fontSize: 20 };
const systemHintStyle: CSSProperties = { margin: "10px 0 0", color: palette.inkSoft, fontSize: 13 };
