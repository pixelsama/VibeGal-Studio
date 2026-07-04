import { describe, expect, it } from "vitest";
import { t } from "./i18n";

describe("i18n messages", () => {
  it("provides Chinese workspace labels through stable message keys", () => {
    expect(t("workspace.tab.render")).toBe("渲染");
    expect(t("workspace.tab.script")).toBe("脚本");
    expect(t("workspace.tab.assets")).toBe("资产");
    expect(t("workspace.tab.project")).toBe("项目");
  });
});
