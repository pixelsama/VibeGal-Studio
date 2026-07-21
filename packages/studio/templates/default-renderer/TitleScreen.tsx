/**
 * TitleScreen —— 标题画面（Spec 21）：渲染层内部 UI 状态，不进 NovelState。
 *
 * 开始游戏 / 继续游戏 / 读取存档 / 设置 四个按钮带 data-title-action
 * （smoke 契约与第三方宿主共用）；根元素 data-ui-part="titleScreen"，几何完全
 * 由 titleScreen.* token 驱动（舞台坐标 px，缺失回退 DEFAULT_UI_TOKENS）。
 *
 * 标题美术/BGM 走 uiSkin assets 槽位约定键（值 = manifest 注册表资产 id）：
 * titleBackground 由 Stage 解析成本组件的 titleBackgroundUrl（整舞台铺满，
 * 缺失时退回 token 底色/内置磨砂白面板）；titleBgm 的播放/停止由 Stage 负责。
 */
import type { CSSProperties } from "react";
import type { Manifest, SaveSlotSummary } from "@vibegal/engine";
import { formatSlotTime } from "./playerUiModel";
import type { TitleScreenTokens } from "./useUiTokens";
import { palette } from "./uiTheme";

export interface TitleScreenProps {
  manifest: Manifest;
  /** uiSkin assets.titleBackground 解析出的整舞台美术 URL；null = 无标题美术 */
  titleBackgroundUrl: string | null;
  tokens: TitleScreenTokens;
  /** 「继续游戏」目标槽（updatedAt 最新，含 auto/quick）；null = 无存档 → 禁用 */
  continueSlot: SaveSlotSummary | null;
  /** 是否存在任何存档槽（控制「读取存档」禁用态） */
  hasSaves: boolean;
  busy: boolean;
  onStart: () => void;
  onContinue: () => void;
  onLoad: () => void;
  onSettings: () => void;
}

/** 标题文案：取 manifest.name，缺失回退项目通用默认文案。 */
export function titleScreenTitle(manifest: Manifest): string {
  const name = (manifest as { name?: unknown }).name;
  return typeof name === "string" && name.trim() !== "" ? name : "未命名作品";
}

export function TitleScreen({
  manifest,
  titleBackgroundUrl,
  tokens,
  continueSlot,
  hasSaves,
  busy,
  onStart,
  onContinue,
  onLoad,
  onSettings,
}: TitleScreenProps) {
  const continueSublabel = continueSlot
    ? `${continueSlot.label ?? continueSlot.slotId} · ${formatSlotTime(continueSlot.updatedAt)}`
    : "暂无存档";

  return (
    <>
      {titleBackgroundUrl && (
        <img
          src={titleBackgroundUrl}
          alt=""
          style={titleArtStyle}
        />
      )}
      <div
        data-ui-part="titleScreen"
        onClick={(event) => event.stopPropagation()}
        style={containerStyle(tokens)}
      >
        <h1 style={titleStyle(tokens)}>{titleScreenTitle(manifest)}</h1>
        <div style={menuStyle}>
          <button
            type="button"
            data-title-action="start"
            disabled={busy}
            onClick={onStart}
            style={buttonStyle(tokens)}
          >
            开始游戏
          </button>
          <button
            type="button"
            data-title-action="continue"
            disabled={busy || continueSlot === null}
            onClick={onContinue}
            style={buttonStyle(tokens)}
          >
            <span>继续游戏</span>
            <span data-title-sublabel style={sublabelStyle(tokens)}>{continueSublabel}</span>
          </button>
          <button
            type="button"
            data-title-action="load"
            disabled={busy || !hasSaves}
            onClick={onLoad}
            style={buttonStyle(tokens)}
          >
            读取存档
          </button>
          <button
            type="button"
            data-title-action="settings"
            disabled={busy}
            onClick={onSettings}
            style={buttonStyle(tokens)}
          >
            设置
          </button>
        </div>
        {/* 悬停与禁用态走 stylesheet（inline style 表达不了 :hover / :disabled） */}
        <style>{`
          [data-title-action]:not(:disabled):hover {
            background: ${tokens.buttonHoverColor} !important;
            color: #ffffff !important;
            border-color: transparent !important;
            transform: translateY(-1px);
            box-shadow: 0 12px 28px rgba(24, 28, 48, 0.24) !important;
          }
          [data-title-action]:not(:disabled):hover [data-title-sublabel] {
            color: rgba(255, 255, 255, 0.75) !important;
          }
          [data-title-action]:disabled {
            opacity: 0.45;
            cursor: default;
          }
        `}</style>
      </div>
    </>
  );
}

const titleArtStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "cover",
  zIndex: 0,
};

function containerStyle(tokens: TitleScreenTokens): CSSProperties {
  // 几何 token 语义 = 部件边框盒（与 Studio 拖拽 overlay 的选框一致）
  const background = tokens.bgColor === null
    ? palette.frost
    : tokens.bgOpacity === null
      ? tokens.bgColor
      : `color-mix(in srgb, ${tokens.bgColor} ${Math.round(tokens.bgOpacity * 100)}%, transparent)`;
  return {
    position: "absolute",
    left: tokens.x,
    top: tokens.y,
    width: tokens.width,
    height: tokens.height,
    boxSizing: "border-box",
    zIndex: 60,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 36,
    padding: "36px 44px",
    border: "1px solid rgba(255, 255, 255, 0.65)",
    borderRadius: 20,
    background,
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    boxShadow: "0 24px 80px rgba(12, 15, 28, 0.45)",
    cursor: "default",
  };
}

function titleStyle(tokens: TitleScreenTokens): CSSProperties {
  return {
    margin: 0,
    color: tokens.titleColor,
    fontSize: tokens.titleFontSize,
    fontFamily: tokens.titleFontFamily,
    fontWeight: 700,
    letterSpacing: "2px",
    textAlign: "center",
    textShadow: "0 2px 12px rgba(255, 255, 255, 0.6)",
  };
}

const menuStyle: CSSProperties = {
  width: "100%",
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

function buttonStyle(tokens: TitleScreenTokens): CSSProperties {
  return {
    minHeight: 48,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    background: tokens.buttonBgColor,
    color: tokens.buttonTextColor,
    border: "1px solid rgba(255, 255, 255, 0.55)",
    borderRadius: tokens.buttonRadius,
    padding: "8px 18px",
    fontSize: tokens.buttonFontSize,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    letterSpacing: "0.5px",
    boxShadow: "0 8px 24px rgba(24, 28, 48, 0.18)",
    transition: "transform 0.15s ease, box-shadow 0.15s ease",
  };
}

function sublabelStyle(tokens: TitleScreenTokens): CSSProperties {
  return {
    color: palette.inkFaint,
    fontSize: Math.max(10, tokens.buttonFontSize - 5),
    fontWeight: 500,
    letterSpacing: 0,
  };
}
