import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatStudioMessage,
  normalizeStudioLocale,
  resolveCatalogMessage,
  resolveStudioLocale,
  StudioI18nProvider,
  useStudioI18n,
} from "./i18n";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Studio locale resolution", () => {
  it("normalizes BCP 47 English variants and falls back to zh-CN", () => {
    expect(normalizeStudioLocale("EN-us")).toBe("en");
    expect(normalizeStudioLocale("zh-hans-CN")).toBe("zh-CN");
    expect(normalizeStudioLocale("ja-JP")).toBe("zh-CN");
    expect(normalizeStudioLocale("not a locale")).toBe("zh-CN");
  });

  it("uses the first supported system language and otherwise defaults to zh-CN", () => {
    expect(resolveStudioLocale("system", ["ja-JP", "en-US"])).toBe("en");
    expect(resolveStudioLocale("system", ["zh-Hans-CN", "en-US"])).toBe("zh-CN");
    expect(resolveStudioLocale("system", ["ja-JP"])).toBe("zh-CN");
    expect(resolveStudioLocale("en", ["zh-CN"])).toBe("en");
  });

  it("renders a system-selected locale without reading project localization", () => {
    vi.stubGlobal("navigator", {
      language: "en-US",
      languages: ["en-US", "zh-CN"],
    });
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    function Probe() {
      const { locale, t } = useStudioI18n();
      return <span>{locale}:{t("settings.title")}</span>;
    }

    const html = renderToStaticMarkup(
      <StudioI18nProvider preference="system">
        <Probe />
      </StudioI18nProvider>,
    );

    expect(html).toContain("en:Settings");
  });
});

describe("Studio messages", () => {
  it("interpolates named parameters without relying on Chinese word order", () => {
    expect(formatStudioMessage("Project has {count} issues", { count: 3 })).toBe("Project has 3 issues");
    expect(resolveCatalogMessage("en", "settings.cli.installedAt", { path: "/tmp/bin" }))
      .toBe("Installed at /tmp/bin");
  });

  it("throws for a missing English message in strict development/test mode", () => {
    expect(() => resolveCatalogMessage("en", "nav.back", {}, {
      messages: { "zh-CN": { "nav.back": "后退" }, en: {} },
      strictMissingEnglish: true,
    })).toThrow("Missing English Studio message: nav.back");
  });

  it("falls back to zh-CN for a missing production English message", () => {
    expect(resolveCatalogMessage("en", "nav.back", {}, {
      messages: { "zh-CN": { "nav.back": "后退" }, en: {} },
      strictMissingEnglish: false,
    })).toBe("后退");
  });
});
