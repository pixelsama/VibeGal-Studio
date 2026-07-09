import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CenteredMessage } from "./CenteredMessage";

describe("CenteredMessage", () => {
  it("keeps long diagnostic messages scrollable instead of clipping them", () => {
    const html = renderToStaticMarkup(createElement(
      CenteredMessage,
      { mono: true },
      "Unsupported renderer bare import:\n\n".repeat(20),
    ));

    expect(html).toContain("overflow:auto");
    expect(html).toContain("margin:auto");
    expect(html).toContain("white-space:pre-wrap");
    expect(html).toContain("ui-monospace");
  });
});
