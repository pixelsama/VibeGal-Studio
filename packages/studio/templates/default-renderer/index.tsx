/**
 * 默认渲染层 —— 模板实现。
 *
 * 这是新建项目时复制进 项目/renderers/default/ 的模板。
 * 之后用户/外部工具可在项目内自由改写，引擎与剧本不动。
 *
 * 每个渲染层目录必须导出一个 RendererManifest。
 */
import type { RendererManifest } from "@vibegal/engine";
import { Stage } from "./Stage";
import { palette } from "./uiTheme";
import { DEFAULT_UI_TOKENS } from "./useUiTokens";

const appearanceDefaults = {
  "dialogueBox.x": DEFAULT_UI_TOKENS.dialogueBox.x,
  "dialogueBox.y": DEFAULT_UI_TOKENS.dialogueBox.y,
  "dialogueBox.width": DEFAULT_UI_TOKENS.dialogueBox.width,
  "dialogueBox.height": DEFAULT_UI_TOKENS.dialogueBox.height,
  "dialogueBox.bgColor": palette.frost,
  "dialogueBox.radius": DEFAULT_UI_TOKENS.dialogueBox.radius,
  "dialogueBox.padding": DEFAULT_UI_TOKENS.dialogueBox.padding,
  "dialogueBox.borderColor": "rgba(255, 255, 255, 0.65)",
  "dialogueBox.textColor": DEFAULT_UI_TOKENS.dialogueBox.textColor,
  "dialogueBox.fontSize": DEFAULT_UI_TOKENS.dialogueBox.fontSize,
  "dialogueBox.fontFamily": DEFAULT_UI_TOKENS.dialogueBox.fontFamily,
  "dialogueBox.lineHeight": DEFAULT_UI_TOKENS.dialogueBox.lineHeight,
  "nameBox.x": DEFAULT_UI_TOKENS.nameBox.x,
  "nameBox.y": DEFAULT_UI_TOKENS.nameBox.y,
  "nameBox.textColor": DEFAULT_UI_TOKENS.nameBox.textColor,
  "nameBox.fontSize": DEFAULT_UI_TOKENS.nameBox.fontSize,
  "nameBox.visible": 1,
  "choiceBox.x": DEFAULT_UI_TOKENS.choiceBox.x,
  "choiceBox.y": DEFAULT_UI_TOKENS.choiceBox.y,
  "choiceBox.width": DEFAULT_UI_TOKENS.choiceBox.width,
  "choiceButton.bgColor": DEFAULT_UI_TOKENS.choiceButton.bgColor,
  "choiceButton.textColor": DEFAULT_UI_TOKENS.choiceButton.textColor,
  "choiceButton.hoverColor": DEFAULT_UI_TOKENS.choiceButton.hoverColor,
  "choiceButton.hoverTextColor": DEFAULT_UI_TOKENS.choiceButton.hoverTextColor,
  "choiceButton.radius": DEFAULT_UI_TOKENS.choiceButton.radius,
  "choiceButton.fontSize": DEFAULT_UI_TOKENS.choiceButton.fontSize,
  "hud.textColor": DEFAULT_UI_TOKENS.hud.textColor,
  "hud.bgColor": DEFAULT_UI_TOKENS.hud.bgColor,
  "hud.fontSize": DEFAULT_UI_TOKENS.hud.fontSize,
  "hud.visible": 1,
  "menuWindow.x": DEFAULT_UI_TOKENS.menuWindow.x,
  "menuWindow.y": DEFAULT_UI_TOKENS.menuWindow.y,
  "menuWindow.width": DEFAULT_UI_TOKENS.menuWindow.width,
  "menuWindow.height": DEFAULT_UI_TOKENS.menuWindow.height,
  "titleScreen.x": DEFAULT_UI_TOKENS.titleScreen.x,
  "titleScreen.y": DEFAULT_UI_TOKENS.titleScreen.y,
  "titleScreen.width": DEFAULT_UI_TOKENS.titleScreen.width,
  "titleScreen.height": DEFAULT_UI_TOKENS.titleScreen.height,
  "titleScreen.bgColor": palette.titlePanel,
  "titleScreen.titleColor": DEFAULT_UI_TOKENS.titleScreen.titleColor,
  "titleScreen.titleFontSize": DEFAULT_UI_TOKENS.titleScreen.titleFontSize,
  "titleScreen.titleFontFamily": DEFAULT_UI_TOKENS.titleScreen.titleFontFamily,
  "titleScreen.buttonBgColor": DEFAULT_UI_TOKENS.titleScreen.buttonBgColor,
  "titleScreen.buttonTextColor": DEFAULT_UI_TOKENS.titleScreen.buttonTextColor,
  "titleScreen.buttonHoverColor": DEFAULT_UI_TOKENS.titleScreen.buttonHoverColor,
  "titleScreen.buttonRadius": DEFAULT_UI_TOKENS.titleScreen.buttonRadius,
  "titleScreen.buttonFontSize": DEFAULT_UI_TOKENS.titleScreen.buttonFontSize,
  "stage.fontFamily": DEFAULT_UI_TOKENS.stageFontFamily,
} as const;

const appearanceGroups = [
  {
    id: "dialogueBox",
    label: "对话框",
    parts: ["dialogueBox"],
    controls: [
      { key: "dialogueBox.x", label: "X", kind: "number", step: 1 },
      { key: "dialogueBox.y", label: "Y", kind: "number", step: 1 },
      { key: "dialogueBox.width", label: "宽", kind: "number", min: 0, step: 1 },
      { key: "dialogueBox.height", label: "高", kind: "number", min: 0, step: 1 },
      { key: "dialogueBox.bgColor", label: "背景色", kind: "color" },
      { key: "dialogueBox.bgOpacity", label: "不透明度", kind: "number", min: 0, max: 1, step: 0.05 },
      { key: "dialogueBox.radius", label: "圆角", kind: "number", min: 0, step: 1 },
      { key: "dialogueBox.padding", label: "内边距", kind: "text" },
      { key: "dialogueBox.borderColor", label: "边框色", kind: "color" },
      { key: "dialogueBox.textColor", label: "文字色", kind: "color" },
      { key: "dialogueBox.fontSize", label: "字号", kind: "number", min: 1, step: 1 },
      { key: "dialogueBox.fontFamily", label: "字体", kind: "font" },
      { key: "dialogueBox.lineHeight", label: "行高", kind: "number", min: 1, step: 0.5 },
    ],
  },
  {
    id: "nameBox",
    label: "名字框",
    parts: ["nameBox"],
    controls: [
      { key: "nameBox.x", label: "X", kind: "number", step: 1 },
      { key: "nameBox.y", label: "Y", kind: "number", step: 1 },
      { key: "nameBox.width", label: "宽", kind: "number", min: 0, step: 1 },
      { key: "nameBox.height", label: "高", kind: "number", min: 0, step: 1 },
      { key: "nameBox.bgColor", label: "背景色", kind: "color" },
      { key: "nameBox.textColor", label: "文字色", kind: "color" },
      { key: "nameBox.fontSize", label: "字号", kind: "number", min: 1, step: 1 },
      { key: "nameBox.visible", label: "显示", kind: "checkbox" },
    ],
  },
  {
    id: "choiceBox",
    label: "选项区",
    parts: ["choiceBox"],
    controls: [
      { key: "choiceBox.x", label: "X", kind: "number", step: 1 },
      { key: "choiceBox.y", label: "Y", kind: "number", step: 1 },
      { key: "choiceBox.width", label: "宽", kind: "number", min: 0, step: 1 },
      { key: "choiceBox.height", label: "限高", kind: "number", min: 0, step: 1 },
    ],
  },
  {
    id: "choiceButton",
    label: "选项按钮",
    parts: ["choiceBox"],
    controls: [
      { key: "choiceButton.bgColor", label: "背景色", kind: "color" },
      { key: "choiceButton.textColor", label: "文字色", kind: "color" },
      { key: "choiceButton.hoverColor", label: "悬停色", kind: "color" },
      { key: "choiceButton.hoverTextColor", label: "悬停文字色", kind: "color" },
      { key: "choiceButton.radius", label: "圆角", kind: "number", min: 0, step: 1 },
      { key: "choiceButton.fontSize", label: "字号", kind: "number", min: 1, step: 1 },
    ],
  },
  {
    id: "hud",
    label: "HUD",
    parts: ["hud"],
    controls: [
      { key: "hud.x", label: "X", kind: "number", step: 1 },
      { key: "hud.y", label: "Y", kind: "number", step: 1 },
      { key: "hud.textColor", label: "文字色", kind: "color" },
      { key: "hud.bgColor", label: "底色", kind: "color" },
      { key: "hud.fontSize", label: "字号", kind: "number", min: 1, step: 1 },
      { key: "hud.visible", label: "显示", kind: "checkbox" },
    ],
  },
  {
    id: "menuWindow",
    label: "菜单窗口",
    parts: ["menuWindow"],
    controls: [
      { key: "menuWindow.x", label: "X", kind: "number", step: 1 },
      { key: "menuWindow.y", label: "Y", kind: "number", step: 1 },
      { key: "menuWindow.width", label: "宽", kind: "number", min: 0, step: 1 },
      { key: "menuWindow.height", label: "高", kind: "number", min: 0, step: 1 },
    ],
  },
  {
    id: "titleScreen",
    label: "标题画面",
    parts: ["titleScreen"],
    controls: [
      { key: "titleScreen.x", label: "X", kind: "number", step: 1 },
      { key: "titleScreen.y", label: "Y", kind: "number", step: 1 },
      { key: "titleScreen.width", label: "宽", kind: "number", min: 0, step: 1 },
      { key: "titleScreen.height", label: "高", kind: "number", min: 0, step: 1 },
      { key: "titleScreen.bgColor", label: "背景色", kind: "color" },
      { key: "titleScreen.bgOpacity", label: "不透明度", kind: "number", min: 0, max: 1, step: 0.05 },
      { key: "titleScreen.titleColor", label: "标题色", kind: "color" },
      { key: "titleScreen.titleFontSize", label: "标题字号", kind: "number", min: 1, step: 1 },
      { key: "titleScreen.titleFontFamily", label: "标题字体", kind: "font" },
    ],
  },
  {
    id: "titleScreenButton",
    label: "标题按钮",
    parts: ["titleScreen"],
    controls: [
      { key: "titleScreen.buttonBgColor", label: "背景色", kind: "color" },
      { key: "titleScreen.buttonTextColor", label: "文字色", kind: "color" },
      { key: "titleScreen.buttonHoverColor", label: "悬停色", kind: "color" },
      { key: "titleScreen.buttonRadius", label: "圆角", kind: "number", min: 0, step: 1 },
      { key: "titleScreen.buttonFontSize", label: "字号", kind: "number", min: 1, step: 1 },
    ],
  },
  {
    id: "stage",
    label: "舞台",
    controls: [{ key: "stage.fontFamily", label: "全局字体", kind: "font" }],
  },
] as const;

const defaultRenderer: RendererManifest = {
  id: "default",
  name: "默认界面风格",
  contractVersion: 1,
  capabilities: ["player-ui-v1", "gallery-ui-v1", "layout-parts-v1"],
  appearance: { defaults: appearanceDefaults, groups: appearanceGroups },
  description: "现代扁平二次元风：磨砂白对话框 + 樱粉点缀 + 全套玩家面板的默认实现",
  Component: Stage,
};

export default defaultRenderer;
