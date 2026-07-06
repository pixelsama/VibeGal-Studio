import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Toast } from "./Toast";

describe("Toast", () => {
  it("renders error feedback as a visible alert with a close button", () => {
    const html = renderToStaticMarkup(createElement(Toast, {
      toast: {
        id: 1,
        kind: "error",
        message: "保存 manifest 失败",
        detail: "磁盘文件已被外部修改，当前草稿已保留。",
      },
      onClose: () => {},
    }));

    expect(html).toContain("role=\"alert\"");
    expect(html).toContain("保存 manifest 失败");
    expect(html).toContain("当前草稿已保留");
    expect(html).toContain("aria-label=\"关闭消息\"");
  });

  it("renders non-error feedback as status messages", () => {
    const html = renderToStaticMarkup(createElement(Toast, {
      toast: {
        id: 2,
        kind: "success",
        message: "已导入 2 个资源",
      },
      onClose: () => {},
    }));

    expect(html).toContain("role=\"status\"");
    expect(html).toContain("已导入 2 个资源");
  });
});
