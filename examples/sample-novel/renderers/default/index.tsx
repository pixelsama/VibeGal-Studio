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

const defaultRenderer: RendererManifest = {
  id: "default",
  name: "默认渲染层",
  contractVersion: 1,
  capabilities: ["player-ui-v1", "gallery-ui-v1", "layout-parts-v1"],
  description: "现代扁平二次元风：磨砂白对话框 + 樱粉点缀 + 全套玩家面板的默认实现",
  Component: Stage,
};

export default defaultRenderer;
