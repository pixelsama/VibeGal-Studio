import type { CSSProperties, MouseEvent } from "react";
import type { NovelState } from "@vibegal/engine";

interface PlayerHudProps {
  state: NovelState;
  busy: boolean;
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

  return (
    <nav aria-label="玩家控制" onClick={stop} style={hudStyle}>
      <HudButton action="menu" label="菜单" disabled={busy} onClick={onOpenMenu} />
      <HudButton action="quick-save" label="快存" disabled={busy} onClick={onQuickSave} />
      <HudButton action="quick-load" label="快读" disabled={busy} onClick={onQuickLoad} />
      <HudButton action="auto" label={`自动 ${autoOn ? "ON" : "OFF"}`} active={autoOn} disabled={busy} onClick={onToggleAuto} />
      <HudButton action="skip-read" label={`已读跳过 ${readSkipOn ? "ON" : "OFF"}`} active={readSkipOn} disabled={busy} onClick={onToggleReadSkip} />
      <HudButton action="skip-all" label={`全文跳过 ${allSkipOn ? "ON" : "OFF"}`} active={allSkipOn} disabled={busy} onClick={onToggleAllSkip} />
      <HudButton action="history" label="历史" disabled={busy} onClick={onOpenHistory} />
    </nav>
  );
}

function HudButton({
  action,
  label,
  active = false,
  disabled,
  onClick,
}: {
  action: string;
  label: string;
  active?: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-player-action={action}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      style={buttonStyle(active)}
    >
      {label}
    </button>
  );
}

const hudStyle: CSSProperties = {
  position: "absolute",
  top: 14,
  right: 16,
  zIndex: 80,
  display: "flex",
  flexWrap: "wrap",
  justifyContent: "flex-end",
  gap: 6,
  maxWidth: "calc(100% - 32px)",
};

function buttonStyle(active: boolean): CSSProperties {
  return {
    minHeight: 34,
    padding: "6px 10px",
    border: active ? "1px solid rgba(117, 220, 204, 0.9)" : "1px solid rgba(255, 255, 255, 0.24)",
    borderRadius: 4,
    background: active ? "rgba(26, 112, 101, 0.92)" : "rgba(14, 15, 17, 0.78)",
    color: "#fff",
    font: "600 12px/1.2 system-ui, sans-serif",
    letterSpacing: 0,
    cursor: "pointer",
    whiteSpace: "nowrap",
    boxShadow: "0 2px 12px rgba(0, 0, 0, 0.28)",
  };
}
