/**
 * @galstudio/engine —— galgame 引擎核心（数据驱动、框架无关）。
 *
 * 公共 API 从这里统一导出。渲染层、开发工具、未来小工具都只 import 本包。
 * 内部实现见各模块；核心三件为 schema（数据契约）/ state（视图契约）/ interpreter（状态机）。
 */
export * from "./schema";
export * from "./types";
export * from "./state";
export * from "./interpreter";
export * from "./player";
export * from "./graphPlayer";
export * from "./graphRouting";
export * from "./AudioEngine";
export * from "./validate";
export * from "./assetPath";
export * from "./renderer";
export * from "./scenario";
