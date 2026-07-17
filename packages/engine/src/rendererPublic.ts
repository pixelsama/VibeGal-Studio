/**
 * 渲染层公共类型入口 —— 仅供 .galstudio 类型声明生成使用。
 *
 * VibeGal-Studio 会把本文件的导出闭包展开成单文件 d.ts，随项目初始化拷入
 * `.galstudio/types/engine.d.ts`，让外部 Agent 在项目目录里直接
 * `tsc --noEmit` 获得渲染层契约的真实类型检查。
 *
 * 只导出渲染层编写需要的契约面；新增渲染层 API 时同步维护这里。
 * 生成脚本：packages/studio/scripts/generate-engine-types.mjs
 */
export * from "./state";
export * from "./renderer";
export type * from "./runtimeContract";
export type * from "./types";
export { resolveAsset } from "./assetPath";
