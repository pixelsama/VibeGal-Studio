/**
 * BackgroundLayer —— 纯渲染：把 NovelState.background 画出来。
 * 不懂引擎，只懂 state + manifest + contentBase。
 */
import { memo } from "react";
import type { NovelState } from "@vibegal/engine";
import type { Manifest } from "@vibegal/engine";
import { resolveAsset } from "@vibegal/engine";

interface Props {
  state: NovelState;
  manifest: Manifest;
  contentBase: string;
}

function BackgroundLayerImpl({ state, manifest, contentBase }: Props) {
  const bg = state.background;
  const src = bg ? manifest.backgrounds[bg] : null;
  const url = src ? resolveAsset(contentBase, src) : null;

  const transition = state.backgroundTrans === "cut" ? "none" : `opacity ${state.backgroundMs}ms ease`;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "#000",
        zIndex: 0,
      }}
    >
      {url && (
        <img
          key={url}
          src={url}
          alt=""
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: 1,
            transition,
            animation: state.backgroundTrans === "fade" ? `bgFadeIn ${state.backgroundMs}ms ease` : undefined,
          }}
        />
      )}
      <style>{`@keyframes bgFadeIn { from { opacity: 0 } to { opacity: 1 } }`}</style>
    </div>
  );
}

export const BackgroundLayer = memo(BackgroundLayerImpl);
