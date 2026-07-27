/**
 * TitleScreen —— 标题画面（Spec 21）：渲染层内部 UI 状态，不进 NovelState。
 *
 * 开始游戏 / 继续游戏 / 读取存档 / 设置 四个按钮带 data-title-action
 * （smoke 契约与第三方宿主共用）；根元素 data-ui-part="titleScreen"，几何完全
 * 由 titleScreen.* token 驱动（舞台坐标 px，缺失回退 DEFAULT_UI_TOKENS）。
 *
 * 标题美术/BGM 走 uiSkin assets 槽位约定键（值 = manifest 注册表资产 id）：
 * titleBackground 由 Stage 解析成本组件的 titleBackgroundUrl（整舞台铺满，
 * 缺失时退回 token 底色/内置暗色玻璃面板）；titleBgm 的播放/停止由 Stage 负责。
 */
import type { CSSProperties } from "react";
import type { Manifest, Meta, SaveSlotSummary } from "@vibegal/engine";
import { formatSlotTime } from "./playerUiModel";
import type { TitleScreenTokens } from "./useUiTokens";
import { palette } from "./uiTheme";

export interface TitleScreenProps {
  manifest: Manifest;
  /** 作品元信息；标题取 meta.title */
  meta: Meta;
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
  onChapters: () => void;
  onReplay: () => void;
  hasChapters: boolean;
  hasReplays: boolean;
  onSettings: () => void;
}

/**
 * 标题文案：取 meta.title（= content/meta.json 的「作品标题」），未填时回退默认文案。
 *
 * 曾经读的是 manifest.name —— 该字段在 ManifestSchema 里并不存在，于是无论作者
 * 怎么填「项目 → 作品标题」，标题画面都恒为「未命名作品」。
 */
export function titleScreenTitle(meta: Pick<Meta, "title">): string {
  const title = meta?.title;
  return typeof title === "string" && title.trim() !== "" ? title : "未命名作品";
}

export function TitleScreen({
  manifest,
  meta,
  titleBackgroundUrl,
  tokens,
  continueSlot,
  hasSaves,
  busy,
  onStart,
  onContinue,
  onLoad,
  onChapters,
  onReplay,
  hasChapters,
  hasReplays,
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
        <h1 style={titleStyle(tokens)}>{titleScreenTitle(meta)}</h1>
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
            data-title-action="chapters"
            disabled={busy || !hasChapters}
            onClick={onChapters}
            style={buttonStyle(tokens)}
          >
            章节跳读
          </button>
          <button
            type="button"
            data-title-action="replay"
            disabled={busy || !hasReplays}
            onClick={onReplay}
            style={buttonStyle(tokens)}
          >
            回想
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
            color: #15161a !important;
            border-color: ${palette.accent} !important;
            transform: translateX(-4px);
            box-shadow: 0 12px 28px rgba(0, 0, 0, 0.32) !important;
          }
          [data-title-action]:not(:disabled):hover [data-title-sublabel] {
            color: rgba(21, 22, 26, 0.7) !important;
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
    ? palette.titlePanel
    : tokens.bgOpacity === null
      ? tokens.bgColor
      : `color-mix(in srgb, ${tokens.bgColor} ${Math.round(tokens.bgOpacity * 100)}%, transparent)`;
  return {
    position: "absolute",
    left: tokens.x,
    top: tokens.y,
    width: tokens.width,
    height: tokens.height,
    maxWidth: `calc(100% - ${Math.max(0, tokens.x)}px)`,
    maxHeight: `calc(100% - ${Math.max(0, tokens.y)}px)`,
    overflowY: "auto",
    boxSizing: "border-box",
    zIndex: 60,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 36,
    padding: "48px 42px 42px",
    border: `1px solid ${palette.menuHairline}`,
    borderRadius: 2,
    background,
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    boxShadow: "0 28px 88px rgba(0, 0, 0, 0.58)",
    cursor: "default",
  };
}

function titleStyle(tokens: TitleScreenTokens): CSSProperties {
  return {
    margin: 0,
    maxWidth: "100%",
    color: tokens.titleColor,
    fontSize: tokens.titleFontSize,
    fontFamily: tokens.titleFontFamily,
    fontWeight: 700,
    lineHeight: 1.22,
    letterSpacing: "0.12em",
    textAlign: "right",
    textShadow: "0 3px 20px rgba(0, 0, 0, 0.6)",
    overflowWrap: "anywhere",
  };
}

const menuStyle: CSSProperties = {
  width: "min(310px, 100%)",
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  gap: 5,
};

function buttonStyle(tokens: TitleScreenTokens): CSSProperties {
  return {
    minHeight: 48,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 3,
    background: tokens.buttonBgColor,
    color: tokens.buttonTextColor,
    border: 0,
    borderBottom: `1px solid ${palette.menuHairline}`,
    borderRadius: tokens.buttonRadius,
    padding: "8px 16px",
    textAlign: "right",
    fontSize: tokens.buttonFontSize,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    letterSpacing: "0.5px",
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.16)",
    transition: "transform 0.15s ease, box-shadow 0.15s ease",
  };
}

function sublabelStyle(tokens: TitleScreenTokens): CSSProperties {
  return {
    color: palette.menuTextFaint,
    fontSize: Math.max(10, tokens.buttonFontSize - 5),
    fontWeight: 500,
    letterSpacing: 0,
  };
}
