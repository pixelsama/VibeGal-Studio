import type { CSSProperties, MouseEvent } from "react";
import type { NovelState } from "@vibegal/engine";
import type { HudTokens } from "./useUiTokens";
import { palette } from "./uiTheme";

interface PlayerHudProps {
  state: NovelState;
  busy: boolean;
  hud: HudTokens;
  onOpenMenu: () => void;
  onQuickSave: () => void;
  onQuickLoad: () => void;
  onToggleAuto: () => void;
  onToggleReadSkip: () => void;
  onToggleAllSkip: () => void;
  onOpenHistory: () => void;
}

export function PlayerHud({
  state,
  busy,
  hud,
  onOpenMenu,
  onQuickSave,
  onQuickLoad,
  onToggleAuto,
  onToggleReadSkip,
  onToggleAllSkip,
  onOpenHistory,
}: PlayerHudProps) {
  const stop = (event: MouseEvent) => event.stopPropagation();
  const autoOn = state.flags.isAutoPlay;
  const readSkipOn = state.flags.skipMode === "read";
  const allSkipOn = state.flags.skipMode === "all";

  // hud.visible = 0/"0" 时整条 HUD 不渲染（Spec 17 hud.visible）
  if (!hud.visible) return null;

  // 定位：hud.x/y 缺失 = 内置右上锚定（右缘 16 / 顶 14）；拖拽写回 token 后
  // 切换为舞台坐标 left/top（松手位置即写回值，不会跳变）。
  const position: CSSProperties = hud.x != null
    ? { left: hud.x, top: hud.y ?? 14 }
    : { right: 16, top: 14 };

  return (
    <nav
      aria-label="玩家控制"
      data-ui-part="hud"
      onClick={stop}
      style={{ ...hudStyle, ...position, background: hud.bgColor }}
    >
      <HudButton action="menu" label="菜单" disabled={busy} hud={hud} onClick={onOpenMenu} />
      <HudButton action="quick-save" label="快存" disabled={busy} hud={hud} onClick={onQuickSave} />
      <HudButton action="quick-load" label="快读" disabled={busy} hud={hud} onClick={onQuickLoad} />
      <HudButton action="auto" label={`自动 ${autoOn ? "ON" : "OFF"}`} active={autoOn} disabled={busy} hud={hud} onClick={onToggleAuto} />
      <HudButton action="skip-read" label={`已读跳过 ${readSkipOn ? "ON" : "OFF"}`} active={readSkipOn} disabled={busy} hud={hud} onClick={onToggleReadSkip} />
      <HudButton action="skip-all" label={`全文跳过 ${allSkipOn ? "ON" : "OFF"}`} active={allSkipOn} disabled={busy} hud={hud} onClick={onToggleAllSkip} />
      <HudButton action="history" label="历史" disabled={busy} hud={hud} onClick={onOpenHistory} />
      {/* 悬停反馈走 stylesheet（inline style 表达不了 :hover）；激活态保持樱粉 */}
      <style>{`[data-player-action]:not(:disabled):not([aria-pressed="true"]):hover { background: rgba(255, 255, 255, 0.16) !important; }`}</style>
    </nav>
  );
}

function HudButton({
  action,
  label,
  active = false,
  disabled,
  hud,
  onClick,
}: {
  action: string;
  label: string;
  active?: boolean;
  disabled: boolean;
  hud: HudTokens;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-player-action={action}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      style={buttonStyle(active, hud)}
    >
      {label}
    </button>
  );
}

const hudStyle: CSSProperties = {
  position: "absolute",
  zIndex: 80,
  display: "flex",
  flexWrap: "wrap",
  justifyContent: "flex-end",
  gap: 2,
  maxWidth: "calc(100% - 32px)",
  padding: 4,
  boxSizing: "border-box",
  borderRadius: 999,
  border: "1px solid rgba(255, 255, 255, 0.16)",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  boxShadow: "0 6px 20px rgba(0, 0, 0, 0.25)",
};

// bgColor token 作用于整条胶囊底色；激活态保留内置樱粉作为状态反馈。
function buttonStyle(active: boolean, hud: HudTokens): CSSProperties {
  return {
    minHeight: 30,
    padding: "6px 12px",
    border: 0,
    borderRadius: 999,
    background: active ? palette.accent : "transparent",
    color: hud.textColor,
    fontWeight: 600,
    fontSize: hud.fontSize,
    lineHeight: 1.2,
    fontFamily: "inherit",
    letterSpacing: "0.5px",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}
