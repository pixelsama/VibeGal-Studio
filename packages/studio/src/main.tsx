import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// 渲染层运行时编译依赖的 vendor 模块 —— 注入到全局，供编译产物引用（单例）
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as jsxRuntime from "react/jsx-runtime";
import * as engine from "@galstudio/engine";
import "./index.css";
import App from "./App";
import { VENDOR_GLOBAL } from "./features/renderers/runtimeCompiler";

// 注入 vendor 全局表：渲染层编译产物会从这里取 react/engine。
// 单例保证：studio 自己用的 react 与渲染层用的是同一份实例（避免 hooks 跨实例报错）。
(globalThis as unknown as Record<string, unknown>)[VENDOR_GLOBAL] = {
  react: React,
  "react/jsx-runtime": jsxRuntime,
  "react-dom": ReactDOM,
  "react-dom/client": ReactDOMClient,
  "@galstudio/engine": engine,
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
