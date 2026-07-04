import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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
};

describe("buildResourcePickerOptions", () => {
  it("filters options by resource kind", () => {
    expect(buildResourcePickerOptions(manifest, { kind: "bgm" }).map((option) => option.value)).toEqual(["theme"]);
    expect(buildResourcePickerOptions(manifest, { kind: "character" }).map((option) => option.value)).toEqual(["hero", "rival"]);
    expect(
      buildResourcePickerOptions(manifest, { kind: "expression", characterId: "hero" }).map((option) => option.value),
    ).toEqual(["default", "happy"]);
  });
});

describe("ResourcePicker", () => {
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
