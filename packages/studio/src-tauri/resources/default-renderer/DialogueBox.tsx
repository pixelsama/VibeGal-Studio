/**
 * DialogueBox —— 对话框 + 旁白。
 * 打字机文本已经在 NovelState 里算好了（typedLen），这里只负责把切片显示出来。
 */
import { memo } from "react";
import type { NovelState } from "@vibegal/engine";

interface Props {
  state: NovelState;
}

function DialogueBoxImpl({ state }: Props) {
  const { dialogue, narration, speaker } = state;
  const visible = dialogue ?? narration;
  if (!visible) return null;

  const text = visible.text.slice(0, visible.typedLen);
  const isNarration = !dialogue;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 20,
        padding: "32px 64px 48px",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: "min(1100px, 92%)",
          background: isNarration
            ? "linear-gradient(to top, rgba(0,0,0,0.78), rgba(0,0,0,0.55))"
            : "linear-gradient(to top, rgba(10,16,30,0.86), rgba(10,16,30,0.7))",
          border: `1px solid ${speaker ? speaker.color + "55" : "rgba(255,255,255,0.12)"}`,
          borderTop: speaker ? `2px solid ${speaker.color}` : "1px solid rgba(255,255,255,0.12)",
          borderRadius: "6px",
          padding: "24px 32px 28px",
          backdropFilter: "blur(6px)",
          color: "#eef2f7",
          fontFamily: "'Noto Serif SC', 'Source Han Serif SC', serif",
          fontSize: "26px",
          lineHeight: 1.7,
          letterSpacing: "0.5px",
          minHeight: "120px",
          boxShadow: "0 -10px 40px rgba(0,0,0,0.5)",
          position: "relative",
        }}
      >
        {speaker && (
          <div
            style={{
              position: "absolute",
              top: "-18px",
              left: "24px",
              background: "rgba(8,12,22,0.95)",
              border: `1px solid ${speaker.color}66`,
              borderRadius: "4px",
              padding: "4px 16px",
              color: speaker.color,
              fontSize: "20px",
              fontWeight: 600,
              letterSpacing: "1px",
            }}
          >
            {speaker.name}
          </div>
        )}

        <p style={{ margin: 0, whiteSpace: "pre-wrap", minHeight: "1.7em", opacity: isNarration ? 0.9 : 1 }}>
          {text}
          <span
            style={{
              display: visible.fullyRevealed ? "none" : "inline-block",
              width: "0.5em",
              borderRight: "2px solid currentColor",
              marginLeft: "1px",
              animation: "caret 0.8s steps(1) infinite",
            }}
          />
        </p>
      </div>
      <style>{`@keyframes caret { 50% { border-color: transparent } }`}</style>
    </div>
  );
}

export const DialogueBox = memo(DialogueBoxImpl);
