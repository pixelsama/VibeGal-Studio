/**
 * Stage —— 默认视图层的组装入口。
 *
 * 它把 NovelState 分发给各子层。换主题 = 重写 components/，
 * 引擎与剧本不动。本文件是「默认主题」的实现，可作为参考模板。
 *
 * 点击任意空白处 = 推进（方便录屏时鼠标操作）。
 */
import { useEffect, useState } from "react";
import type { RendererProps } from "@galstudio/engine";
import { BackgroundLayer } from "./BackgroundLayer";
import { SpriteLayer } from "./SpriteLayer";
import { DialogueBox } from "./DialogueBox";
import { Effects } from "./Effects";
import { useShake } from "./useShake";

export function Stage({ state, manifest, contentBase, onAdvance, onChoose, onToggleAuto, onToggleRecording, onSeekBy, onStepOnce, onPrevChapter, onNextChapter }: RendererProps) {
  // 控制层是否可见：录制模式隐藏
  const [showHelp, setShowHelp] = useState(true);
  const [choiceHint, setChoiceHint] = useState<string | null>(null);
  const hideControls = state.flags.isRecording;
  const { containerStyle: shakeStyle, keyframes: shakeKeyframes } = useShake(state);

  // 录制模式 3 秒后自动隐藏帮助提示
  useEffect(() => {
    if (!hideControls) { setShowHelp(true); return; }
    const t = setTimeout(() => setShowHelp(false), 3000);
    return () => clearTimeout(t);
  }, [hideControls]);

  useEffect(() => {
    setChoiceHint(null);
  }, [state.choice]);

  return (
    <div
      onClick={onAdvance}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: "#000",
        cursor: hideControls ? "none" : "pointer",
        userSelect: "none",
        fontFamily: "'Noto Serif SC', serif",
      }}
    >
      {/* 内容容器：背景+立绘+对话框 都在里面，震屏的 transform 作用于它，整个画面才会跟着抖 */}
      <div style={{ position: "absolute", inset: 0, ...shakeStyle }}>
        <BackgroundLayer state={state} manifest={manifest} contentBase={contentBase} />
        <SpriteLayer state={state} manifest={manifest} contentBase={contentBase} />
        <DialogueBox state={state} />
      </div>
      <Effects state={state} />
      <style>{shakeKeyframes}</style>

      {state.choice && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            left: "50%",
            bottom: 150,
            transform: "translateX(-50%)",
            zIndex: 70,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            minWidth: 280,
            maxWidth: "min(560px, calc(100% - 48px))",
          }}
        >
          {state.choice.choices.map((choice) => (
            <button
              key={`${choice.text}:${choice.to}`}
              type="button"
              onClick={() => {
                setChoiceHint(`将跳转到 ${choice.to}`);
                onChoose?.(choice.to);
              }}
              style={choiceButtonStyle}
            >
              {choice.text}
            </button>
          ))}
          {choiceHint && <div style={choiceHintStyle}>{choiceHint}</div>}
        </div>
      )}

      {!hideControls && showHelp && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            zIndex: 60,
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          {onPrevChapter && (
            <button onClick={onPrevChapter} style={btnStyle(false)} title="上一章">⏮ 章</button>
          )}
          {onSeekBy && (
            <button onClick={() => onSeekBy(-1)} style={btnStyle(false)} title="后退一条">◀</button>
          )}
          {onStepOnce && (
            <button onClick={onStepOnce} style={btnStyle(false)} title="单步执行">▶∣</button>
          )}
          {onSeekBy && (
            <button onClick={() => onSeekBy(1)} style={btnStyle(false)} title="前进一条">▶</button>
          )}
          {onNextChapter && (
            <button onClick={onNextChapter} style={btnStyle(false)} title="下一章">章 ⏭</button>
          )}
          <button onClick={onToggleAuto} style={btnStyle(state.flags.isAutoPlay)}>
            自动 {state.flags.isAutoPlay ? "ON" : "OFF"}
          </button>
          <button onClick={onToggleRecording} style={btnStyle(state.flags.isRecording)}>
            录制 {state.flags.isRecording ? "ON" : "OFF"}
          </button>
        </div>
      )}

      {!hideControls && (
        <div
          style={{
            position: "absolute",
            bottom: 8,
            left: 16,
            zIndex: 60,
            color: "rgba(255,255,255,0.35)",
            fontSize: 13,
            pointerEvents: "none",
          }}
        >
          空格/点击 推进 · A 自动 · R 录制 · {state.flags.progress.current}/{state.flags.progress.total}
        </div>
      )}
    </div>
  );
}

const choiceButtonStyle: React.CSSProperties = {
  background: "rgba(0,0,0,0.72)",
  color: "#fff",
  border: "1px solid rgba(255,255,255,0.35)",
  borderRadius: 6,
  padding: "12px 18px",
  fontSize: 17,
  cursor: "pointer",
  fontFamily: "inherit",
  textAlign: "center",
};

const choiceHintStyle: React.CSSProperties = {
  color: "rgba(255,255,255,0.75)",
  fontSize: 13,
  textAlign: "center",
  textShadow: "0 1px 2px rgba(0,0,0,0.8)",
};

function btnStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? "rgba(120,180,220,0.85)" : "rgba(0,0,0,0.6)",
    color: "#fff",
    border: "1px solid rgba(255,255,255,0.25)",
    borderRadius: 4,
    padding: "6px 12px",
    fontSize: 13,
    cursor: "pointer",
    fontFamily: "inherit",
  };
}
