/**
 * uiTheme —— 默认渲染层的共享视觉语言（现代扁平二次元）。
 *
 * 设计基调：明亮的磨砂白面板 + 樱粉/天蓝点缀 + 大圆角与胶囊形控件 +
 * 柔和投影 + 无衬线字体。各面板组件（存档/历史/画廊/设置…）从这里取
 * 色板与按钮/卡片样式，保证整套 UI 是一套设计语言而不是各画各的。
 *
 * 注意：这里是「面板内部」的硬编码基底；可被外观 token 覆盖的部分
 * （对话框/名字框/选项/HUD/菜单窗口几何等）在 useUiTokens.ts，不在本文件。
 */
import type { CSSProperties } from "react";

export const palette = {
  /** 樱粉：主行动色 / 激活态 */
  accent: "#ff6f9f",
  /** 樱粉浅色底：激活条目、徽章底色 */
  accentSoft: "#ffe3ee",
  /** 天蓝：次点缀（quick 徽章、渐变另一端） */
  sky: "#5cb8e6",
  /** 暖金：auto 徽章 / 警告 */
  gold: "#f0b352",
  /** 薄荷：成功反馈 */
  mint: "#3ecfa5",
  /** 危险红 */
  danger: "#e5534b",
  /** 墨色：亮面板上的主文字 */
  ink: "#3a3f55",
  /** 次级文字 */
  inkSoft: "rgba(58, 63, 85, 0.6)",
  /** 弱化文字 / 占位 */
  inkFaint: "rgba(58, 63, 85, 0.38)",
  /** 发丝分割线 / 边框 */
  hairline: "rgba(58, 63, 85, 0.1)",
  /** 菜单窗口白 */
  panelWhite: "rgba(255, 255, 255, 0.96)",
  /** 卡片底 */
  card: "#f4f6fb",
  /** 卡片上的深底（缩略图占位） */
  cardDeep: "#e9edf5",
  /** 对话框磨砂白 */
  frost: "rgba(255, 255, 255, 0.86)",
} as const;

/** 全局无衬线字体栈（stage.fontFamily token 的默认值也用它）。 */
export const SANS_FONT =
  "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif";

// ──────────────────────────────────────────────
// 胶囊按钮（面板内通用）
// ──────────────────────────────────────────────

const basePillButton: CSSProperties = {
  minHeight: 34,
  borderRadius: 999,
  padding: "8px 16px",
  fontWeight: 600,
  fontSize: 12,
  lineHeight: 1,
  fontFamily: "inherit",
  letterSpacing: "0.5px",
  cursor: "pointer",
  border: "1px solid transparent",
  whiteSpace: "nowrap",
};

/** 主按钮：实心樱粉 + 柔光 */
export const primaryPillButton: CSSProperties = {
  ...basePillButton,
  background: palette.accent,
  color: "#fff",
  boxShadow: "0 4px 14px rgba(255, 111, 159, 0.35)",
};

/** 次按钮：白底发丝边 */
export const secondaryPillButton: CSSProperties = {
  ...basePillButton,
  background: "#fff",
  border: `1px solid ${palette.hairline}`,
  color: palette.ink,
};

/** 危险按钮：白底红描边 */
export const dangerPillButton: CSSProperties = {
  ...basePillButton,
  background: "#fff",
  border: "1px solid rgba(229, 83, 75, 0.45)",
  color: palette.danger,
};

/** 实心危险按钮（确认对话框的破坏性操作） */
export const solidDangerPillButton: CSSProperties = {
  ...basePillButton,
  background: palette.danger,
  color: "#fff",
  boxShadow: "0 4px 14px rgba(229, 83, 75, 0.3)",
};

const baseSmallPillButton: CSSProperties = {
  ...basePillButton,
  minHeight: 28,
  padding: "6px 11px",
  fontSize: 11,
  letterSpacing: 0,
};

/** 卡片内小按钮三件套 */
export const smallPrimaryPillButton: CSSProperties = {
  ...baseSmallPillButton,
  background: palette.accent,
  color: "#fff",
};
export const smallSecondaryPillButton: CSSProperties = {
  ...baseSmallPillButton,
  background: "#fff",
  border: `1px solid ${palette.hairline}`,
  color: palette.ink,
};
export const smallDangerPillButton: CSSProperties = {
  ...baseSmallPillButton,
  background: "#fff",
  border: "1px solid rgba(229, 83, 75, 0.4)",
  color: palette.danger,
};

// ──────────────────────────────────────────────
// 卡片与文字（面板内容通用）
// ──────────────────────────────────────────────

/** 亮面板上的内容卡片 */
export const cardStyle: CSSProperties = {
  background: palette.card,
  border: `1px solid ${palette.hairline}`,
  borderRadius: 14,
};

/** 卡片/列表条目标题 */
export const itemTitleStyle: CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: palette.ink,
  fontSize: 13,
  fontWeight: 600,
};

/** 等宽小字（id / 位置信息） */
export const itemMetaStyle: CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: palette.inkFaint,
  font: "10px/1.3 monospace",
};

/** 空态容器与标题 */
export const emptyStateStyle: CSSProperties = {
  minHeight: 260,
  display: "grid",
  placeItems: "center",
  color: palette.inkSoft,
};
export const emptyTitleStyle: CSSProperties = { color: palette.ink, fontSize: 17 };
