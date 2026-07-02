/**
 * 渲染层加载器 —— 根据运行环境选择加载方式。
 *
 * 用户项目目录可以在任意磁盘位置；dev server 的 /@fs allow-list 无法可靠覆盖。
 * 因此 dev/prod 都走 Tauri 文件读取 + esbuild-wasm 运行时编译。
 */
import type { RendererManifest } from "@galstudio/engine";
import { readRendererFiles } from "../../lib/tauri";
import { compileRenderer } from "./runtimeCompiler";

const cache = new Map<string, RendererManifest>();
let rendererCacheVersion = 0;

export async function loadRenderer(projectPath: string, rendererId: string): Promise<RendererManifest> {
  const cacheKey = `${projectPath}::${rendererId}::${rendererCacheVersion}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const files = await readRendererFiles(projectPath, rendererId);
  const defaultExport = await compileRenderer(files);
  const manifest = defaultExport as RendererManifest;

  if (!manifest) throw new Error(`渲染层 ${rendererId} 没有默认导出 RendererManifest`);
  cache.set(cacheKey, manifest);
  return manifest;
}

export async function loadAllRenderers(projectPath: string, rendererIds: string[]): Promise<RendererManifest[]> {
  const results = await Promise.allSettled(rendererIds.map((id) => loadRenderer(projectPath, id)));
  return results
    .map((r, i) => (r.status === "fulfilled" ? r.value : (console.warn(`渲染层 ${rendererIds[i]} 加载失败:`, r.reason), null)))
    .filter((m): m is RendererManifest => m !== null);
}

export function clearRendererCache() {
  cache.clear();
  rendererCacheVersion += 1;
}
