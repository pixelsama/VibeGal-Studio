import assert from "node:assert/strict";
import { access, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const ASSET_FILE_NAME = "asset-workflow-preview.svg";
export const ASSET_ID = "asset-workflow-preview";
export const ASSET_RELATIVE_PATH = `assets/backgrounds/${ASSET_FILE_NAME}`;
export const ASSET_SOURCE_RELATIVE_PATH = `content/${ASSET_RELATIVE_PATH}`;
export const ASSET_MISSING_FILE_NAME = `${ASSET_FILE_NAME}.agent-qa-missing`;

const SVG_SOURCE = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#132a4f"/>
      <stop offset="0.55" stop-color="#2d6d8e"/>
      <stop offset="1" stop-color="#f5a36c"/>
    </linearGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#sky)"/>
  <circle cx="1010" cy="170" r="92" fill="#ffe1a8" opacity="0.9"/>
  <path d="M0 530 C210 450 350 610 560 520 S940 430 1280 560 V720 H0 Z" fill="#10243e" opacity="0.75"/>
  <text x="64" y="654" fill="#ffffff" font-family="sans-serif" font-size="38" font-weight="700">Asset workflow preview</text>
</svg>
`;

export function assetPaths(projectPath) {
  const projectParentPath = path.dirname(projectPath);
  return {
    sourcePath: path.join(projectParentPath, ASSET_FILE_NAME),
    projectAssetPath: path.join(projectPath, ASSET_SOURCE_RELATIVE_PATH),
    // Keep the renamed-away file outside the project. If it stayed under
    // content/assets, the asset scanner would correctly report an additional
    // orphan_asset and obscure the missing-registration assertion.
    missingAssetPath: path.join(projectParentPath, ASSET_MISSING_FILE_NAME),
  };
}

/**
 * The runner removes the whole temporary parent after the scenario. Keeping the
 * source beside the project makes both runner phases share one real external
 * file without touching repository fixtures.
 */
export async function ensureTemporaryAsset(projectPath) {
  const { sourcePath } = assetPaths(projectPath);
  await writeFile(sourcePath, SVG_SOURCE, "utf8");
  return sourcePath;
}

export async function readProjectJson(projectPath, relativePath) {
  return JSON.parse(await readFile(path.join(projectPath, relativePath), "utf8"));
}

export async function readProjectManifest(projectPath) {
  return readProjectJson(projectPath, "content/manifest.json");
}

export async function readProjectNode(projectPath, nodeFile = "content/nodes/prologue.json") {
  return readProjectJson(projectPath, nodeFile);
}

export function assertAssetRegistered(manifest) {
  assert.equal(
    manifest.backgrounds?.[ASSET_ID],
    ASSET_RELATIVE_PATH,
    `manifest.backgrounds.${ASSET_ID} should point to the imported asset`,
  );
}

export function assertAssetReference(instructions) {
  assert.ok(
    instructions.some((instruction) => instruction?.t === "bg" && instruction.id === ASSET_ID),
    `node instructions should reference background ${ASSET_ID}`,
  );
}

export async function moveImportedAssetAway(projectPath) {
  const { projectAssetPath, missingAssetPath } = assetPaths(projectPath);
  await rename(projectAssetPath, missingAssetPath);
  return { projectAssetPath, missingAssetPath };
}

export async function assertAssetMissingFromProject(projectPath) {
  const { projectAssetPath, missingAssetPath } = assetPaths(projectPath);
  await access(missingAssetPath);
  await assert.rejects(access(projectAssetPath), /ENOENT/);
}

export async function waitForPathState(filePath, state, timeoutMs = 15_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await access(filePath);
      if (state === "present") return;
    } catch {
      if (state === "missing") return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${filePath} to become ${state}`);
}
