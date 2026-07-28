import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StudioI18nProvider } from "../../lib/i18n";
import type { Manifest } from "../../lib/types";
import { ResourcePicker, buildResourcePickerOptions } from "./ResourcePicker";

const manifest: Manifest = {
  characters: {
    hero: {
      name: "Hero",
      color: "#ffffff",
      sprites: {
        default: "assets/characters/hero_default.png",
        happy: "assets/characters/hero_happy.png",
      },
    },
    rival: {
      name: "Rival",
      color: "#ff0088",
      sprites: {
        default: "assets/characters/rival_default.png",
      },
    },
  },
  backgrounds: {
    school: "assets/backgrounds/school.png",
  },
  audio: {
    bgm: {
      theme: "assets/audio/bgm/theme.mp3",
    },
    sfx: {
      click: "assets/audio/sfx/click.wav",
    },
    voice: {
      line01: "assets/audio/voice/line01.ogg",
    },
  },
  cg: {
    cg_001: { path: "assets/cg/cg_001.png", name: "毕业照" },
  },
  videos: {
    op: { path: "assets/videos/op.mp4" },
  },
};

describe("buildResourcePickerOptions", () => {
  it("filters options by resource kind", () => {
    expect(buildResourcePickerOptions(manifest, { kind: "bgm" }).map((option) => option.value)).toEqual(["theme"]);
    expect(buildResourcePickerOptions(manifest, { kind: "character" }).map((option) => option.value)).toEqual(["hero", "rival"]);
    expect(
      buildResourcePickerOptions(manifest, { kind: "expression", characterId: "hero" }).map((option) => option.value),
    ).toEqual(["default", "happy"]);
    expect(buildResourcePickerOptions(manifest, { kind: "cg" })).toEqual([{ value: "cg_001", label: "毕业照" }]);
    expect(buildResourcePickerOptions(manifest, { kind: "video" })).toEqual([{ value: "op", label: "op" }]);
  });
});

describe("ResourcePicker", () => {
  it("localizes picker chrome while preserving project resource values", () => {
    const html = renderToStaticMarkup(createElement(
      StudioI18nProvider,
      { preference: "en" },
      createElement(ResourcePicker, {
        manifest,
        kind: "background",
        value: "幽灵背景",
        onChange: () => {},
      }),
    ));

    expect(html).toContain("Choose background");
    expect(html).toContain("Missing: 幽灵背景");
    expect(html).toContain("background id");
    expect(html).not.toContain("缺失：");
  });

  it("keeps the current missing value visible instead of clearing it", () => {
    const html = renderToStaticMarkup(createElement(ResourcePicker, {
      manifest,
      kind: "background",
      value: "ghost_bg",
      onChange: () => {},
    }));

    expect(html).toContain("ghost_bg");
    expect(html).toContain("缺失");
  });
});
