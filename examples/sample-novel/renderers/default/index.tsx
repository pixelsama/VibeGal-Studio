/**
 * 默认渲染层 —— 模板实现。
 *
 * 这是新建项目时复制进 项目/renderers/default/ 的模板。
 * 之后用户/AI 可在项目内自由改写，引擎与剧本不动。
 *
 * 每个渲染层目录必须导出一个 RendererManifest。
 */
import type { RendererManifest } from "@galstudio/engine";
import { Stage } from "./Stage";

const defaultRenderer: RendererManifest = {
  id: "default",
  name: "默认渲染层",
  description: "衬线对话框 + 中央立绘 + 渐变背景的默认实现",
  Component: Stage,
};

export default defaultRenderer;
