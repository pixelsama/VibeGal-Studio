import type { CSSProperties } from "react";
import { resolveAsset, type Manifest } from "@vibegal/engine";
import type { PlayerSlotView } from "./playerUiModel";

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
        <button type="button" data-player-action="menu-quick-save" disabled={busy} onClick={onQuickSave} style={primaryButtonStyle}>
          快速存档
        </button>
        <button type="button" data-player-action="menu-quick-load" disabled={busy} onClick={onQuickLoad} style={secondaryButtonStyle}>
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
    <article data-player-slot={slot.slotId} style={cardStyle}>
      <div
        aria-hidden="true"
        style={{
          ...previewStyle,
          backgroundImage: backgroundUrl
            ? `linear-gradient(rgba(0,0,0,0.08), rgba(0,0,0,0.35)), url(${JSON.stringify(backgroundUrl)})`
            : undefined,
        }}
      >
        {!backgroundUrl && <span style={emptyPreviewStyle}>{slot.empty ? "EMPTY" : "NO BG"}</span>}
      </div>

      <div style={contentStyle}>
        <div style={titleRowStyle}>
          <strong style={slotTitleStyle}>{slot.label}</strong>
          <span style={kindStyle(slot.kind)}>{slot.kind === "manual" ? "MANUAL" : slot.kind.toUpperCase()}</span>
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
            <button type="button" data-slot-action="load" disabled={busy} onClick={() => onLoad(slot)} style={smallPrimaryStyle}>
              读取
            </button>
          )}
          {slot.canSave && (
            <button type="button" data-slot-action="save" disabled={busy} onClick={() => onSave(slot)} style={smallSecondaryStyle}>
              {slot.empty ? "保存" : "覆盖"}
            </button>
          )}
          {slot.canDelete && (
            <button type="button" data-slot-action="delete" disabled={busy} onClick={() => onDelete(slot)} style={smallDangerStyle}>
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
const gridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 };
const cardStyle: CSSProperties = {
  minWidth: 0,
  minHeight: 168,
  display: "grid",
  gridTemplateColumns: "112px minmax(0, 1fr)",
  overflow: "hidden",
  border: "1px solid rgba(255, 255, 255, 0.15)",
  borderRadius: 6,
  background: "rgba(255, 255, 255, 0.035)",
};
const previewStyle: CSSProperties = {
  minHeight: 168,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "#101113",
  backgroundSize: "cover",
  backgroundPosition: "center",
};
const emptyPreviewStyle: CSSProperties = { color: "rgba(255, 255, 255, 0.25)", font: "600 11px/1 monospace" };
const contentStyle: CSSProperties = { minWidth: 0, display: "flex", flexDirection: "column", padding: 10 };
const titleRowStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 };
const slotTitleStyle: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13 };
const emptyTextStyle: CSSProperties = { margin: "15px 0 auto", color: "rgba(255, 255, 255, 0.4)", fontSize: 12 };
const metaStyle: CSSProperties = { margin: "7px 0 0", color: "rgba(255, 255, 255, 0.46)", fontSize: 10 };
const positionStyle: CSSProperties = { margin: "5px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#e2c077", font: "11px/1.3 monospace" };
const previewTextStyle: CSSProperties = { margin: "6px 0 auto", display: "-webkit-box", overflow: "hidden", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", color: "rgba(255, 255, 255, 0.78)", fontSize: 12, lineHeight: 1.45 };
const actionsStyle: CSSProperties = { minHeight: 29, display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 5, marginTop: 9 };

function kindStyle(kind: PlayerSlotView["kind"]): CSSProperties {
  return {
    flex: "0 0 auto",
    color: kind === "auto" ? "#e3bc70" : kind === "quick" ? "#74d8c5" : "rgba(255, 255, 255, 0.45)",
    font: "600 9px/1 monospace",
  };
}

const baseButtonStyle: CSSProperties = { minHeight: 34, borderRadius: 4, padding: "7px 13px", color: "#fff", font: "600 12px/1 system-ui, sans-serif", cursor: "pointer" };
const primaryButtonStyle: CSSProperties = { ...baseButtonStyle, border: "1px solid #74d8c5", background: "#246d62" };
const secondaryButtonStyle: CSSProperties = { ...baseButtonStyle, border: "1px solid rgba(255, 255, 255, 0.25)", background: "transparent" };
const smallBaseStyle: CSSProperties = { minHeight: 27, borderRadius: 3, padding: "5px 8px", color: "#fff", font: "600 10px/1 system-ui, sans-serif", cursor: "pointer" };
const smallPrimaryStyle: CSSProperties = { ...smallBaseStyle, border: "1px solid #6fcab9", background: "rgba(35, 108, 96, 0.9)" };
const smallSecondaryStyle: CSSProperties = { ...smallBaseStyle, border: "1px solid rgba(255, 255, 255, 0.23)", background: "transparent" };
const smallDangerStyle: CSSProperties = { ...smallBaseStyle, border: "1px solid rgba(226, 128, 128, 0.72)", background: "rgba(116, 54, 54, 0.55)" };

const responsiveCss = `
@container (max-width: 940px) {
  [data-save-panel] > div:nth-of-type(2) { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
}
@container (max-width: 620px) {
  [data-save-panel] > div:nth-of-type(2) { grid-template-columns: minmax(0, 1fr) !important; }
}
`;
