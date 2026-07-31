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

/**
 * 媒体覆盖层（CG / 视频弹层）。
 *
 * 本组件同时被 Studio（预览 / 节点试演）与 web 导出运行时宿主
 * （webRuntimeHost）使用；按钮文案由宿主注入（closeLabel/skipLabel），
 * **不依赖 Studio 的 i18n 目录**——exporter 打包不含 src/lib（Installed CLI
 * 无源码环境下解析会失败，曾致 renderer 编译回归）。缺省用中性英文词。
 */
export function RuntimeMediaOverlay({ media, onClose, onSkip, closeLabel = "Close", skipLabel = "Skip" }: {
  media: RuntimeMediaState;
  onClose: () => void;
  onSkip: () => void;
  /** CG 关闭按钮文案（Studio 传 i18n 文案，web 运行时用缺省/宿主文案）。 */
  closeLabel?: string;
  /** 视频跳过按钮文案（同上）。 */
  skipLabel?: string;
}) {
  if (!media) return null;

  return (
    <div style={overlayStyle} data-vibegal-media={media.type} data-vibegal-media-id={media.id}>
      {media.type === "cg" ? (
        <>
          <img src={media.src} alt={media.label} style={mediaStyle} />
          <button type="button" onClick={onClose} style={actionStyle} aria-label={closeLabel}>
            {closeLabel}
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
            <button type="button" onClick={onSkip} style={actionStyle} aria-label={skipLabel}>
              {skipLabel}
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
