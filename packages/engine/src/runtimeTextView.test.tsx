import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RuntimeTextView, renderRuntimeTextTokens } from "./runtimeTextView";

describe("runtime text view", () => {
  it("renders safe formatting tokens without interpreting text as HTML", () => {
    const html = renderToStaticMarkup(renderRuntimeTextTokens([
      { type: "text", text: "<script>alert(1)</script>", bold: true },
      { type: "pause", ms: 250 },
      { type: "text", text: "世界", color: "#12ABEF", ruby: "せかい" },
    ], "<script>alert(1)</script>世界"));

    expect(html).toContain("<strong>&lt;script&gt;alert(1)&lt;/script&gt;</strong>");
    expect(html).toContain('<span style="color:#12ABEF"><ruby>世界<rt>せかい</rt></ruby></span>');
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("250");
  });

  it("respects typing reveal and supports legacy plain text state", () => {
    expect(renderToStaticMarkup(
      <RuntimeTextView
        text={{
          text: "你好世界",
          typedLen: 3,
          tokens: [
            { type: "text", text: "你好", bold: true },
            { type: "text", text: "世界" },
          ],
        }}
      />,
    )).toBe("<strong>你好</strong>世");

    expect(renderToStaticMarkup(
      <RuntimeTextView text={{ text: "旧文本", typedLen: 2 }} />,
    )).toBe("旧文");
  });
});
