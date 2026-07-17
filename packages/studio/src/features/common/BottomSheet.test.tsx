import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BottomSheet } from "./BottomSheet";

describe("BottomSheet", () => {
  it("renders expanded by default: body visible above the bottom bar", () => {
    const html = renderToStaticMarkup(createElement(BottomSheet, {
      title: "节点摘要",
      expandedHeight: "48%",
    }, createElement("div", null, "表单内容")));

    expect(html).toContain('data-region="bottom-sheet"');
    expect(html).toContain('data-sheet-state="expanded"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("节点摘要");
    expect(html).toContain("表单内容");
    expect(html).toContain("height:48%");
    expect(html).toContain("visibility:visible");
    // 标题栏在折叠内容上方（折叠时栏随面板沉到底边）
    expect(html.indexOf("gs-bottom-sheet-bar")).toBeLessThan(html.indexOf("bottom-sheet-body"));
  });

  it("collapses to just the bottom bar when defaultExpanded is false", () => {
    const html = renderToStaticMarkup(createElement(BottomSheet, {
      title: "Runtime",
      expandedHeight: "min(300px, 60%)",
      defaultExpanded: false,
    }, createElement("div", null, "状态内容")));

    expect(html).toContain('data-sheet-state="collapsed"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Runtime");
    // 折叠后只剩标题栏高度，内容区沉到底并隐藏
    expect(html).toContain("height:33px");
    expect(html).toContain("visibility:hidden");
  });
});
