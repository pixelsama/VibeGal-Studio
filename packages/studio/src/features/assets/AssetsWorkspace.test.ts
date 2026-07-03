import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

import { AssetCard, DanglingCard } from "./AssetCard";
import { AssetsToolbar } from "./AssetsToolbar";
import { CharacterEditor, safeAssetFileStem, spriteExprNameForImport } from "./CharacterEditor";
import {
  AssetsWorkspace,
  applyAssetRegistrations,
  canMutateAssets,
  countRefs,
  deleteAssetAndPruneManifestRefs,
  removeAllRefsToPath,
  removeManifestEntry,
} from "./AssetsWorkspace";
import type { Manifest, ProjectData } from "../../lib/types";

const base: Manifest = {
  characters: {
    hero: { name: "主角", color: "#fff", sprites: { default: "assets/characters/hero.svg" } },
  },
  backgrounds: { sky: "assets/backgrounds/sky.png" },
  audio: { bgm: { theme: "assets/audio/bgm/theme.mp3" }, sfx: {}, voice: {} },
};

describe("applyAssetRegistrations", () => {
  it("把新资产登记到对应子表", () => {
    const next = applyAssetRegistrations(base, [
      { id: "night", path: "assets/backgrounds/night.png", kind: "background" },
      { id: "battle", path: "assets/audio/bgm/battle.mp3", kind: "bgm" },
      { id: "click", path: "assets/audio/sfx/click.wav", kind: "sfx" },
    ]);
    expect(next.backgrounds.night).toBe("assets/backgrounds/night.png");
    expect(next.audio.bgm.battle).toBe("assets/audio/bgm/battle.mp3");
    expect(next.audio.sfx.click).toBe("assets/audio/sfx/click.wav");
  });

  it("同 id 已存在时跳过，不覆盖", () => {
    const next = applyAssetRegistrations(base, [
      { id: "sky", path: "assets/backgrounds/OTHER.png", kind: "background" },
    ]);
    expect(next.backgrounds.sky).toBe("assets/backgrounds/sky.png");
  });

  it("不修改原 manifest（不可变）", () => {
    const before = JSON.parse(JSON.stringify(base));
    applyAssetRegistrations(base, [
      { id: "night", path: "assets/backgrounds/night.png", kind: "background" },
    ]);
    expect(base).toEqual(before);
  });
});

describe("removeManifestEntry", () => {
  it("移除 background 条目", () => {
    const next = removeManifestEntry(base, "backgrounds.sky");
    expect(next.backgrounds.sky).toBeUndefined();
    expect(next.backgrounds).toEqual({});
  });

  it("移除 audio.bgm 条目", () => {
    const next = removeManifestEntry(base, "audio.bgm.theme");
    expect(next.audio.bgm.theme).toBeUndefined();
  });

  it("移除角色的某个 sprite 表情", () => {
    const next = removeManifestEntry(base, "characters.hero.sprites.default");
    expect(next.characters.hero.sprites.default).toBeUndefined();
    expect(next.characters.hero.name).toBe("主角");
  });

  it("未知 source 原样返回", () => {
    const next = removeManifestEntry(base, "unknown.thing");
    expect(next).toEqual(base);
  });
});

describe("countRefs", () => {
  it("统计每个路径被引用的次数", () => {
    const counts = countRefs(base);
    expect(counts.get("assets/backgrounds/sky.png")).toBe(1);
    expect(counts.get("assets/characters/hero.svg")).toBe(1);
    expect(counts.get("assets/audio/bgm/theme.mp3")).toBe(1);
  });

  it("同一文件被多处引用时计数累加", () => {
    const m: Manifest = {
      characters: {},
      backgrounds: { a: "shared.png", b: "shared.png" },
      audio: { bgm: {}, sfx: {}, voice: {} },
    };
    const counts = countRefs(m);
    expect(counts.get("shared.png")).toBe(2);
  });
});

describe("removeAllRefsToPath", () => {
  it("删除资产时同步移除所有指向它的 manifest 引用（含多引用）", () => {
    // hero.svg 同时被角色 default 表情和某 background 引用
    const m: Manifest = {
      characters: {
        hero: { name: "主角", color: "#fff", sprites: { default: "shared.svg", hurt: "other.svg" } },
      },
      backgrounds: { bg: "shared.svg", keep: "keep.png" },
      audio: { bgm: { theme: "shared.svg" }, sfx: {}, voice: {} },
    };
    const next = removeAllRefsToPath(m, "shared.svg");
    // 三处引用全清
    expect(next.backgrounds.bg).toBeUndefined();
    expect(next.characters.hero.sprites.default).toBeUndefined();
    expect(next.audio.bgm.theme).toBeUndefined();
    // 不相关的引用保留
    expect(next.backgrounds.keep).toBe("keep.png");
    expect(next.characters.hero.sprites.hurt).toBe("other.svg");
    // 角色元信息保留
    expect(next.characters.hero.name).toBe("主角");
  });

  it("路径未匹配时 manifest 不变", () => {
    const next = removeAllRefsToPath(base, "nonexistent.png");
    expect(next).toEqual(base);
  });

  it("反斜杠路径也能匹配（Windows 兼容）", () => {
    const m: Manifest = {
      characters: { h: { name: "h", color: "#fff", sprites: { default: "assets/characters/h.svg" } } },
      backgrounds: {},
      audio: { bgm: {}, sfx: {}, voice: {} },
    };
    const next = removeAllRefsToPath(m, "assets\\characters\\h.svg");
    expect(next.characters.h.sprites.default).toBeUndefined();
  });
});

describe("asset mutation guards", () => {
  it("treats invalid manifest as read-only", () => {
    expect(canMutateAssets(false)).toBe(true);
    expect(canMutateAssets(true)).toBe(false);
  });

  it("does not save manifest refs when deleting the asset failed", async () => {
    let saved = false;
    const result = await deleteAssetAndPruneManifestRefs({
      projectPath: "/project",
      relPath: "assets/backgrounds/sky.png",
      manifest: base,
      refCountByPath: countRefs(base),
      deleteAssetFn: async () => {
        throw new Error("permission denied");
      },
      saveManifestFn: async () => {
        saved = true;
      },
    });

    expect(result.deleted).toBe(false);
    expect(result.manifestSaved).toBe(false);
    expect(saved).toBe(false);
  });

  it("saves a pruned manifest only after deleting the asset succeeds", async () => {
    let savedManifest: Manifest | null = null;
    const result = await deleteAssetAndPruneManifestRefs({
      projectPath: "/project",
      relPath: "assets/backgrounds/sky.png",
      manifest: base,
      refCountByPath: countRefs(base),
      deleteAssetFn: async () => {},
      saveManifestFn: async (_projectPath, manifest) => {
        savedManifest = manifest;
      },
    });

    expect(result.deleted).toBe(true);
    expect(result.manifestSaved).toBe(true);
    expect(savedManifest?.backgrounds.sky).toBeUndefined();
  });
});

describe("read-only asset UI", () => {
  it("keeps asset categories visible inside the expanded collapsible sidebar", () => {
    const project: ProjectData = {
      path: "/project",
      meta: { name: "T", activeRendererId: "default", createdAt: "0" },
      content: { manifest: base, meta: {} },
      rendererIds: ["default"],
    };

    const html = renderToStaticMarkup(createElement(AssetsWorkspace, {
      project,
      refreshKey: 0,
      sidebarCollapsed: false,
      onSidebarCollapsedChange: () => {},
      onSaved: () => {},
    }));

    expect(html).toContain("aria-label=\"资产\"");
    expect(html).toContain("总览");
    expect(html).toContain("背景");
  });

  it("disables import controls when the manifest is invalid", () => {
    const html = renderToStaticMarkup(createElement(AssetsToolbar, {
      section: "background",
      search: "",
      onSearch: () => {},
      onImport: () => {},
      count: 0,
      disabled: true,
    }));

    expect(html).toContain("disabled");
    expect(html).toContain("manifest 结构异常");
  });

  it("hides asset mutation buttons in read-only cards", () => {
    const assetHtml = renderToStaticMarkup(createElement(AssetCard, {
      entry: { relPath: "assets/backgrounds/sky.png", size: 1, kind: "background" },
      projectPath: "/project",
      isOrphan: true,
      refCount: 0,
      readOnly: true,
      onDelete: () => {},
      onRegisterOrphan: () => {},
    }));
    const danglingHtml = renderToStaticMarkup(createElement(DanglingCard, {
      id: "ghost",
      path: "assets/backgrounds/ghost.png",
      source: "backgrounds.ghost",
      readOnly: true,
      onRemoveRef: () => {},
    }));

    expect(assetHtml).not.toContain(">登记</button>");
    expect(assetHtml).not.toContain(">删除</button>");
    expect(danglingHtml).not.toContain(">移除引用</button>");
  });

  it("disables character editing controls in read-only mode", () => {
    const html = renderToStaticMarkup(createElement(CharacterEditor, {
      projectPath: "/project",
      manifest: base,
      disabled: true,
      onChange: () => {},
    }));

    expect(html).toContain("disabled");
    expect(html).toContain("manifest 结构异常");
  });
});

describe("character sprite import UI", () => {
  it("keeps choose image clickable when expression name is empty", () => {
    const html = renderToStaticMarkup(createElement(CharacterEditor, {
      projectPath: "/project",
      manifest: {
        characters: { h: { name: "h", color: "#fff", sprites: {} } },
        backgrounds: {},
        audio: { bgm: {}, sfx: {}, voice: {} },
      },
      onChange: () => {},
    }));

    expect(html).toContain(">选择图片</button>");
    expect(html).not.toContain("disabled=\"\"");
  });

  it("uses default as the first sprite expression when no name is typed", () => {
    expect(spriteExprNameForImport("", "hero.png", {})).toBe("default");
  });

  it("falls back to a unique file-derived expression when default already exists", () => {
    expect(spriteExprNameForImport("", "hero smile.png", { default: "old.png" })).toBe("hero_smile");
    expect(spriteExprNameForImport("", "hero smile.png", {
      default: "old.png",
      hero_smile: "one.png",
    })).toBe("hero_smile_2");
  });
});

describe("asset preview loading", () => {
  it("does not expose a direct asset protocol URL for image thumbnails", () => {
    const html = renderToStaticMarkup(createElement(AssetCard, {
      entry: { relPath: "assets/backgrounds/sky.png", size: 1, kind: "background" },
      projectPath: "/project",
      isOrphan: false,
      refCount: 1,
      onDelete: () => {},
    }));

    expect(html).not.toContain("asset://");
  });
});

describe("safeAssetFileStem", () => {
  it("removes path separators and traversal tokens from generated asset filenames", () => {
    expect(safeAssetFileStem("../happy/smile")).toBe("happy_smile");
    expect(safeAssetFileStem("默认 表情")).toBe("默认_表情");
    expect(safeAssetFileStem("")).toBe("asset");
  });
});
