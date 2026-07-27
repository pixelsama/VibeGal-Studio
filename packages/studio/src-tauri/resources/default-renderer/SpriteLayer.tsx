/**
 * SpriteLayer —— 立绘层（默认实现）。
 *
 * 引擎只告诉本层「发生了什么」（位置槽、过渡意图、表情变化和退场），
 * 本层把这些语义解释为可替换的视觉表现。动画图集是渐进增强；任何图集
 * 配置或资源失败都会保留静态 fallback，不会阻止剧情。
 */
import { memo, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { ActiveSprite, Manifest, NovelState } from "@vibegal/engine";
import { resolveAsset } from "@vibegal/engine";

interface Props {
  state: NovelState;
  manifest: Manifest;
  contentBase: string;
}

type AnimationAtlas = Manifest["animationAtlases"][string];
type AnimationClip = NonNullable<AnimationAtlas["clips"]>[string];

const POS_X: Record<string, string> = {
  left: "22%",
  center: "50%",
  right: "78%",
  far_left: "12%",
  far_right: "88%",
  "far-left": "12%",
  "far-right": "88%",
};

function resolvePos(pos: string): string {
  return POS_X[pos] ?? "50%";
}

export interface AtlasFrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Resolve a zero-based atlas frame through a row-major grid. */
export function atlasFrameRect(
  frame: number,
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number,
): AtlasFrameRect | null {
  if (
    !Number.isInteger(frame)
    || frame < 0
    || frameWidth <= 0
    || frameHeight <= 0
  ) return null;

  const columns = Math.floor(imageWidth / frameWidth);
  const rows = Math.floor(imageHeight / frameHeight);
  if (columns <= 0 || rows <= 0 || frame >= columns * rows) return null;
  return {
    x: (frame % columns) * frameWidth,
    y: Math.floor(frame / columns) * frameHeight,
    width: frameWidth,
    height: frameHeight,
  };
}

export function nextAtlasClipFrame(
  current: number,
  frameCount: number,
  loop: boolean,
): number {
  if (frameCount <= 1) return 0;
  if (current + 1 < frameCount) return current + 1;
  return loop ? 0 : current;
}

function spriteReference(
  manifest: Manifest,
  characterId: string,
  expression: string | null,
) {
  if (!expression) return null;
  const character = manifest.characters[characterId];
  return character?.sprites[expression]
    ?? character?.sprites.default
    ?? null;
}

function spriteAnimation(sprite: ActiveSprite): string {
  if (sprite.leaving) return "spriteFadeOut 400ms ease forwards";
  if (sprite.trans === "cut") return "none";

  const duration = Math.max(0, sprite.ms);
  const moved = sprite.prevPos != null && sprite.prevPos !== sprite.pos;
  if (sprite.trans === "slide" && (sprite.justEntered || moved)) {
    const from = sprite.moveFrom ?? sprite.prevPos;
    return from && from !== sprite.pos
      ? `spriteSlotMoveIn ${duration}ms cubic-bezier(0.2,0.8,0.2,1)`
      : `spriteSlideIn ${duration}ms cubic-bezier(0.2,0.8,0.2,1)`;
  }
  return sprite.justEntered || moved
    ? `spriteFadeIn ${duration}ms ease`
    : "none";
}

const visualFrameStyle: CSSProperties = {
  display: "block",
  height: "100%",
  maxHeight: "100%",
  width: "auto",
  objectFit: "contain",
  objectPosition: "bottom center",
};

function AtlasSprite({
  atlas,
  clip,
  fallback,
  contentBase,
  alt,
}: {
  atlas: AnimationAtlas;
  clip: AnimationClip;
  fallback: string;
  contentBase: string;
  alt: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const frameWidth = atlas.frameWidth;
  const frameHeight = atlas.frameHeight;
  const atlasUrl = resolveAsset(contentBase, atlas.image);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !frameWidth || !frameHeight || clip.frames.length === 0) return;

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const image = new Image();
    setReady(false);

    image.onload = () => {
      if (cancelled) return;
      const context = canvas.getContext("2d");
      if (!context) return;
      const rectangles = clip.frames.map((frame: number) => atlasFrameRect(
        frame,
        image.naturalWidth,
        image.naturalHeight,
        frameWidth,
        frameHeight,
      ));
      if (rectangles.some((rectangle: AtlasFrameRect | null) => rectangle == null)) return;

      let current = 0;
      const draw = () => {
        const rectangle = rectangles[current];
        if (!rectangle) return;
        context.clearRect(0, 0, frameWidth, frameHeight);
        context.drawImage(
          image,
          rectangle.x,
          rectangle.y,
          rectangle.width,
          rectangle.height,
          0,
          0,
          frameWidth,
          frameHeight,
        );
      };

      draw();
      setReady(true);
      if (rectangles.length <= 1) return;
      timer = setInterval(() => {
        const next = nextAtlasClipFrame(current, rectangles.length, clip.loop !== false);
        if (next === current) {
          if (timer) clearInterval(timer);
          return;
        }
        current = next;
        draw();
      }, 1000 / clip.fps);
    };
    image.src = atlasUrl;

    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
      if (timer) clearInterval(timer);
    };
  }, [atlasUrl, clip, frameHeight, frameWidth]);

  return (
    <div
      data-runtime-sprite-visual="true"
      style={{
        position: "relative",
        height: "100%",
        aspectRatio: `${frameWidth ?? 1} / ${frameHeight ?? 1}`,
      }}
    >
      <img
        data-runtime-sprite="true"
        src={resolveAsset(contentBase, fallback)}
        alt={alt}
        style={{ ...visualFrameStyle, width: "100%" }}
      />
      {frameWidth && frameHeight && (
        <canvas
          ref={canvasRef}
          data-runtime-sprite-canvas="true"
          width={frameWidth}
          height={frameHeight}
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            opacity: ready ? 1 : 0,
          }}
        />
      )}
    </div>
  );
}

function SpriteVisual({
  manifest,
  characterId,
  expression,
  contentBase,
}: {
  manifest: Manifest;
  characterId: string;
  expression: string | null;
  contentBase: string;
}) {
  const reference = spriteReference(manifest, characterId, expression);
  if (!reference) return null;
  if (typeof reference === "string") {
    return (
      <img
        data-runtime-sprite="true"
        src={resolveAsset(contentBase, reference)}
        alt={characterId}
        style={visualFrameStyle}
      />
    );
  }

  const atlas = manifest.animationAtlases[reference.atlas];
  const clip = atlas?.clips?.[reference.clip];
  if (!atlas || !clip || !atlas.frameWidth || !atlas.frameHeight) {
    return (
      <img
        data-runtime-sprite="true"
        src={resolveAsset(contentBase, reference.fallback)}
        alt={characterId}
        style={visualFrameStyle}
      />
    );
  }
  return (
    <AtlasSprite
      atlas={atlas}
      clip={clip}
      fallback={reference.fallback}
      contentBase={contentBase}
      alt={characterId}
    />
  );
}

function SpriteItem({
  sprite,
  manifest,
  contentBase,
}: {
  sprite: ActiveSprite;
  manifest: Manifest;
  contentBase: string;
}) {
  if (!spriteReference(manifest, sprite.id, sprite.expr)) return null;

  const previousReference = sprite.exprMs > 0 && !sprite.leaving
    ? spriteReference(manifest, sprite.id, sprite.prevExpr)
    : null;
  const crossFading = previousReference != null && sprite.prevExpr !== sprite.expr;
  const fromPos = resolvePos(sprite.moveFrom ?? sprite.prevPos ?? sprite.pos);
  const positionStyle: CSSProperties & Record<`--sprite-${string}`, string> = {
    "--sprite-from-x": fromPos,
    "--sprite-to-x": resolvePos(sprite.pos),
  };

  return (
    <div
      data-runtime-sprite-item="true"
      style={{
        ...positionStyle,
        position: "absolute",
        bottom: 0,
        left: resolvePos(sprite.pos),
        height: "100%",
        transform: `translateX(-50%) scale(${sprite.scale}) scaleX(${sprite.flip ? -1 : 1})`,
        transformOrigin: "bottom center",
        filter: "drop-shadow(0 8px 30px rgba(0,0,0,0.6))",
        animation: spriteAnimation(sprite),
      }}
    >
      {crossFading && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            animation: `spriteExprOut ${sprite.exprMs}ms ease forwards`,
          }}
        >
          <SpriteVisual
            manifest={manifest}
            characterId={sprite.id}
            expression={sprite.prevExpr}
            contentBase={contentBase}
          />
        </div>
      )}
      <div
        style={{
          height: "100%",
          animation: crossFading
            ? `spriteExprIn ${sprite.exprMs}ms ease`
            : undefined,
        }}
      >
        <SpriteVisual
          manifest={manifest}
          characterId={sprite.id}
          expression={sprite.expr}
          contentBase={contentBase}
        />
      </div>
    </div>
  );
}

function SpriteLayerImpl({ state, manifest, contentBase }: Props) {
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 10, pointerEvents: "none" }}>
      {state.sprites.map((sprite) => (
        <SpriteItem
          key={`${sprite.id}-${sprite.changeId}`}
          sprite={sprite}
          manifest={manifest}
          contentBase={contentBase}
        />
      ))}
      <style>{`
        @keyframes spriteFadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes spriteSlideIn { from { opacity: 0; translate: -80px 0 } to { opacity: 1; translate: 0 0 } }
        @keyframes spriteSlotMoveIn { from { opacity: 0; left: var(--sprite-from-x) } to { opacity: 1; left: var(--sprite-to-x) } }
        @keyframes spriteFadeOut { from { opacity: 1 } to { opacity: 0 } }
        @keyframes spriteExprIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes spriteExprOut { from { opacity: 1 } to { opacity: 0 } }
      `}</style>
    </div>
  );
}

export const SpriteLayer = memo(SpriteLayerImpl);
