/**
 * useShake —— 震屏 hook。
 *
 * 为什么单独拎出来：震屏必须作用于「整个内容容器」（背景+立绘+对话框）才有意义，
 * 而不是让一个独立的覆盖层自己抖（那样画面不会跟着动）。
 *
 * 工作方式：监听 NovelState.effects 里尚未播放的 shake 特效，
 * 用 CSS 变量 + keyframe 动画驱动容器抖动。组件层自由实现，这只是默认实现。
 */
import { useEffect, useRef, useState } from "react";
import type { NovelState } from "@vibegal/engine";

export interface ShakeResult {
  /** 应用到内容容器的 style：触发抖动动画 */
  containerStyle: React.CSSProperties;
  /** 这段 keyframes 需要被注入（默认实现用；换组件时可忽略） */
  keyframes: string;
}

export function useShake(state: NovelState): ShakeResult {
  const playedShakeIds = useRef<Set<number>>(new Set());
  const [activeShake, setActiveShake] = useState<{ id: number; intensity: number; ms: number } | null>(null);

  useEffect(() => {
    // 找到尚未播放的 shake
    const pending = state.effects.find(
      (e) => e.type === "shake" && !playedShakeIds.current.has(e.id),
    );
    if (!pending) return;
    playedShakeIds.current.add(pending.id);
    setActiveShake({ id: pending.id, intensity: pending.intensity, ms: pending.ms });

    // 动画结束后清除，这样同一个 id 不会重复触发，但新 shake 能继续响应
    const t = setTimeout(() => setActiveShake(null), pending.ms);
    return () => clearTimeout(t);
  }, [state.effects]);

  const keyframes = `
    @keyframes shakeFx {
      0%, 100% { transform: translate(0,0) }
      15% { transform: translate(calc(var(--shake) * -1), 0) }
      30% { transform: translate(var(--shake), 0) }
      45% { transform: translate(calc(var(--shake) * -0.7), calc(var(--shake) * 0.4)) }
      60% { transform: translate(calc(var(--shake) * 0.6), 0) }
      75% { transform: translate(calc(var(--shake) * -0.4), calc(var(--shake) * -0.2)) }
    }
  `;

  const containerStyle: React.CSSProperties = activeShake
    ? {
        animation: `shakeFx ${activeShake.ms}ms ease`,
        ["--shake" as string]: `${activeShake.intensity}px`,
      }
    : {};

  return { containerStyle, keyframes };
}
