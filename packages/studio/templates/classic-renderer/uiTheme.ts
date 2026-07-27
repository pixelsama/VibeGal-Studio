import type { CSSProperties } from "react";

/**
 * 经典深色 ADV 视觉语言。
 *
 * 舞台 UI 使用炭黑、暖灰和克制的金色强调；面板保持直角感与清晰分隔，
 * 与 default 的明亮磨砂、樱粉胶囊形成明确差异。
 */
export const palette = {
  accent: "#c8a66a",
  accentSoft: "rgba(200, 166, 106, 0.16)",
  sky: "#829bb5",
  gold: "#d8b978",
  mint: "#6fb99b",
  danger: "#b85c5c",
  ink: "#f1ede4",
  inkSoft: "rgba(241, 237, 228, 0.72)",
  inkFaint: "rgba(241, 237, 228, 0.44)",
  hairline: "rgba(220, 203, 169, 0.2)",
  panelWhite: "rgba(19, 20, 24, 0.97)",
  card: "#202228",
  cardDeep: "#16181d",
  frost: "rgba(12, 14, 18, 0.9)",
  menuSurface: "rgba(12, 14, 18, 0.98)",
  menuCard: "rgba(30, 32, 38, 0.94)",
  menuDeep: "rgba(7, 8, 11, 0.96)",
  menuText: "#f1ede4",
  menuTextSoft: "rgba(241, 237, 228, 0.7)",
  menuTextFaint: "rgba(241, 237, 228, 0.44)",
  menuHairline: "rgba(220, 203, 169, 0.18)",
  titlePanel: "rgba(9, 10, 13, 0.88)",
} as const;

export const SANS_FONT =
  "'Noto Serif SC', 'Songti SC', 'SimSun', Georgia, serif";

const basePillButton: CSSProperties = {
  minHeight: 34,
  borderRadius: 3,
  padding: "8px 16px",
  border: `1px solid ${palette.menuHairline}`,
  fontWeight: 600,
  fontSize: 12,
  lineHeight: 1,
  fontFamily: "inherit",
  letterSpacing: "0.08em",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

export const primaryPillButton: CSSProperties = {
  ...basePillButton,
  background: palette.accent,
  borderColor: palette.accent,
  color: "#121318",
  boxShadow: "0 6px 20px rgba(0, 0, 0, 0.35)",
};

export const secondaryPillButton: CSSProperties = {
  ...basePillButton,
  background: "rgba(255, 255, 255, 0.04)",
  color: palette.menuText,
};

export const dangerPillButton: CSSProperties = {
  ...basePillButton,
  background: "rgba(184, 92, 92, 0.08)",
  borderColor: "rgba(184, 92, 92, 0.55)",
  color: "#e4a7a7",
};

export const solidDangerPillButton: CSSProperties = {
  ...basePillButton,
  background: palette.danger,
  borderColor: palette.danger,
  color: "#fff",
};

const baseSmallPillButton: CSSProperties = {
  ...basePillButton,
  minHeight: 28,
  padding: "6px 11px",
  fontSize: 11,
  letterSpacing: 0,
};

export const smallPrimaryPillButton: CSSProperties = {
  ...baseSmallPillButton,
  background: palette.accent,
  borderColor: palette.accent,
  color: "#121318",
};
export const smallSecondaryPillButton: CSSProperties = {
  ...baseSmallPillButton,
  background: "rgba(255, 255, 255, 0.04)",
  color: palette.menuText,
};
export const smallDangerPillButton: CSSProperties = {
  ...baseSmallPillButton,
  background: "rgba(184, 92, 92, 0.08)",
  borderColor: "rgba(184, 92, 92, 0.5)",
  color: "#e4a7a7",
};

export const cardStyle: CSSProperties = {
  background: palette.menuCard,
  border: `1px solid ${palette.menuHairline}`,
  borderRadius: 4,
};

export const itemTitleStyle: CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: palette.menuText,
  fontSize: 13,
  fontWeight: 600,
};

export const itemMetaStyle: CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: palette.menuTextFaint,
  font: "10px/1.3 monospace",
};

export const emptyStateStyle: CSSProperties = {
  minHeight: 260,
  display: "grid",
  placeItems: "center",
  color: palette.menuTextSoft,
};
export const emptyTitleStyle: CSSProperties = { color: palette.menuText, fontSize: 17 };
