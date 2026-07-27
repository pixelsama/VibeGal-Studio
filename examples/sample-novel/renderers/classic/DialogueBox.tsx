import { memo } from "react";
import { RuntimeTextView, type Manifest, type NovelState } from "@vibegal/engine";
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

  const isNarration = !dialogue;
  const box = tokens.dialogueBox;
  const name = tokens.nameBox;
  const background = box.bgColor == null
    ? palette.frost
    : box.bgOpacity == null
      ? box.bgColor
      : `color-mix(in srgb, ${box.bgColor} ${Math.round(box.bgOpacity * 100)}%, transparent)`;
  const borderColor = box.borderColor ?? "rgba(200, 166, 106, 0.58)";

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
          boxSizing: "border-box",
          zIndex: 20,
          overflow: "hidden",
          background,
          border: `1px solid ${borderColor}`,
          borderRadius: box.radius,
          padding: box.padding,
          backdropFilter: "blur(9px)",
          WebkitBackdropFilter: "blur(9px)",
          color: box.textColor,
          fontFamily: box.fontFamily,
          fontSize: box.fontSize,
          lineHeight: `${box.lineHeight}px`,
          letterSpacing: "0.06em",
          boxShadow: "0 14px 44px rgba(0, 0, 0, 0.56)",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            width: 4,
            background: palette.accent,
          }}
        />
        <p style={{ margin: 0, whiteSpace: "pre-wrap", minHeight: "1.8em", opacity: isNarration ? 0.86 : 1 }}>
          <RuntimeTextView text={visible} />
          <span
            style={{
              display: visible.fullyRevealed ? "none" : "inline-block",
              width: "0.5em",
              marginLeft: 1,
              borderRight: "1px solid currentColor",
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
              bottom: 14,
              color: palette.accent,
              fontSize: 12,
              lineHeight: 1,
              animation: "vnContinue 1s ease-in-out infinite",
            }}
          >
            ◆
          </span>
        )}
        <style>{`
          @keyframes caret { 50% { border-color: transparent } }
          @keyframes vnContinue { 50% { transform: translateY(2px); opacity: 0.5 } }
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
            background: name.bgColor ?? palette.accent,
            border: `1px solid ${palette.accent}`,
            borderRadius: 2,
            padding: "7px 22px",
            color: name.textColor,
            fontSize: name.fontSize,
            fontFamily: box.fontFamily,
            lineHeight: 1.35,
            fontWeight: 700,
            letterSpacing: "0.14em",
            boxShadow: "0 7px 22px rgba(0, 0, 0, 0.42)",
          }}
        >
          {speaker.name}
        </div>
      )}
    </>
  );
}

export const DialogueBox = memo(DialogueBoxImpl);
