/**
 * DialogueBox —— 对话框 + 名字框 + 旁白。
 * 打字机文本已经在 NovelState 里算好了（typedLen），这里只负责把切片显示出来。
 *
 * 设计语言（现代扁平二次元）：磨砂白 + backdrop 模糊的大圆角对话框，
 * 顶边一条樱粉→天蓝渐变装饰条；名字框是压在对话框顶边的胶囊，
 * 底色跟随说话人颜色；文本全部显示后右下角出现樱粉 ▼ 继续指示。
 *
 * 几何与配色由 useUiTokens 驱动（Spec 17 token 协议）：dialogueBox 与 nameBox
 * 是舞台坐标系内绝对定位的可拖拽部件（data-ui-part），token 缺失时回退默认值。
 */
import { memo } from "react";
import type { Manifest, NovelState } from "@vibegal/engine";
import { useUiTokens } from "./useUiTokens";
import { palette } from "./uiTheme";

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

  // bgColor 缺失 = 内置磨砂白（配合 backdrop 模糊）；bgOpacity 仅在与 bgColor 搭配时生效。
  const background = box.bgColor == null
    ? palette.frost
    : box.bgOpacity == null
      ? box.bgColor
      : `color-mix(in srgb, ${box.bgColor} ${Math.round(box.bgOpacity * 100)}%, transparent)`;
  // borderColor 缺失 = 内置发丝白边（让白盒在暗场景上依然有清晰的轮廓）。
  const borderColor = box.borderColor ?? "rgba(255, 255, 255, 0.65)";

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
          borderRadius: box.radius,
          padding: box.padding,
          backdropFilter: "blur(16px) saturate(1.5)",
          WebkitBackdropFilter: "blur(16px) saturate(1.5)",
          color: box.textColor,
          fontFamily: box.fontFamily,
          fontSize: box.fontSize,
          lineHeight: `${box.lineHeight}px`,
          letterSpacing: "0.4px",
          boxShadow: "0 16px 48px rgba(24, 28, 48, 0.28)",
          // 裁住顶部渐变装饰条的圆角
          overflow: "hidden",
        }}
      >
        {/* 顶边渐变装饰条（纯装饰，樱粉 → 天蓝） */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 4,
            background: `linear-gradient(90deg, ${palette.accent}, ${palette.sky})`,
          }}
        />
        <p style={{ margin: 0, whiteSpace: "pre-wrap", minHeight: "1.8em", opacity: isNarration ? 0.85 : 1 }}>
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
        {visible.fullyRevealed && (
          <span
            aria-hidden="true"
            data-continue-indicator
            style={{
              position: "absolute",
              right: 22,
              bottom: 12,
              color: palette.accent,
              fontSize: 14,
              lineHeight: 1,
              animation: "vnContinue 1s ease-in-out infinite",
            }}
          >
            ▼
          </span>
        )}
        <style>{`
          @keyframes caret { 50% { border-color: transparent } }
          @keyframes vnContinue { 50% { transform: translateY(3px); opacity: 0.55 } }
        `}</style>
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
            background: name.bgColor ?? speaker.color,
            border: "2px solid rgba(255, 255, 255, 0.8)",
            borderRadius: 999,
            padding: "6px 18px",
            color: name.textColor,
            fontSize: name.fontSize,
            fontFamily: box.fontFamily,
            lineHeight: 1.5,
            fontWeight: 700,
            letterSpacing: "1px",
            boxShadow: "0 6px 18px rgba(24, 28, 48, 0.25)",
          }}
        >
          {speaker.name}
        </div>
      )}
    </>
  );
}

export const DialogueBox = memo(DialogueBoxImpl);
