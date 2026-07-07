import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CollapsibleSidebar } from "./CollapsibleSidebar";

describe("CollapsibleSidebar", () => {
  it("renders the title, expanded state, and children when expanded", () => {
    const html = renderToStaticMarkup(createElement(
      CollapsibleSidebar,
      {
        title: "渲染层",
        collapsed: false,
        onCollapsedChange: () => {},
        expandedWidth: 180,
        collapsedLabel: "渲染层",
      },
      createElement("button", { type: "button" }, "default"),
    ));

    expect(html).toContain("渲染层");
    expect(html).toContain("aria-expanded=\"true\"");
    expect(html).toContain("width:180px");
    expect(html).toContain("lucide-chevron-left");
    expect(html).not.toContain("&lt;");
    expect(html).toContain("default");
  });

  it("keeps a collapsed affordance but hides children when collapsed", () => {
    const html = renderToStaticMarkup(createElement(
      CollapsibleSidebar,
      {
        title: "资产",
        collapsed: true,
        onCollapsedChange: () => {},
        expandedWidth: 132,
        collapsedLabel: "资产",
      },
      createElement("button", { type: "button" }, "背景"),
    ));

    expect(html).toContain("aria-expanded=\"false\"");
    expect(html).toContain("width:44px");
    expect(html).toContain("lucide-chevron-right");
    expect(html).not.toContain("&gt;");
    expect(html).toContain("资产");
    expect(html).not.toContain("背景");
  });
});
