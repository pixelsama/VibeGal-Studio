import { createElement } from "react";
import { FolderOpen } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders icon, title, description and action", () => {
    const html = renderToStaticMarkup(createElement(
      EmptyState,
      {
        icon: FolderOpen,
        title: "还没有项目",
        description: "打开或新建一个项目",
        action: createElement("button", null, "新建项目"),
      },
    ));

    expect(html).toContain("gs-empty");
    expect(html).toContain("gs-empty__icon");
    expect(html).toContain("还没有项目");
    expect(html).toContain("打开或新建一个项目");
    expect(html).toContain("gs-empty__actions");
    expect(html).toContain("新建项目");
  });

  it("omits description and action blocks when not provided", () => {
    const html = renderToStaticMarkup(createElement(EmptyState, { icon: FolderOpen, title: "空" }));

    expect(html).toContain("空");
    expect(html).not.toContain("gs-empty__desc");
    expect(html).not.toContain("gs-empty__actions");
  });
});
