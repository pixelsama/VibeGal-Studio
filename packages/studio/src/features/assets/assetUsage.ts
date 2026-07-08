import type { Manifest, NodeEntry } from "../../lib/types";

export interface AssetUsageSummary {
  usageCountByPath: Map<string, number>;
  unusedManifestPaths: Set<string>;
}

export function analyzeAssetUsage(manifest: Manifest, nodeEntries?: NodeEntry[]): AssetUsageSummary {
  const usageCountByPath = new Map<string, number>();
  const declaredPaths = collectDeclaredPaths(manifest);

  for (const entry of nodeEntries ?? []) {
    if (!Array.isArray(entry.data)) continue;
    for (const instruction of entry.data) {
      const obj = typeof instruction === "object" && instruction != null ? instruction as Record<string, unknown> : null;
      if (!obj || typeof obj.t !== "string") continue;
      const paths = resolveInstructionAssetPaths(obj, manifest);
      paths.forEach((path) => {
        usageCountByPath.set(path, (usageCountByPath.get(path) ?? 0) + 1);
      });
    }
  }

  const unusedManifestPaths = new Set<string>();
  declaredPaths.forEach((path) => {
    if ((usageCountByPath.get(path) ?? 0) === 0) unusedManifestPaths.add(path);
  });

  return { usageCountByPath, unusedManifestPaths };
}

function resolveInstructionAssetPaths(instruction: Record<string, unknown>, manifest: Manifest): string[] {
  switch (instruction.t) {
    case "bg":
      return typeof instruction.id === "string" && manifest.backgrounds[instruction.id]
        ? [manifest.backgrounds[instruction.id]]
        : [];
    case "bgm":
      return typeof instruction.id === "string" && manifest.audio.bgm[instruction.id]
        ? [manifest.audio.bgm[instruction.id]]
        : [];
    case "sfx":
      return typeof instruction.id === "string" && manifest.audio.sfx[instruction.id]
        ? [manifest.audio.sfx[instruction.id]]
        : [];
    case "voice":
      return typeof instruction.id === "string" && manifest.audio.voice[instruction.id]
        ? [manifest.audio.voice[instruction.id]]
        : [];
    case "char":
      return resolveCharacterSpritePaths(
        typeof instruction.id === "string" ? instruction.id : null,
        typeof instruction.expr === "string" ? instruction.expr : "default",
        manifest,
      );
    case "say":
      return resolveCharacterSpritePaths(
        typeof instruction.who === "string" ? instruction.who : null,
        typeof instruction.expr === "string" ? instruction.expr : "default",
        manifest,
      );
    default:
      return [];
  }
}

function resolveCharacterSpritePaths(characterId: string | null, expr: string, manifest: Manifest): string[] {
  if (!characterId) return [];
  const character = manifest.characters[characterId];
  if (!character) return [];
  const sprite = character.sprites[expr] ?? character.sprites.default;
  return sprite ? [sprite] : [];
}

function collectDeclaredPaths(manifest: Manifest): Set<string> {
  const paths = new Set<string>();
  Object.values(manifest.backgrounds).forEach((path) => paths.add(path));
  Object.values(manifest.audio.bgm).forEach((path) => paths.add(path));
  Object.values(manifest.audio.sfx).forEach((path) => paths.add(path));
  Object.values(manifest.audio.voice).forEach((path) => paths.add(path));
  Object.values(manifest.characters).forEach((character) => {
    Object.values(character.sprites).forEach((path) => paths.add(path));
  });
  return paths;
}
