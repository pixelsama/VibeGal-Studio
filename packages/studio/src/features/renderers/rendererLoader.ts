/**
 * 渲染层加载器 —— 根据运行环境选择加载方式。
 *
 * - DEV（tauri dev）：Vite 的 /@fs 前缀可即时编译项目里的 .tsx，直接动态 import。
 * - PROD（打包后）：没有 Vite，走 runtimeCompiler（esbuild-wasm 运行时编译）。
 *
 * 通过 import.meta.env.DEV（Vite 注入）区分。
 */
import type { RendererManifest } from "@galstudio/engine";
import { readRendererFiles } from "../../lib/tauri";
import { compileRenderer } from "./runtimeCompiler";

const cache = new Map<string, RendererManifest>();
let rendererCacheVersion = 0;

function toViteUrl(absPath: string): string {
  const cleaned = absPath.replace(/^file:\/\//, "");
  return `/@fs/${cleaned.replace(/^\//, "")}`;
}

export async function loadRenderer(projectPath: string, rendererId: string): Promise<RendererManifest> {
  const cacheKey = `${projectPath}::${rendererId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  let manifest: RendererManifest;

  if (import.meta.env.DEV) {
    // dev：走 Vite /@fs 即时编译
    const indexAbs = `${projectPath}/renderers/${rendererId}/index.tsx`;
    const url = `${toViteUrl(indexAbs)}?v=${rendererCacheVersion}`;
    const mod = await import(/* @vite-ignore */ url);
    manifest = mod.default;
  } else {
    // prod：运行时编译
    const files = await readRendererFiles(projectPath, rendererId);
    const defaultExport = await compileRenderer(files);
    manifest = defaultExport as RendererManifest;
  }

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
