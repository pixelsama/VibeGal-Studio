/**
 * useAssets —— 资产数据源 hook。
 *
 * 职责：
 *   - 调用 list_assets 拉取磁盘资产清单（按 refreshKey 重新拉取，配合热重载）
 *   - 结合 project.assetReport 派生「孤儿文件 / 悬空引用 / 已登记」三类视图
 *
 * 不负责持久化（导入/删除/保存 manifest 由调用方触发后走 onSaved 刷新）。
 */
import { useEffect, useState } from "react";
import { listAssets } from "../../lib/tauri";
import type { AssetEntry, AssetKind, AssetReport, Manifest } from "../../lib/types";

export interface AssetView {
  /** 磁盘上存在的资产（list_assets 返回） */
  onDisk: AssetEntry[];
  /**
   * 悬空引用：manifest 声明了但磁盘没有的条目。
   * 每项含 { kind, id, path, source }，source 形如 "backgrounds.sky"。
   */
  dangling: DanglingAsset[];
  /** 磁盘存在但 manifest 未登记的文件 relPath 集合（孤儿） */
  orphanPaths: Set<string>;
}

export interface DanglingAsset {
  kind: AssetKind;
  /** manifest 里的 id */
  id: string;
  /** 声明的相对路径 */
  path: string;
  /** 来源描述，如 "backgrounds.sky" / "audio.bgm.theme" / "characters.hero.sprites.default" */
  source: string;
}

/**
 * 从 manifest 收集所有声明的 (path, kind, id, source)，用于悬空引用判定。
 */
function collectDeclared(manifest: Manifest): DanglingAsset[] {
  const out: DanglingAsset[] = [];

  for (const [id, path] of Object.entries(manifest.backgrounds)) {
    out.push({ kind: "background", id, path, source: `backgrounds.${id}` });
  }

  for (const [charId, char] of Object.entries(manifest.characters)) {
    for (const [expr, path] of Object.entries(char.sprites)) {
      out.push({
        kind: "character",
        id: `${charId}/${expr}`,
        path,
        source: `characters.${charId}.sprites.${expr}`,
      });
    }
  }

  (["bgm", "sfx", "voice"] as const).forEach((sub) => {
    for (const [id, path] of Object.entries(manifest.audio[sub])) {
      out.push({ kind: sub, id, path, source: `audio.${sub}.${id}` });
    }
  });

  for (const [id, asset] of Object.entries(manifest.cg ?? {})) {
    out.push({ kind: "cg", id, path: asset.path, source: `cg.${id}` });
    if (asset.thumbnail) {
      out.push({ kind: "cg", id: `${id}/thumbnail`, path: asset.thumbnail, source: `cg.${id}.thumbnail` });
    }
  }

  for (const [id, asset] of Object.entries(manifest.videos ?? {})) {
    out.push({ kind: "video", id, path: asset.path, source: `videos.${id}` });
    if (asset.poster) {
      out.push({ kind: "video", id: `${id}/poster`, path: asset.poster, source: `videos.${id}.poster` });
    }
  }

  for (const [id, font] of Object.entries(manifest.fonts ?? {})) {
    out.push({ kind: "font", id, path: font.path, source: `fonts.${id}` });
  }

  for (const [id, skin] of Object.entries(manifest.uiSkins ?? {})) {
    for (const [assetId, path] of Object.entries(skin.assets ?? {})) {
      out.push({ kind: "ui", id: `${id}/${assetId}`, path, source: `uiSkins.${id}.assets.${assetId}` });
    }
  }

  for (const [id, atlas] of Object.entries(manifest.animationAtlases ?? {})) {
    out.push({ kind: "animation", id, path: atlas.image, source: `animationAtlases.${id}.image` });
    if (atlas.json) {
      out.push({ kind: "animation", id: `${id}/json`, path: atlas.json, source: `animationAtlases.${id}.json` });
    }
  }

  return out;
}

/**
 * 派生资产视图：把磁盘清单 + manifest + 校验报告合并成 UI 可直接消费的结构。
 */
export function deriveAssetView(
  onDisk: AssetEntry[],
  manifest: Manifest,
  report: AssetReport | undefined,
): AssetView {
  const diskPaths = new Set(onDisk.map((a) => a.relPath));

  const declared = collectDeclared(manifest);
  const dangling = declared.filter((d) => !diskPaths.has(d.path.replace(/\\/g, "/")));

  // 孤儿：磁盘有但 manifest 没声明。直接从报告里取 orphan_asset 的 file（去 content/ 前缀）。
  const orphanPaths = new Set<string>();
  for (const issue of report?.assetIssues ?? []) {
    if (issue.code === "orphan_asset" && issue.file) {
      const rel = issue.file.replace(/^content\//, "");
      orphanPaths.add(rel);
    }
  }

  return { onDisk, dangling, orphanPaths };
}

export function useAssets(
  projectPath: string,
  refreshKey: number,
  manifest: Manifest,
  report: AssetReport | undefined,
): AssetView {
  const [onDisk, setOnDisk] = useState<AssetEntry[]>([]);

  useEffect(() => {
    let active = true;
    listAssets(projectPath)
      .then((entries) => {
        if (active) setOnDisk(entries);
      })
      .catch((e) => {
        console.warn("listAssets 失败:", e);
        if (active) setOnDisk([]);
      });
    return () => {
      active = false;
    };
  }, [projectPath, refreshKey]);

  return deriveAssetView(onDisk, manifest, report);
}
