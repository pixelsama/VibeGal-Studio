/**
 * useUiTokens —— 外观设计 token 解析（Spec 17 第 4 节 token 协议）。
 *
 * 渲染层从 manifest.uiSkins 读取外观 token，把扁平的点号 key
 * （如 "dialogueBox.x"）解析成带默认值的结构化对象。所有 key 可选，
 * 缺失时回退到 DEFAULT_UI_TOKENS —— 即改造前的硬编码视觉（像素级不变）。
 *
 * skin 选择规则（已定点）：取 id 为 "default" 的 uiSkin；注册表没有
 * "default" 时回退到第一个条目并 console.warn 提示；两者都没有 → 全默认。
 *
 * 几何语义：舞台左上角原点，x/y = 部件左上角，单位 = 舞台坐标 px
 * （默认值按 1280×720 舞台换算自原硬编码布局）。
 */
import { useMemo } from "react";
import type { Manifest } from "@vibegal/engine";

export interface DialogueBoxTokens {
  x: number;
  y: number;
  width: number;
  height: number;
  /** null = 内置对白/旁白双渐变（现状）；设置后替换为纯色（或配合 bgOpacity） */
  bgColor: string | null;
  /** 0..1，仅在与 bgColor 搭配时生效（color-mix） */
  bgOpacity: number | null;
  radius: number;
  /** CSS padding；数值 token 按 px 处理 */
  padding: string;
  /** null = 跟随说话人颜色（现状） */
  borderColor: string | null;
  textColor: string;
  fontSize: number;
  fontFamily: string;
  /** px（现状 26px × 1.7 = 44.2px） */
  lineHeight: number;
}

export interface NameBoxTokens {
  x: number;
  y: number;
  /** null = auto（现状：随名字内容撑开）；拖拽缩放后写回具体 px */
  width: number | null;
  height: number | null;
  bgColor: string;
  /** null = 跟随说话人颜色（现状） */
  textColor: string | null;
  fontSize: number;
  visible: boolean;
}

export interface ChoiceButtonTokens {
  bgColor: string;
  textColor: string;
  /** 现状无悬停变色，默认值 = bgColor（悬停无色差） */
  hoverColor: string;
  radius: number;
  fontSize: number;
}

export interface HudTokens {
  textColor: string;
  /** 作用于未激活按钮底色；激活态（自动/跳过 ON）保留内置青色反馈 */
  bgColor: string;
  fontSize: number;
  visible: boolean;
}

export interface UiTokens {
  dialogueBox: DialogueBoxTokens;
  nameBox: NameBoxTokens;
  choiceButton: ChoiceButtonTokens;
  hud: HudTokens;
  stageFontFamily: string;
}

/**
 * 默认值表 = 改造前硬编码视觉（1280×720 舞台坐标换算）：
 * - 对话框：原 wrapper 左右 padding 64 → 内容盒 1152；内盒 width min(1100px, 92%)
 *   → 0.92×1152 = 1059.84（内容盒），+padding 64 +border 2 → 边框盒宽 1125.84；
 *   flex 居中 → x = 64 + (1152-1125.84)/2 = 77.08；底边距 48 → 边框盒底边 y=672；
 *   minHeight 120 + padding 24+28 + border(top 2 + bottom 1) → height=175 → y=497。
 *   （部件几何按 border-box 计，组件已设 boxSizing。数值经 headless Chromium 实测核对。）
 * - 名字框：原相对对话框 padding 盒 left:24/top:-18 → 舞台 x=102.08/y=481；
 *   宽高随内容（auto）。
 * - lineHeight：26px × 1.7 = 44.2px。
 */
export const DEFAULT_UI_TOKENS: UiTokens = {
  dialogueBox: {
    x: 77.08,
    y: 497,
    width: 1125.84,
    height: 175,
    bgColor: null,
    bgOpacity: null,
    radius: 6,
    padding: "24px 32px 28px",
    borderColor: null,
    textColor: "#eef2f7",
    fontSize: 26,
    fontFamily: "'Noto Serif SC', 'Source Han Serif SC', serif",
    lineHeight: 44.2,
  },
  nameBox: {
    x: 102.08,
    y: 481,
    width: null,
    height: null,
    bgColor: "rgba(8,12,22,0.95)",
    textColor: null,
    fontSize: 20,
    visible: true,
  },
  choiceButton: {
    bgColor: "rgba(18, 19, 21, 0.88)",
    textColor: "#fff",
    hoverColor: "rgba(18, 19, 21, 0.88)",
    radius: 5,
    fontSize: 15,
  },
  hud: {
    textColor: "#fff",
    bgColor: "rgba(14, 15, 17, 0.78)",
    fontSize: 12,
    visible: true,
  },
  stageFontFamily: "'Noto Serif SC', serif",
};

type TokenMap = Record<string, string | number>;

function tokenNumber(tokens: TokenMap, key: string, fallback: number): number {
  const value = tokens[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function tokenNumberOrNull(tokens: TokenMap, key: string): number | null {
  const value = tokens[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function tokenString(tokens: TokenMap, key: string, fallback: string): string {
  const value = tokens[key];
  return typeof value === "string" && value !== "" ? value : fallback;
}

function tokenStringOrNull(tokens: TokenMap, key: string): string | null {
  const value = tokens[key];
  return typeof value === "string" && value !== "" ? value : null;
}

/** visible 开关：缺失 = 默认；0 / "0" / "false" / "" = 隐藏；其余真值 = 显示。 */
function tokenVisible(tokens: TokenMap, key: string, fallback: boolean): boolean {
  const value = tokens[key];
  if (value === undefined) return fallback;
  if (typeof value === "number") return value !== 0;
  const normalized = value.trim().toLowerCase();
  return normalized !== "" && normalized !== "0" && normalized !== "false";
}

/** padding：数值按 px 拼；字符串原样用（可写 "24px 32px 28px" 这类复合值）。 */
function tokenPadding(tokens: TokenMap, key: string, fallback: string): string {
  const value = tokens[key];
  if (typeof value === "number" && Number.isFinite(value)) return `${value}px`;
  if (typeof value === "string" && value !== "") return value;
  return fallback;
}

function selectSkinTokens(manifest: Manifest): TokenMap {
  const skins = manifest.uiSkins ?? {};
  const preferred = skins["default"];
  if (preferred) return preferred.tokens ?? {};
  const firstId = Object.keys(skins)[0];
  if (!firstId) return {};
  console.warn(`[vibegal] manifest.uiSkins 缺少 "default" 皮肤，回退到第一个条目 "${firstId}"。`);
  return skins[firstId].tokens ?? {};
}

export function resolveUiTokens(manifest: Manifest): UiTokens {
  const defaults = DEFAULT_UI_TOKENS;
  const tokens = selectSkinTokens(manifest);
  const choiceBgColor = tokenString(tokens, "choiceButton.bgColor", defaults.choiceButton.bgColor);
  return {
    dialogueBox: {
      x: tokenNumber(tokens, "dialogueBox.x", defaults.dialogueBox.x),
      y: tokenNumber(tokens, "dialogueBox.y", defaults.dialogueBox.y),
      width: tokenNumber(tokens, "dialogueBox.width", defaults.dialogueBox.width),
      height: tokenNumber(tokens, "dialogueBox.height", defaults.dialogueBox.height),
      bgColor: tokenStringOrNull(tokens, "dialogueBox.bgColor"),
      bgOpacity: tokenNumberOrNull(tokens, "dialogueBox.bgOpacity"),
      radius: tokenNumber(tokens, "dialogueBox.radius", defaults.dialogueBox.radius),
      padding: tokenPadding(tokens, "dialogueBox.padding", defaults.dialogueBox.padding),
      borderColor: tokenStringOrNull(tokens, "dialogueBox.borderColor"),
      textColor: tokenString(tokens, "dialogueBox.textColor", defaults.dialogueBox.textColor),
      fontSize: tokenNumber(tokens, "dialogueBox.fontSize", defaults.dialogueBox.fontSize),
      fontFamily: tokenString(tokens, "dialogueBox.fontFamily", defaults.dialogueBox.fontFamily),
      lineHeight: tokenNumber(tokens, "dialogueBox.lineHeight", defaults.dialogueBox.lineHeight),
    },
    nameBox: {
      x: tokenNumber(tokens, "nameBox.x", defaults.nameBox.x),
      y: tokenNumber(tokens, "nameBox.y", defaults.nameBox.y),
      width: tokenNumberOrNull(tokens, "nameBox.width"),
      height: tokenNumberOrNull(tokens, "nameBox.height"),
      bgColor: tokenString(tokens, "nameBox.bgColor", defaults.nameBox.bgColor),
      textColor: tokenStringOrNull(tokens, "nameBox.textColor"),
      fontSize: tokenNumber(tokens, "nameBox.fontSize", defaults.nameBox.fontSize),
      visible: tokenVisible(tokens, "nameBox.visible", defaults.nameBox.visible),
    },
    choiceButton: {
      bgColor: choiceBgColor,
      textColor: tokenString(tokens, "choiceButton.textColor", defaults.choiceButton.textColor),
      // 未单独设置 hoverColor 时跟随 bgColor（现状无悬停色差）
      hoverColor: tokenString(tokens, "choiceButton.hoverColor", choiceBgColor),
      radius: tokenNumber(tokens, "choiceButton.radius", defaults.choiceButton.radius),
      fontSize: tokenNumber(tokens, "choiceButton.fontSize", defaults.choiceButton.fontSize),
    },
    hud: {
      textColor: tokenString(tokens, "hud.textColor", defaults.hud.textColor),
      bgColor: tokenString(tokens, "hud.bgColor", defaults.hud.bgColor),
      fontSize: tokenNumber(tokens, "hud.fontSize", defaults.hud.fontSize),
      visible: tokenVisible(tokens, "hud.visible", defaults.hud.visible),
    },
    stageFontFamily: tokenString(tokens, "stage.fontFamily", defaults.stageFontFamily),
  };
}

export function useUiTokens(manifest: Manifest): UiTokens {
  return useMemo(() => resolveUiTokens(manifest), [manifest]);
}
