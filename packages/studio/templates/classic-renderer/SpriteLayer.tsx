/**
 * SpriteLayer —— 立绘层（默认实现）。
 *
 * 引擎只告诉本层「发生了什么」（justEntered / 表情变化 / leaving），
 * 本层自己决定「怎么演」：
 *   - justEntered：按 trans 字段选 滑入/淡入
 *   - prevExpr !== expr：表情淡入过渡
 *   - leaving：淡出
 *   - idle：轻微呼吸摇晃
 *
 * 换一套组件可以完全重新定义这些表现，剧本和引擎不受影响。
 */
import { memo, useEffect, useState } from "react";
import type { NovelState, ActiveSprite } from "@vibegal/engine";
import type { Manifest } from "@vibegal/engine";
import { resolveAsset } from "@vibegal/engine";

interface Props {
  state: NovelState;
  manifest: Manifest;
  contentBase: string;
}

const POS_X: Record<string, string> = {
  left: "22%",
  center: "50%",
  right: "78%",
  far_left: "12%",
  far_right: "88%",
};

function resolvePos(pos: string): string {
  return POS_X[pos] ?? "50%";
}

/**
 * 用 changeId 作为 React key 的一部分，让每次「变化」都重新挂载，
 * 从而触发 CSS 入场动画。这是把「事件式语义」接到「声明式渲染」的常见手法。
 */
function SpriteItem({ sprite, manifest, contentBase }: { sprite: ActiveSprite; manifest: Manifest; contentBase: string }) {
  const char = manifest.characters[sprite.id];
  const rel = char?.sprites[sprite.expr] ?? char?.sprites.default ?? null;
  const [fadeOut, setFadeOut] = useState(false);

  // leaving 时启动淡出
  useEffect(() => {
    if (sprite.leaving) {
      setFadeOut(true);
    }
  }, [sprite.leaving]);

  if (!rel) return null;
  const url = resolveAsset(contentBase, rel);

  // 根据 trans 选不同的 keyframe
  const enterAnim =
    sprite.trans === "slide"
      ? "spriteSlideIn 500ms cubic-bezier(0.2,0.8,0.2,1)"
      : sprite.trans === "cut"
        ? "none"
        : "spriteFadeIn 500ms ease";

  return (
    <img
      key={`${sprite.id}-${sprite.changeId}`}
      src={url}
      alt={sprite.id}
      style={{
        position: "absolute",
        bottom: 0,
        left: resolvePos(sprite.pos),
        transform: "translateX(-50%)",
        height: "100%",
        maxHeight: "100%",
        objectFit: "contain",
        objectPosition: "bottom center",
        filter: "drop-shadow(0 8px 30px rgba(0,0,0,0.6))",
        animation: fadeOut
          ? "spriteFadeOut 400ms ease forwards"
          : enterAnim,
        opacity: fadeOut ? 1 : undefined,
        transition: "left 400ms cubic-bezier(0.2,0.8,0.2,1)",
      }}
    />
  );
}

function SpriteLayerImpl({ state, manifest, contentBase }: Props) {
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 10, pointerEvents: "none" }}>
      {state.sprites.map((s) => (
        <SpriteItem key={s.id} sprite={s} manifest={manifest} contentBase={contentBase} />
      ))}
      <style>{`
        @keyframes spriteFadeIn { from { opacity: 0; transform: translateX(-50%) translateY(20px) } to { opacity: 1; transform: translateX(-50%) translateY(0) } }
        @keyframes spriteSlideIn { from { opacity: 0; transform: translateX(-50%) translateX(-80px) } to { opacity: 1; transform: translateX(-50%) translateX(0) } }
        @keyframes spriteFadeOut { from { opacity: 1 } to { opacity: 0; transform: translateX(-50%) translateY(10px) scale(0.98) } }
      `}</style>
    </div>
  );
}

export const SpriteLayer = memo(SpriteLayerImpl);
