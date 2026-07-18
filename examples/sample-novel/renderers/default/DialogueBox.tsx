/**
 * DialogueBox —— 对话框 + 名字框 + 旁白。
 * 打字机文本已经在 NovelState 里算好了（typedLen），这里只负责把切片显示出来。
 *
 * 几何与配色由 useUiTokens 驱动（Spec 17 token 协议）：dialogueBox 与 nameBox
 * 是舞台坐标系内绝对定位的可拖拽部件（data-ui-part），token 缺失时回退默认值，
 * 默认值即改造前的硬编码视觉（像素级不变）。
 */
import { memo } from "react";
import type { Manifest, NovelState } from "@vibegal/engine";
import { useUiTokens } from "./useUiTokens";

interface Props {
  state: NovelState;
  manifest: Manifest;
}

function DialogueBoxImpl({ state, manifest }: Props) {
  const tokens = useUiTokens(manifest);
  const { dialogue, narration, speaker } = state;
  const visible = dialogue ?? narration;
  if (!visible) return null;

  const text = visible.text.slice(0, visible.typedLen);
  const isNarration = !dialogue;
  const box = tokens.dialogueBox;
  const name = tokens.nameBox;

  // bgColor 缺失时保留内置的对白/旁白双渐变；bgOpacity 仅在与 bgColor 搭配时生效。
  const background = box.bgColor == null
    ? isNarration
      ? "linear-gradient(to top, rgba(0,0,0,0.78), rgba(0,0,0,0.55))"
      : "linear-gradient(to top, rgba(10,16,30,0.86), rgba(10,16,30,0.7))"
    : box.bgOpacity == null
      ? box.bgColor
      : `color-mix(in srgb, ${box.bgColor} ${Math.round(box.bgOpacity * 100)}%, transparent)`;
  // borderColor 缺失时保留「跟随说话人颜色」的现状。
  const borderColor = box.borderColor ?? (speaker ? `${speaker.color}55` : "rgba(255,255,255,0.12)");

  return (
    <>
      <div
        data-ui-part="dialogueBox"
        style={{
          position: "absolute",
          left: box.x,
          top: box.y,
          width: box.width,
          height: box.height,
          // 几何 token 语义 = 部件边框盒（与 Studio 拖拽 overlay 的选框一致）
          boxSizing: "border-box",
          zIndex: 20,
          background,
          border: `1px solid ${borderColor}`,
          borderTop: speaker ? `2px solid ${speaker.color}` : `1px solid ${borderColor}`,
          borderRadius: box.radius,
          padding: box.padding,
          backdropFilter: "blur(6px)",
          color: box.textColor,
          fontFamily: box.fontFamily,
          fontSize: box.fontSize,
          lineHeight: `${box.lineHeight}px`,
          letterSpacing: "0.5px",
          boxShadow: "0 -10px 40px rgba(0,0,0,0.5)",
        }}
      >
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
        <style>{`@keyframes caret { 50% { border-color: transparent } }`}</style>
      </div>
      {speaker && name.visible && (
        <div
          data-ui-part="nameBox"
          style={{
            position: "absolute",
            left: name.x,
            top: name.y,
            width: name.width ?? undefined,
            height: name.height ?? undefined,
            boxSizing: "border-box",
            zIndex: 21,
            background: name.bgColor,
            border: `1px solid ${speaker.color}66`,
            borderRadius: 4,
            padding: "4px 16px",
            color: name.textColor ?? speaker.color,
            fontSize: name.fontSize,
            // 旧结构里名字框继承对话框的字体与 line-height 1.7，移出后显式保持
            fontFamily: box.fontFamily,
            lineHeight: 1.7,
            fontWeight: 600,
            letterSpacing: "1px",
          }}
        >
          {speaker.name}
        </div>
      )}
    </>
  );
}

export const DialogueBox = memo(DialogueBoxImpl);
