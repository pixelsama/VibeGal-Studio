import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StudioI18nProvider } from "../../lib/i18n";
import type { Manifest } from "../../lib/types";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

import { CharacterEditor } from "./CharacterEditor";

const withHero: Manifest = {
  characters: {
    hero: { name: "主角", color: "#fff", sprites: { default: "assets/characters/hero.svg" } },
  },
  backgrounds: {},
  audio: { bgm: {}, sfx: {}, voice: {} },
};

const empty: Manifest = {
  characters: {},
  backgrounds: {},
  audio: { bgm: {}, sfx: {}, voice: {} },
};

const noop = () => {};

describe("CharacterEditor gallery (spec 33 E7/§6.3)", () => {
  it("shows a character card grid instead of a full-screen editor", () => {
    const html = renderToStaticMarkup(createElement(
      StudioI18nProvider,
      { preference: "zh-CN" },
      createElement(CharacterEditor, {
        projectPath: "/tmp/project",
        manifest: withHero,
        onChange: noop,
      }),
    ));

    // 角色以卡片形式存在（角色名可见），编辑表单不直接出现
    expect(html).toContain("主角");
    expect(html).not.toContain("表情资源");
    expect(html).not.toContain("基本信息");
  });

  it("offers the empty state with a create-first action when no characters exist", () => {
    const html = renderToStaticMarkup(createElement(
      StudioI18nProvider,
      { preference: "zh-CN" },
      createElement(CharacterEditor, {
        projectPath: "/tmp/project",
        manifest: empty,
        onChange: noop,
      }),
    ));

    expect(html).toContain("还没有角色");
    expect(html).toContain("新建第一个角色");
  });
});
