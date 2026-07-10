import { resolveAsset, type Manifest, type RuntimeEffect } from "@vibegal/engine";

export type RuntimeMediaState =
  | { type: "cg"; id: string; src: string; label: string }
  | { type: "video"; id: string; src: string; poster?: string; skippable: boolean }
  | null;

export function runtimeMediaFromEffect(
  effect: RuntimeEffect,
  manifest: Manifest,
  contentBase: string,
): RuntimeMediaState {
  if (effect.type === "showCg") {
    const asset = manifest.cg[effect.id];
    if (!asset) return null;
    return {
      type: "cg",
      id: effect.id,
      src: resolveAsset(contentBase, asset.path),
      label: asset.name ?? effect.id,
    };
  }
  if (effect.type === "playVideo") {
    const asset = manifest.videos[effect.id];
    if (!asset) return null;
    return {
      type: "video",
      id: effect.id,
      src: resolveAsset(contentBase, asset.path),
      ...(asset.poster ? { poster: resolveAsset(contentBase, asset.poster) } : {}),
      skippable: effect.skippable ?? asset.skippable ?? false,
    };
  }
  return null;
}

export function RuntimeMediaOverlay({ media, onClose, onSkip }: {
  media: RuntimeMediaState;
  onClose: () => void;
  onSkip: () => void;
}) {
  if (!media) return null;

  return (
    <div style={overlayStyle} data-vibegal-media={media.type} data-vibegal-media-id={media.id}>
      {media.type === "cg" ? (
        <>
          <img src={media.src} alt={media.label} style={mediaStyle} />
          <button type="button" onClick={onClose} style={actionStyle} aria-label="关闭 CG">
            关闭 CG
          </button>
        </>
      ) : (
        <>
          <video
            src={media.src}
            poster={media.poster}
            autoPlay
            controls
            playsInline
            onEnded={onClose}
            style={mediaStyle}
            data-vibegal-video-loaded="pending"
            onLoadedData={(event) => { event.currentTarget.dataset.vibegalVideoLoaded = "true"; }}
          />
          {media.skippable && (
            <button type="button" onClick={onSkip} style={actionStyle} aria-label="跳过视频">
              跳过视频
            </button>
          )}
        </>
      )}
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 1000,
  display: "grid",
  placeItems: "center",
  overflow: "hidden",
  background: "#000",
};

const mediaStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "contain",
};

const actionStyle: React.CSSProperties = {
  position: "absolute",
  top: 20,
  right: 20,
  padding: "8px 14px",
  color: "#fff",
  background: "rgba(0,0,0,0.72)",
  border: "1px solid rgba(255,255,255,0.45)",
  borderRadius: 6,
  cursor: "pointer",
};
