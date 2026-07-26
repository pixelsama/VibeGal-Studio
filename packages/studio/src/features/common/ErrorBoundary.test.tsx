import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

describe("ErrorBoundary", () => {
  it("无异常时原样渲染子树", () => {
    const html = renderToStaticMarkup(
      createElement(ErrorBoundary, null, createElement("span", null, "workspace-content")),
    );
    expect(html).toContain("workspace-content");
    expect(html).not.toContain("role=\"alert\"");
  });

  it("getDerivedStateFromError 把异常写入 state", () => {
    const error = new Error("Cannot read properties of undefined (reading 'endings')");
    expect(ErrorBoundary.getDerivedStateFromError(error)).toEqual({ error });
  });

  it("出错时降级为错误面板（不再渲染子树，保留重新加载出口）", () => {
    const error = new Error("Cannot read properties of undefined (reading 'endings')");
    const boundary = new ErrorBoundary({
      title: "工作区渲染出错",
      children: createElement("span", null, "workspace-content"),
    });
    // 模拟 React 在捕获渲染异常后写入的 state（实例字段可写，readonly 仅是类型层约束）
    Object.assign(boundary, { state: { error } });

    const html = renderToStaticMarkup(boundary.render() as ReactElement);

    expect(html).toContain("role=\"alert\"");
    expect(html).toContain("工作区渲染出错");
    expect(html).toContain("endings");
    expect(html).toContain("重新加载");
    expect(html).not.toContain("workspace-content");
  });

  it("未提供 title 时使用默认标题", () => {
    const boundary = new ErrorBoundary({});
    Object.assign(boundary, { state: { error: new Error("boom") } });
    const html = renderToStaticMarkup(boundary.render() as ReactElement);
    expect(html).toContain("界面渲染出错");
  });
});
