import { describe, expect, it } from "vitest";
import { localizeInstruction, resolveLocalizedText } from "./localization";

const tables = {
  "zh-CN": { "opening.hello": "早上好。" },
  en: { "opening.hello": "Good morning." },
};

describe("localization", () => {
  it("uses the current locale before the default locale", () => {
    expect(resolveLocalizedText({
      text: "原文",
      textKey: "opening.hello",
      currentLocale: "en",
      defaultLocale: "zh-CN",
      tables,
    })).toBe("Good morning.");
  });

  it("falls back through the default locale to inline source text", () => {
    expect(resolveLocalizedText({
      text: "原文",
      textKey: "opening.hello",
      currentLocale: "ja",
      defaultLocale: "zh-CN",
      tables,
    })).toBe("早上好。");
    expect(resolveLocalizedText({
      text: "原文",
      textKey: "opening.missing",
      currentLocale: "ja",
      defaultLocale: "zh-CN",
      tables,
    })).toBe("原文");
  });

  it("keeps old unkeyed instructions unchanged", () => {
    const instruction = { t: "narrate", text: "原文" } as const;
    expect(localizeInstruction(instruction, {
      currentLocale: "en",
      defaultLocale: "zh-CN",
      tables,
    })).toBe(instruction);
  });
});
