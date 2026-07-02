/**
 * 渲染层加载器 —— 动态加载当前项目内的渲染层。
 *
 * 渲染层存在于项目磁盘目录的 renderers/<id>/index.tsx。
 * 加载方式：dev 模式下用 Vite 的 @fs 前缀访问（需 vite.config 的 fs.allow 放行）；
 * 加载后缓存，避免重复 import。
 *
 * 注意：渲染层源码是 TS/TSX，由 Vite dev server 即时编译。
 * 这要求用户的项目路径已在 fs.allow 内（通过 GALSTUDIO_PROJECTS_ROOT 环境变量配置）。
 */
import type { RendererManifest } from "@galstudio/engine";

const cache = new Map<string, RendererManifest>();

/**
 * 把磁盘绝对路径转成 Vite dev 可 import 的 URL。
 * dev 模式下 Vite 用 /@fs/<绝对路径> 访问 fs.allow 放行的文件。
 */
function toViteUrl(absPath: string): string {
  // 去掉可能的 file:// 前缀，用 /@fs/
  const cleaned = absPath.replace(/^file:\/\//, "");
  return `/@fs/${cleaned.replace(/^\//, "")}`;
}

/**
 * 加载项目内某个渲染层。
 * @param projectPath 项目根的绝对路径
 * @param rendererId 渲染层 id（= renderers/ 子目录名）
 */
export async function loadRenderer(projectPath: string, rendererId: string): Promise<RendererManifest> {
  const cacheKey = `${projectPath}::${rendererId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const indexAbs = `${projectPath}/renderers/${rendererId}/index.tsx`;
  const url = toViteUrl(indexAbs);
  const mod = await import(/* @vite-ignore */ url);
  const manifest = mod.default as RendererManifest;
  if (!manifest) throw new Error(`渲染层 ${rendererId} 没有默认导出 RendererManifest`);
  cache.set(cacheKey, manifest);
  return manifest;
}

/** 加载一个项目的全部渲染层（并行） */
export async function loadAllRenderers(projectPath: string, rendererIds: string[]): Promise<RendererManifest[]> {
  const results = await Promise.allSettled(rendererIds.map((id) => loadRenderer(projectPath, id)));
  return results
    .map((r, i) => (r.status === "fulfilled" ? r.value : (console.warn(`渲染层 ${rendererIds[i]} 加载失败:`, r.reason), null)))
    .filter((m): m is RendererManifest => m !== null);
}

/** 清除缓存（项目切换 / 开发者要求强制重载时用） */
export function clearRendererCache() {
  cache.clear();
}
