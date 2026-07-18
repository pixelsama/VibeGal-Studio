/**
 * useUiTokens —— 外观设计 token 解析（Spec 17 第 4 节 token 协议）。
 *
 * 渲染层从 manifest.uiSkins 读取外观 token，把扁平的点号 key
 * （如 "dialogueBox.x"）解析成带默认值的结构化对象。所有 key 可选，
 * 缺失时回退到 DEFAULT_UI_TOKENS —— 即内置的现代扁平二次元设计
 * （磨砂白 + 樱粉点缀，见 uiTheme.ts）。
 *
 * skin 选择规则（已定点）：取 id 为 "default" 的 uiSkin；注册表没有
 * "default" 时回退到第一个条目并 console.warn 提示；两者都没有 → 全默认。
 *
 * 几何语义：舞台左上角原点，x/y = 部件左上角，单位 = 舞台坐标 px
 * （默认值按 1280×720 舞台标定）。可拖拽部件（data-ui-part）：
 * dialogueBox / nameBox / choiceBox / hud / menuWindow。
 */
import { useMemo } from "react";
import type { Manifest } from "@vibegal/engine";
import { palette, SANS_FONT } from "./uiTheme";

export interface DialogueBoxTokens {
  x: number;
  y: number;
  width: number;
  height: number;
  /** null = 内置磨砂白背景（含 backdrop 模糊）；设置后替换为纯色（或配合 bgOpacity） */
  bgColor: string | null;
  /** 0..1，仅在与 bgColor 搭配时生效（color-mix） */
  bgOpacity: number | null;
  radius: number;
  /** CSS padding；数值 token 按 px 处理 */
  padding: string;
  /** null = 内置发丝白边 */
  borderColor: string | null;
  textColor: string;
  fontSize: number;
  fontFamily: string;
  /** px（默认 23px × 1.8 = 41.4px） */
  lineHeight: number;
}

export interface NameBoxTokens {
  x: number;
  y: number;
  /** null = auto（随名字内容撑开）；拖拽缩放后写回具体 px */
  width: number | null;
  height: number | null;
  /** null = 跟随说话人颜色 */
  bgColor: string | null;
  textColor: string;
  fontSize: number;
  visible: boolean;
}

export interface ChoiceBoxTokens {
  x: number;
  y: number;
  width: number;
  /** null = 自动（约 42% 舞台高的 maxHeight）；设置后按 px 限高 */
  height: number | null;
}

export interface ChoiceButtonTokens {
  bgColor: string;
  textColor: string;
  hoverColor: string;
  hoverTextColor: string;
  radius: number;
  fontSize: number;
}

export interface HudTokens {
  /** null = 内置右上锚定（右缘 16px）；拖拽后写回具体舞台 x */
  x: number | null;
  /** null = 内置顶部 14px；拖拽后写回具体舞台 y */
  y: number | null;
  textColor: string;
  /** 作用于整条胶囊底色；激活态（自动/跳过 ON）保留内置樱粉反馈 */
  bgColor: string;
  fontSize: number;
  visible: boolean;
}

export interface MenuWindowTokens {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface UiTokens {
  dialogueBox: DialogueBoxTokens;
  nameBox: NameBoxTokens;
  choiceBox: ChoiceBoxTokens;
  choiceButton: ChoiceButtonTokens;
  hud: HudTokens;
  menuWindow: MenuWindowTokens;
  stageFontFamily: string;
}

/**
 * 默认值表 = 内置设计（1280×720 舞台坐标标定）：
 * - 对话框：底边距 48 的宽条（x=77.08 / y=497 / 1125.84×175），磨砂白 + 顶部
 *   樱粉→天蓝渐变条 + 右下角继续指示。
 * - 名字框：胶囊，压在对话框顶边左侧（x=对话框内缩 32，y=顶边上移 18），
 *   底色跟随说话人颜色。
 * - 选项区：舞台上中部 480px 宽竖列（y=170），按钮是磨砂白胶囊。
 * - HUD：右上角胶囊条（右缘 16 / 顶 14）；x/y token 缺省 = 锚定模式。
 * - 菜单窗口：1060×640，居中偏上（110, 40）。
 * - lineHeight：23px × 1.8 = 41.4px。
 */
export const DEFAULT_UI_TOKENS: UiTokens = {
  dialogueBox: {
    x: 77.08,
    y: 497,
    width: 1125.84,
    height: 175,
    bgColor: null,
    bgOpacity: null,
    radius: 18,
    padding: "24px 32px 28px",
    borderColor: null,
    textColor: palette.ink,
    fontSize: 23,
    fontFamily: SANS_FONT,
    lineHeight: 41.4,
  },
  nameBox: {
    x: 109.08,
    y: 479,
    width: null,
    height: null,
    bgColor: null,
    textColor: "#ffffff",
    fontSize: 17,
    visible: true,
  },
  choiceBox: {
    x: 400,
    y: 170,
    width: 480,
    height: null,
  },
  choiceButton: {
    bgColor: "rgba(255, 255, 255, 0.9)",
    textColor: palette.ink,
    hoverColor: palette.accent,
    hoverTextColor: "#ffffff",
    radius: 14,
    fontSize: 16,
  },
  hud: {
    x: null,
    y: null,
    textColor: "#ffffff",
    bgColor: "rgba(18, 20, 30, 0.45)",
    fontSize: 12,
    visible: true,
  },
  menuWindow: {
    x: 110,
    y: 40,
    width: 1060,
    height: 640,
  },
  stageFontFamily: SANS_FONT,
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
      bgColor: tokenStringOrNull(tokens, "nameBox.bgColor"),
      textColor: tokenString(tokens, "nameBox.textColor", defaults.nameBox.textColor),
      fontSize: tokenNumber(tokens, "nameBox.fontSize", defaults.nameBox.fontSize),
      visible: tokenVisible(tokens, "nameBox.visible", defaults.nameBox.visible),
    },
    choiceBox: {
      x: tokenNumber(tokens, "choiceBox.x", defaults.choiceBox.x),
      y: tokenNumber(tokens, "choiceBox.y", defaults.choiceBox.y),
      width: tokenNumber(tokens, "choiceBox.width", defaults.choiceBox.width),
      height: tokenNumberOrNull(tokens, "choiceBox.height"),
    },
    choiceButton: {
      bgColor: choiceBgColor,
      textColor: tokenString(tokens, "choiceButton.textColor", defaults.choiceButton.textColor),
      hoverColor: tokenString(tokens, "choiceButton.hoverColor", defaults.choiceButton.hoverColor),
      // 未单独设置 hoverTextColor 时跟随默认（悬停白字）
      hoverTextColor: tokenString(tokens, "choiceButton.hoverTextColor", defaults.choiceButton.hoverTextColor),
      radius: tokenNumber(tokens, "choiceButton.radius", defaults.choiceButton.radius),
      fontSize: tokenNumber(tokens, "choiceButton.fontSize", defaults.choiceButton.fontSize),
    },
    hud: {
      x: tokenNumberOrNull(tokens, "hud.x"),
      y: tokenNumberOrNull(tokens, "hud.y"),
      textColor: tokenString(tokens, "hud.textColor", defaults.hud.textColor),
      bgColor: tokenString(tokens, "hud.bgColor", defaults.hud.bgColor),
      fontSize: tokenNumber(tokens, "hud.fontSize", defaults.hud.fontSize),
      visible: tokenVisible(tokens, "hud.visible", defaults.hud.visible),
    },
    menuWindow: {
      x: tokenNumber(tokens, "menuWindow.x", defaults.menuWindow.x),
      y: tokenNumber(tokens, "menuWindow.y", defaults.menuWindow.y),
      width: tokenNumber(tokens, "menuWindow.width", defaults.menuWindow.width),
      height: tokenNumber(tokens, "menuWindow.height", defaults.menuWindow.height),
    },
    stageFontFamily: tokenString(tokens, "stage.fontFamily", defaults.stageFontFamily),
  };
}

export function useUiTokens(manifest: Manifest): UiTokens {
  return useMemo(() => resolveUiTokens(manifest), [manifest]);
}
