/**
 * Effects —— 消费 NovelState.effects / transitions，做震屏、闪屏、黑场。
 *
 * 特效是「一次性事件」：组件用 id 记住「已播过的」，播放后不重放。
 * 这里不直接改 state（不持有引擎引用），只读 state 产生动画，
 * 清理由上层 useNovel 在适当时机把 effects 数组重置（见 Stage 中的版本去重逻辑）。
 */
import { useEffect, useRef, useState } from "react";
import type { NovelState, PendingEffect, PendingTransition } from "@galstudio/engine";

interface Props {
  state: NovelState;
}

/** 闪屏：一次白色（或类型对应色）快速覆盖。 */
function FlashOverlay({ fx }: { fx: PendingEffect }) {
  const [show, setShow] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setShow(false), fx.ms);
    return () => clearTimeout(t);
  }, [fx.ms, fx.id]);
  if (!show) return null;
  const color = fx.type === "flash" ? "#ffffff" : "#88aaff";
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 40,
        background: color,
        opacity: 0.7,
        pointerEvents: "none",
        transition: `opacity ${fx.ms}ms ease-out`,
      }}
    />
  );
}

/**
 * 转场覆盖层。
 * 语义：
 *   *_in  —— 开始全黑/全白（遮住画面），结束时透明 → 「从黑场淡入画面」
 *   *_out —— 开始透明，结束时全黑/全白 → 「画面淡出到黑场」
 * 之前实现的 opacity 逻辑写反了，导致 fade_out 全程不可见。
 */
function TransitionOverlay({ tr }: { tr: PendingTransition }) {
  const isOut = tr.type.endsWith("out");
  const [phase, setPhase] = useState<"start" | "end">("start");
  useEffect(() => {
    // 下一帧再切到 end，让 transition 生效（start 的初始 opacity 先渲染一帧）
    const raf = requestAnimationFrame(() => setPhase("end"));
    const t = setTimeout(() => setPhase("end"), tr.ms);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, [tr.ms, tr.id]);

  const color = tr.type.startsWith("white") ? "#ffffff" : "#000000";
  // out：0 → 1（渐黑）；in：1 → 0（渐显）
  const opacity = isOut
    ? (phase === "start" ? 0 : 1)
    : (phase === "start" ? 1 : 0);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 50,
        background: color,
        opacity,
        pointerEvents: "none",
        transition: `opacity ${tr.ms}ms ease`,
      }}
    />
  );
}

export function Effects({ state }: Props) {
  // 记录已渲染过的 effect/transition id，避免在同一帧内重复触发
  const seenFx = useRef<Set<number>>(new Set());
  const seenTr = useRef<Set<number>>(new Set());

  const newFx = state.effects.filter((e) => !seenFx.current.has(e.id));
  const newTr = state.transitions.filter((t) => !seenTr.current.has(t.id));

  useEffect(() => {
    newFx.forEach((e) => seenFx.current.add(e.id));
    newTr.forEach((t) => seenTr.current.add(t.id));
  });

  // 注意：shake（震屏）不在这里渲染——它必须作用于整个舞台容器（背景+立绘+对话框）
  // 才有效果，所以由 Stage 通过 useShake 接管。这里只画 flash/blur 覆盖层和转场。
  return (
    <>
      {newFx.map((e) => (e.type === "flash" || e.type === "blur" ? <FlashOverlay key={e.id} fx={e} /> : null))}
      {newTr.map((t) => <TransitionOverlay key={t.id} tr={t} />)}
    </>
  );
}
