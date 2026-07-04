import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RendererSidebar } from "./RendererSidebar";

describe("RendererSidebar", () => {
  it("renders the renderer item even when there is only one renderer", () => {
    const html = renderToStaticMarkup(createElement(RendererSidebar, {
      rendererIds: ["default"],
      activeRendererId: "default",
      onSelect: () => {},
    }));

    expect(html).toContain("default");
    expect(html).toContain("aria-current=\"page\"");
  });

  it("marks only the active renderer among multiple renderers", () => {
    const html = renderToStaticMarkup(createElement(RendererSidebar, {
      rendererIds: ["default", "mobile"],
      activeRendererId: "mobile",
      onSelect: () => {},
    }));

    expect(html).toContain("default");
    expect(html).toContain("mobile");
    expect(html).toContain("aria-current=\"page\"");
    expect(html).toContain("data-renderer-id=\"mobile\"");
  });

  it("shows an empty state when no renderer is available", () => {
    const html = renderToStaticMarkup(createElement(RendererSidebar, {
      rendererIds: [],
      activeRendererId: "",
      onSelect: () => {},
    }));

    expect(html).toContain("暂无渲染层");
  });

  it("renders renderer management actions", () => {
    const html = renderToStaticMarkup(createElement(RendererSidebar, {
      rendererIds: ["default"],
      activeRendererId: "default",
      onSelect: () => {},
      onCreate: () => {},
      onDuplicate: () => {},
      onRename: () => {},
      onDelete: () => {},
    }));

    expect(html).toContain("新建");
    expect(html).toContain("复制");
    expect(html).toContain("重命名");
    expect(html).toContain("删除");
  });
});
