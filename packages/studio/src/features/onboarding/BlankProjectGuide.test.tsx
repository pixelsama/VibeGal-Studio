import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BlankProjectGuide } from "./BlankProjectGuide";
import { StudioI18nProvider } from "../../lib/i18n";

describe("BlankProjectGuide", () => {
  it("shows three actionable creator steps and a local skip action", () => {
    const html = renderToStaticMarkup(
      <BlankProjectGuide
        written={false}
        backgroundImported={true}
        previewConfirmed={false}
        onWrite={() => {}}
        onImportBackground={() => {}}
        onPreview={() => {}}
        onSkip={() => {}}
      />,
    );

    expect(html).toContain('aria-label="新项目三步引导"');
    expect(html).toContain("写第一个节点");
    expect(html).toContain("导入一张背景");
    expect(html).toContain("试演");
    expect(html).toContain("打开起始节点");
    expect(html).toContain("再次导入背景");
    expect(html).toContain("开始试演");
    expect(html).toContain("暂时跳过");
  });

  it("renders the new-project guide in English", () => {
    const html = renderToStaticMarkup(
      <StudioI18nProvider preference="en">
        <BlankProjectGuide
          written={false}
          backgroundImported
          previewConfirmed={false}
          onWrite={() => {}}
          onImportBackground={() => {}}
          onPreview={() => {}}
          onSkip={() => {}}
        />
      </StudioI18nProvider>,
    );

    expect(html).toContain('aria-label="Three-step new-project guide"');
    expect(html).toContain("Write the first node");
    expect(html).toContain("Import background again");
    expect(html).toContain("Start rehearsal");
    expect(html).toContain("Skip for now");
    expect(html).not.toContain("写第一个节点");
  });
});
