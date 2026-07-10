import { useState, type CSSProperties } from "react";
import { resolveAsset, type GalleryService, type Manifest } from "@vibegal/engine";

interface GalleryPanelProps {
  manifest: Manifest;
  contentBase: string;
  gallery: GalleryService;
  busy: boolean;
}

interface ReplayPanelProps {
  manifest: Manifest;
  gallery: GalleryService;
  busy: boolean;
  onStartReplay: (replayId: string) => void;
}

interface MusicRoomPanelProps {
  manifest: Manifest;
  gallery: GalleryService;
  busy: boolean;
  onPlayMusic: (audioId: string) => void;
  onStopMusic: () => void;
}

interface EndingsPanelProps {
  manifest: Manifest;
  gallery: GalleryService;
}

interface SelectedCg {
  id: string;
  title: string;
  src: string;
}

type CgUnlockEntry = { assetId: string; title?: string };
type MusicUnlockEntry = { audioId: string; title?: string };
type ReplayUnlockEntry = { nodeId: string; title?: string };
type EndingUnlockEntry = { title: string; nodeId?: string };

export function GalleryPanel({ manifest, contentBase, gallery, busy }: GalleryPanelProps) {
  const [selected, setSelected] = useState<SelectedCg | null>(null);
  const entries = Object.entries(manifest.unlocks?.cg ?? {}) as Array<[string, CgUnlockEntry]>;

  if (entries.length === 0) return <EmptyState title="暂无 CG 登记" />;

  return (
    <div style={panelStyle}>
      <div data-gallery-grid style={gridStyle}>
        {entries.map(([id, entry]) => {
          const unlocked = gallery.isUnlocked("cg", id);
          const asset = manifest.cg?.[entry.assetId];
          const path = assetPath(asset);
          const thumbnail = assetThumbnail(asset) ?? path;
          const title = entry.title ?? assetName(asset) ?? id;
          const src = path ? resolveAsset(contentBase, path) : "";
          const thumbnailSrc = thumbnail ? resolveAsset(contentBase, thumbnail) : "";
          return (
            <button
              key={id}
              type="button"
              data-gallery-cg={id}
              disabled={busy || !unlocked || !src}
              onClick={() => setSelected({ id, title, src })}
              style={galleryCardStyle(unlocked)}
            >
              <span style={thumbStyle(thumbnailSrc)}>
                {unlocked && thumbnailSrc ? <img src={thumbnailSrc} alt="" style={thumbImageStyle} /> : <span style={lockedStyle}>LOCKED</span>}
              </span>
              <span style={itemTitleStyle}>{unlocked ? title : "未解锁 CG"}</span>
              <span style={itemMetaStyle}>{id}</span>
            </button>
          );
        })}
      </div>
      {selected && (
        <div data-gallery-preview={selected.id} style={previewOverlayStyle}>
          <img src={selected.src} alt={selected.title} style={previewImageStyle} />
          <button type="button" aria-label="关闭 CG 预览" onClick={() => setSelected(null)} style={previewCloseStyle}>
            关闭
          </button>
        </div>
      )}
      <style>{responsiveCss}</style>
    </div>
  );
}

export function ReplayPanel({ manifest, gallery, busy, onStartReplay }: ReplayPanelProps) {
  const entries = Object.entries(manifest.unlocks?.replay ?? {}) as Array<[string, ReplayUnlockEntry]>;
  if (entries.length === 0) return <EmptyState title="暂无回想登记" />;

  return (
    <div style={listStyle}>
      {entries.map(([id, entry]) => {
        const unlocked = gallery.isUnlocked("replay", id);
        return (
          <article key={id} data-replay-entry={id} style={rowStyle(unlocked)}>
            <div style={rowCopyStyle}>
              <strong style={itemTitleStyle}>{unlocked ? entry.title ?? id : "未解锁回想"}</strong>
              <code style={itemMetaStyle}>{entry.nodeId}</code>
            </div>
            <button type="button" data-replay-action="start" disabled={busy || !unlocked} onClick={() => onStartReplay(id)} style={primaryButtonStyle}>
              开始回想
            </button>
          </article>
        );
      })}
    </div>
  );
}

export function MusicRoomPanel({ manifest, gallery, busy, onPlayMusic, onStopMusic }: MusicRoomPanelProps) {
  const entries = Object.entries(manifest.unlocks?.music ?? {}) as Array<[string, MusicUnlockEntry]>;
  if (entries.length === 0) return <EmptyState title="暂无音乐登记" />;

  return (
    <div style={panelStyle}>
      <div style={toolbarStyle}>
        <button type="button" data-music-action="stop" disabled={busy} onClick={onStopMusic} style={secondaryButtonStyle}>
          停止音乐
        </button>
      </div>
      <div style={listStyle}>
        {entries.map(([id, entry]) => {
          const unlocked = gallery.isUnlocked("music", id);
          const asset = manifest.audio.bgm[entry.audioId];
          return (
            <article key={id} data-music-entry={id} style={rowStyle(unlocked)}>
              <div style={rowCopyStyle}>
                <strong style={itemTitleStyle}>{unlocked ? entry.title ?? id : "未解锁音乐"}</strong>
                <code style={itemMetaStyle}>{unlocked ? asset ?? entry.audioId : id}</code>
              </div>
              <button type="button" data-music-action="play" disabled={busy || !unlocked} onClick={() => onPlayMusic(entry.audioId)} style={primaryButtonStyle}>
                播放
              </button>
            </article>
          );
        })}
      </div>
    </div>
  );
}

export function EndingsPanel({ manifest, gallery }: EndingsPanelProps) {
  const entries = Object.entries(manifest.unlocks?.endings ?? {}) as Array<[string, EndingUnlockEntry]>;
  if (entries.length === 0) return <EmptyState title="暂无结局登记" />;

  return (
    <div style={listStyle}>
      {entries.map(([id, entry]) => {
        const unlocked = gallery.isUnlocked("endings", id);
        return (
          <article key={id} data-ending-entry={id} style={rowStyle(unlocked)}>
            <div style={rowCopyStyle}>
              <strong style={itemTitleStyle}>{unlocked ? entry.title : "未解锁结局"}</strong>
              <code style={itemMetaStyle}>{entry.nodeId ?? id}</code>
            </div>
            <span style={badgeStyle(unlocked)}>{unlocked ? "已达成" : "LOCKED"}</span>
          </article>
        );
      })}
    </div>
  );
}

function EmptyState({ title }: { title: string }) {
  return (
    <div role="status" style={emptyStyle}>
      <strong style={emptyTitleStyle}>{title}</strong>
    </div>
  );
}

function assetPath(asset: unknown): string | null {
  if (typeof asset === "string") return asset;
  if (!asset || typeof asset !== "object") return null;
  const value = (asset as { path?: unknown }).path;
  return typeof value === "string" ? value : null;
}

function assetThumbnail(asset: unknown): string | null {
  if (!asset || typeof asset !== "object") return null;
  const value = (asset as { thumbnail?: unknown }).thumbnail;
  return typeof value === "string" ? value : null;
}

function assetName(asset: unknown): string | null {
  if (!asset || typeof asset !== "object") return null;
  const value = (asset as { name?: unknown }).name;
  return typeof value === "string" ? value : null;
}

const panelStyle: CSSProperties = { position: "relative", minHeight: "100%", containerType: "inline-size" };
const toolbarStyle: CSSProperties = { display: "flex", justifyContent: "flex-end", marginBottom: 12 };
const gridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 };
const listStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 8 };
const rowCopyStyle: CSSProperties = { minWidth: 0, display: "flex", flexDirection: "column", gap: 5 };
const itemTitleStyle: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#fff", fontSize: 13 };
const itemMetaStyle: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgba(255,255,255,0.42)", font: "10px/1.3 monospace" };
const emptyStyle: CSSProperties = { minHeight: 260, display: "grid", placeItems: "center", color: "rgba(255,255,255,0.6)" };
const emptyTitleStyle: CSSProperties = { color: "#fff", fontSize: 17 };
const lockedStyle: CSSProperties = { color: "rgba(255,255,255,0.32)", font: "700 12px/1 monospace" };
const thumbImageStyle: CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };

function galleryCardStyle(unlocked: boolean): CSSProperties {
  return {
    minWidth: 0,
    minHeight: 172,
    display: "grid",
    gridTemplateRows: "112px auto auto",
    gap: 7,
    padding: 9,
    border: unlocked ? "1px solid rgba(116, 216, 197, 0.45)" : "1px solid rgba(255,255,255,0.12)",
    borderRadius: 6,
    background: unlocked ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.025)",
    color: "#fff",
    textAlign: "left",
    cursor: unlocked ? "pointer" : "default",
  };
}

function thumbStyle(src: string): CSSProperties {
  return {
    minWidth: 0,
    overflow: "hidden",
    display: "grid",
    placeItems: "center",
    borderRadius: 4,
    backgroundColor: "#101113",
    backgroundImage: src ? `url(${JSON.stringify(src)})` : undefined,
    backgroundSize: "cover",
    backgroundPosition: "center",
  };
}

function rowStyle(unlocked: boolean): CSSProperties {
  return {
    minHeight: 58,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    alignItems: "center",
    gap: 12,
    padding: "12px 14px",
    border: unlocked ? "1px solid rgba(116, 216, 197, 0.34)" : "1px solid rgba(255,255,255,0.11)",
    borderRadius: 5,
    background: unlocked ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.02)",
  };
}

const baseButtonStyle: CSSProperties = { minHeight: 32, borderRadius: 4, padding: "7px 11px", color: "#fff", font: "600 11px/1 system-ui, sans-serif", cursor: "pointer" };
const primaryButtonStyle: CSSProperties = { ...baseButtonStyle, border: "1px solid #73d3c1", background: "#246d62" };
const secondaryButtonStyle: CSSProperties = { ...baseButtonStyle, border: "1px solid rgba(255,255,255,0.24)", background: "transparent" };

function badgeStyle(unlocked: boolean): CSSProperties {
  return {
    padding: "5px 8px",
    borderRadius: 3,
    color: unlocked ? "#d8fff8" : "rgba(255,255,255,0.36)",
    background: unlocked ? "rgba(35,108,96,0.55)" : "rgba(255,255,255,0.06)",
    font: "700 10px/1 monospace",
  };
}

const previewOverlayStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 10,
  display: "grid",
  placeItems: "center",
  background: "#000",
};
const previewImageStyle: CSSProperties = { width: "100%", height: "100%", objectFit: "contain" };
const previewCloseStyle: CSSProperties = {
  position: "absolute",
  top: 14,
  right: 14,
  minHeight: 34,
  padding: "7px 13px",
  border: "1px solid rgba(255,255,255,0.42)",
  borderRadius: 4,
  background: "rgba(0,0,0,0.72)",
  color: "#fff",
  cursor: "pointer",
};

const responsiveCss = `
@container (max-width: 820px) {
  [data-gallery-grid] { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
}
@container (max-width: 620px) {
  [data-gallery-grid] { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
}
@container (max-width: 420px) {
  [data-gallery-grid] { grid-template-columns: minmax(0, 1fr) !important; }
}
`;
