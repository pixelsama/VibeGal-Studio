import type { CSSProperties } from "react";
import { resolveAsset, type Manifest } from "@vibegal/engine";
import type { PlayerSlotView } from "./playerUiModel";
import {
  cardStyle,
  itemMetaStyle,
  palette,
  primaryPillButton,
  secondaryPillButton,
  smallDangerPillButton,
  smallPrimaryPillButton,
  smallSecondaryPillButton,
} from "./uiTheme";

interface SaveLoadPanelProps {
  slots: PlayerSlotView[];
  busy: boolean;
  manifest: Manifest;
  contentBase: string;
  onSave: (slot: PlayerSlotView) => void;
  onLoad: (slot: PlayerSlotView) => void;
  onDelete: (slot: PlayerSlotView) => void;
  onQuickSave: () => void;
  onQuickLoad: () => void;
}

export function SaveLoadPanel({
  slots,
  busy,
  manifest,
  contentBase,
  onSave,
  onLoad,
  onDelete,
  onQuickSave,
  onQuickLoad,
}: SaveLoadPanelProps) {
  return (
    <div data-save-panel style={panelStyle}>
      <div style={toolbarStyle}>
        <button type="button" data-player-action="menu-quick-save" disabled={busy} onClick={onQuickSave} style={primaryPillButton}>
          快速存档
        </button>
        <button type="button" data-player-action="menu-quick-load" disabled={busy} onClick={onQuickLoad} style={secondaryPillButton}>
          快速读档
        </button>
      </div>

      <div style={gridStyle}>
        {slots.map((slot) => (
          <SlotCard
            key={slot.slotId}
            slot={slot}
            busy={busy}
            manifest={manifest}
            contentBase={contentBase}
            onSave={onSave}
            onLoad={onLoad}
            onDelete={onDelete}
          />
        ))}
      </div>
      <style>{responsiveCss}</style>
    </div>
  );
}

function SlotCard({
  slot,
  busy,
  manifest,
  contentBase,
  onSave,
  onLoad,
  onDelete,
}: {
  slot: PlayerSlotView;
  busy: boolean;
  manifest: Manifest;
  contentBase: string;
  onSave: (slot: PlayerSlotView) => void;
  onLoad: (slot: PlayerSlotView) => void;
  onDelete: (slot: PlayerSlotView) => void;
}) {
  const backgroundId = slot.summary?.preview?.background;
  const backgroundPath = backgroundId ? manifest.backgrounds[backgroundId] : undefined;
  const backgroundUrl = backgroundPath ? resolveAsset(contentBase, backgroundPath) : undefined;
  const position = slot.summary?.position;

  return (
    <article data-player-slot={slot.slotId} style={slotCardStyle}>
      <div
        aria-hidden="true"
        style={{
          ...previewStyle,
          backgroundImage: backgroundUrl
            ? `linear-gradient(rgba(0,0,0,0.04), rgba(0,0,0,0.22)), url(${JSON.stringify(backgroundUrl)})`
            : undefined,
        }}
      >
        {!backgroundUrl && <span style={emptyPreviewStyle}>{slot.empty ? "EMPTY" : "NO BG"}</span>}
      </div>

      <div style={contentStyle}>
        <div style={titleRowStyle}>
          <strong style={slotTitleStyle}>{slot.label}</strong>
          <span style={kindBadgeStyle(slot.kind)}>{slot.kind === "manual" ? "MANUAL" : slot.kind.toUpperCase()}</span>
        </div>
        {slot.empty ? (
          <p style={emptyTextStyle}>空槽位</p>
        ) : (
          <>
            <p style={metaStyle}>{formatDate(slot.summary?.updatedAt)}</p>
            <p style={positionStyle}>{position ? `${position.nodeId} / ${position.instructionId}` : "未知位置"}</p>
            <p style={previewTextStyle}>{slot.summary?.preview?.text ?? "无文本预览"}</p>
          </>
        )}
        <div style={actionsStyle}>
          {slot.canLoad && (
            <button type="button" data-slot-action="load" disabled={busy} onClick={() => onLoad(slot)} style={smallPrimaryPillButton}>
              读取
            </button>
          )}
          {slot.canSave && (
            <button type="button" data-slot-action="save" disabled={busy} onClick={() => onSave(slot)} style={smallSecondaryPillButton}>
              {slot.empty ? "保存" : "覆盖"}
            </button>
          )}
          {slot.canDelete && (
            <button type="button" data-slot-action="delete" disabled={busy} onClick={() => onDelete(slot)} style={smallDangerPillButton}>
              删除
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function formatDate(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

const panelStyle: CSSProperties = { containerType: "inline-size" };
const toolbarStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 };
const gridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 };
const slotCardStyle: CSSProperties = {
  ...cardStyle,
  minWidth: 0,
  minHeight: 168,
  display: "grid",
  gridTemplateColumns: "112px minmax(0, 1fr)",
  overflow: "hidden",
};
const previewStyle: CSSProperties = {
  minHeight: 168,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: palette.cardDeep,
  backgroundSize: "cover",
  backgroundPosition: "center",
};
const emptyPreviewStyle: CSSProperties = { color: palette.inkFaint, font: "600 11px/1 monospace" };
const contentStyle: CSSProperties = { minWidth: 0, display: "flex", flexDirection: "column", padding: 12 };
const titleRowStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 };
const slotTitleStyle: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: palette.ink, fontSize: 13 };
const emptyTextStyle: CSSProperties = { margin: "15px 0 auto", color: palette.inkFaint, fontSize: 12 };
const metaStyle: CSSProperties = { margin: "7px 0 0", color: palette.inkFaint, fontSize: 10 };
const positionStyle: CSSProperties = { ...itemMetaStyle, margin: "5px 0 0", display: "block", color: "#c78f2b", font: "11px/1.3 monospace" };
const previewTextStyle: CSSProperties = { margin: "6px 0 auto", display: "-webkit-box", overflow: "hidden", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", color: palette.inkSoft, fontSize: 12, lineHeight: 1.45 };
const actionsStyle: CSSProperties = { minHeight: 29, display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 6, marginTop: 9 };

function kindBadgeStyle(kind: PlayerSlotView["kind"]): CSSProperties {
  const colors =
    kind === "auto"
      ? { background: "rgba(240, 179, 82, 0.16)", color: "#c78f2b" }
      : kind === "quick"
        ? { background: "rgba(92, 184, 230, 0.16)", color: "#3d9bc7" }
        : { background: "rgba(58, 63, 85, 0.08)", color: palette.inkSoft };
  return {
    flex: "0 0 auto",
    padding: "3px 7px",
    borderRadius: 999,
    font: "700 9px/1 ui-monospace, monospace",
    letterSpacing: "0.5px",
    ...colors,
  };
}

const responsiveCss = `
@container (max-width: 940px) {
  [data-save-panel] > div:nth-of-type(2) { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
}
@container (max-width: 620px) {
  [data-save-panel] > div:nth-of-type(2) { grid-template-columns: minmax(0, 1fr) !important; }
}
`;
