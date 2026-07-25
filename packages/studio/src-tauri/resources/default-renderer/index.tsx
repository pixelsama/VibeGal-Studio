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
  name: "默认渲染层",
  contractVersion: 1,
  capabilities: ["player-ui-v1", "gallery-ui-v1", "layout-parts-v1"],
  appearance: { groups: appearanceGroups },
  description: "现代扁平二次元风：磨砂白对话框 + 樱粉点缀 + 全套玩家面板的默认实现",
  Component: Stage,
};

export default defaultRenderer;
