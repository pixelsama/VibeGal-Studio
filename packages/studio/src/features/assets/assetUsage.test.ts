import { describe, expect, it } from "vitest";
import type { AssetEntry, CharacterSpriteRef, Manifest, NodeEntry } from "../../lib/types";
import { deriveAssetView } from "./useAssets";
import { analyzeAssetUsage, characterSpriteAssetPaths } from "./assetUsage";

const manifest: Manifest = {
  characters: {
    hero: {
      name: "Hero",
      color: "#fff",
      sprites: {
        default: "assets/characters/hero_default.png",
        smile: "assets/characters/hero_smile.png",
        animated: {
          atlas: "heroAtlas",
          clip: "idle",
          fallback: "assets/characters/hero_idle.png",
        },
      },
    },
  },
  backgrounds: {
    school: "assets/backgrounds/school.png",
    beach: "assets/backgrounds/beach.png",
  },
  audio: {
    bgm: { theme: "assets/audio/bgm/theme.mp3" },
    sfx: {},
    voice: {},
  },
};

const onDisk: AssetEntry[] = [
  { relPath: "assets/backgrounds/school.png", size: 1, kind: "background" },
  { relPath: "assets/backgrounds/orphan.png", size: 1, kind: "background" },
];

const nodes: NodeEntry[] = [
  {
    relPath: "nodes/start.json",
    data: [
      { t: "bg", id: "school" },
      { t: "char", id: "hero", expr: "smile" },
    ],
  },
];

describe("asset usage analysis", () => {
  it("assetUsageFindsUnregisteredDiskAssets", () => {
    const view = deriveAssetView(onDisk, manifest, {
      assetIssues: [{
        severity: "error",
        code: "orphan_asset",
        message: "orphan",
        file: "content/assets/backgrounds/orphan.png",
      }],
    });

    expect(view.orphanPaths.has("assets/backgrounds/orphan.png")).toBe(true);
  });

  it("assetUsageFindsUnusedManifestEntries", () => {
    const summary = analyzeAssetUsage(manifest, nodes);

    expect(summary.usageCountByPath.get("assets/backgrounds/school.png")).toBe(1);
    expect(summary.unusedManifestPaths.has("assets/backgrounds/beach.png")).toBe(true);
    expect(summary.unusedManifestPaths.has("assets/audio/bgm/theme.mp3")).toBe(true);
    expect(summary.unusedManifestPaths.has("assets/characters/hero_idle.png")).toBe(true);
  });
});

describe("characterSpriteAssetPaths (Spec 33 A5 级联删除)", () => {
  it("字符串引用返回其路径", () => {
    expect(characterSpriteAssetPaths("assets/characters/hero_smile.png" as CharacterSpriteRef))
      .toEqual(["assets/characters/hero_smile.png"]);
  });

  it("atlas 引用只返回 fallback，不返回共享的 atlas 图", () => {
    const paths = characterSpriteAssetPaths({
      atlas: "heroAtlas",
      clip: "idle",
      fallback: "assets/characters/hero_idle.png",
    });
    // 关键不变量：级联删除只动 fallback 文件，绝不删被多表情共享的 atlas 图。
    expect(paths).toEqual(["assets/characters/hero_idle.png"]);
    expect(paths).not.toContain("heroAtlas");
  });
});
