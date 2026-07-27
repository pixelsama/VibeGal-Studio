/**
 * useUiTokens —— 外观设计 token 解析（Spec 17 第 4 节 token 协议）。
 *
 * 渲染层从 manifest.uiSkins 读取外观 token，把扁平的点号 key
 * （如 "dialogueBox.x"）解析成带默认值的结构化对象。所有 key 可选，
 * 缺失时回退到 DEFAULT_UI_TOKENS —— 即内置的经典深色 ADV 设计
 * （底部深色对话框 + 暖金点缀，见 uiTheme.ts）。
 *
 * skin 选择规则（已定点）：取 id 为 "default" 的 uiSkin；注册表没有
 * "default" 时回退到第一个条目并 console.warn 提示；两者都没有 → 全默认。
 *
 * 几何语义：舞台左上角原点，x/y = 部件左上角，单位 = 舞台坐标 px
 * （默认值按 1280×720 舞台标定）。可拖拽部件（data-ui-part）：
 * dialogueBox / nameBox / choiceBox / hud / menuWindow / titleScreen。
 */
import { useMemo } from "react";
import type { Manifest } from "@vibegal/engine";
import { palette, SANS_FONT } from "./uiTheme";

export interface DialogueBoxTokens {
  x: number;
  y: number;
  width: number;
  height: number;
  /** null = 内置深色半透明背景（含 backdrop 模糊）；设置后替换为纯色（或配合 bgOpacity） */
  bgColor: string | null;
  /** 0..1，仅在与 bgColor 搭配时生效（color-mix） */
  bgOpacity: number | null;
  radius: number;
  /** CSS padding；数值 token 按 px 处理 */
  padding: string;
  /** null = 内置暖金细边 */
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
  /** 作用于整条工具栏底色；激活态（自动/跳过）使用经典暖金反馈 */
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

export interface TitleScreenTokens {
  x: number;
  y: number;
  width: number;
  height: number;
  /** null = 内置暗色玻璃面板底（含 backdrop 模糊）；设置后替换为纯色（或配合 bgOpacity） */
  bgColor: string | null;
  /** 0..1，仅在与 bgColor 搭配时生效（color-mix） */
  bgOpacity: number | null;
  titleColor: string;
  titleFontSize: number;
  titleFontFamily: string;
  buttonBgColor: string;
  buttonTextColor: string;
  buttonHoverColor: string;
  buttonRadius: number;
  buttonFontSize: number;
}

export interface UiTokens {
  dialogueBox: DialogueBoxTokens;
  nameBox: NameBoxTokens;
  choiceBox: ChoiceBoxTokens;
  choiceButton: ChoiceButtonTokens;
  hud: HudTokens;
  menuWindow: MenuWindowTokens;
  titleScreen: TitleScreenTokens;
  stageFontFamily: string;
}

/**
 * 默认值表 = 经典深色 ADV（1280×720 舞台坐标标定）：
 * - 对话框：贴近底边的横向深色窗（24, 500 / 1232×196），细金边、紧凑直角；
 * - 名字框：嵌在对话框左上方的矩形铭牌；
 * - 选项区：舞台偏右的窄列，避免遮挡主要立绘；
 * - HUD：右上角紧凑工具条；
 * - 菜单窗口：侧边导航 + 深色内容区；
 * - 标题画面：右侧纵向标题与菜单，保留左侧主视觉空间。
 */
export const DEFAULT_UI_TOKENS: UiTokens = {
  dialogueBox: {
    x: 24,
    y: 500,
    width: 1232,
    height: 196,
    bgColor: null,
    bgOpacity: null,
    radius: 2,
    padding: "38px 38px 24px",
    borderColor: null,
    textColor: palette.ink,
    fontSize: 22,
    fontFamily: SANS_FONT,
    lineHeight: 39,
  },
  nameBox: {
    x: 52,
    y: 486,
    width: null,
    height: null,
    bgColor: null,
    textColor: "#15161a",
    fontSize: 16,
    visible: true,
  },
  choiceBox: {
    x: 690,
    y: 168,
    width: 520,
    height: null,
  },
  choiceButton: {
    bgColor: "rgba(12, 14, 18, 0.9)",
    textColor: palette.menuText,
    hoverColor: palette.accent,
    hoverTextColor: "#15161a",
    radius: 2,
    fontSize: 16,
  },
  hud: {
    x: null,
    y: null,
    textColor: palette.menuText,
    bgColor: "rgba(8, 9, 12, 0.82)",
    fontSize: 11,
    visible: true,
  },
  menuWindow: {
    x: 76,
    y: 46,
    width: 1128,
    height: 628,
  },
  titleScreen: {
    x: 770,
    y: 72,
    width: 438,
    height: 576,
    bgColor: null,
    bgOpacity: null,
    titleColor: palette.menuText,
    titleFontSize: 42,
    titleFontFamily: SANS_FONT,
    buttonBgColor: "rgba(255, 255, 255, 0.03)",
    buttonTextColor: palette.menuTextSoft,
    buttonHoverColor: palette.accent,
    buttonRadius: 2,
    buttonFontSize: 16,
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

/**
 * skin 选择（已定点规则，tokens 与 assets 共用）：取 id 为 "default" 的 uiSkin；
 * 注册表没有 "default" 时回退到第一个条目并 console.warn；两者都没有 → null。
 */
function selectUiSkin(manifest: Manifest): { tokens?: TokenMap; assets?: Record<string, string> } | null {
  const skins = manifest.uiSkins ?? {};
  const preferred = skins["default"];
  if (preferred) return preferred;
  const firstId = Object.keys(skins)[0];
  if (!firstId) return null;
  console.warn(`[vibegal] manifest.uiSkins 缺少 "default" 皮肤，回退到第一个条目 "${firstId}"。`);
  return skins[firstId];
}

function selectSkinTokens(manifest: Manifest): TokenMap {
  return selectUiSkin(manifest)?.tokens ?? {};
}

/**
 * uiSkin assets 槽位（Spec 21 §6 资产约定）：语义槽位键（如 titleBackground /
 * titleBgm）→ manifest 注册表资产 id 的绑定表。skin 选择规则与 tokens 一致。
 */
export function resolveUiSkinAssets(manifest: Manifest): Record<string, string> {
  return selectUiSkin(manifest)?.assets ?? {};
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
    titleScreen: {
      x: tokenNumber(tokens, "titleScreen.x", defaults.titleScreen.x),
      y: tokenNumber(tokens, "titleScreen.y", defaults.titleScreen.y),
      width: tokenNumber(tokens, "titleScreen.width", defaults.titleScreen.width),
      height: tokenNumber(tokens, "titleScreen.height", defaults.titleScreen.height),
      bgColor: tokenStringOrNull(tokens, "titleScreen.bgColor"),
      bgOpacity: tokenNumberOrNull(tokens, "titleScreen.bgOpacity"),
      titleColor: tokenString(tokens, "titleScreen.titleColor", defaults.titleScreen.titleColor),
      titleFontSize: tokenNumber(tokens, "titleScreen.titleFontSize", defaults.titleScreen.titleFontSize),
      titleFontFamily: tokenString(tokens, "titleScreen.titleFontFamily", defaults.titleScreen.titleFontFamily),
      buttonBgColor: tokenString(tokens, "titleScreen.buttonBgColor", defaults.titleScreen.buttonBgColor),
      buttonTextColor: tokenString(tokens, "titleScreen.buttonTextColor", defaults.titleScreen.buttonTextColor),
      buttonHoverColor: tokenString(tokens, "titleScreen.buttonHoverColor", defaults.titleScreen.buttonHoverColor),
      buttonRadius: tokenNumber(tokens, "titleScreen.buttonRadius", defaults.titleScreen.buttonRadius),
      buttonFontSize: tokenNumber(tokens, "titleScreen.buttonFontSize", defaults.titleScreen.buttonFontSize),
    },
    stageFontFamily: tokenString(tokens, "stage.fontFamily", defaults.stageFontFamily),
  };
}

export function useUiTokens(manifest: Manifest): UiTokens {
  return useMemo(() => resolveUiTokens(manifest), [manifest]);
}
