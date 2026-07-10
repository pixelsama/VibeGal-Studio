/**
 * 渲染层加载器 —— 根据运行环境选择加载方式。
 *
 * 用户项目目录可以在任意磁盘位置；dev server 的 /@fs allow-list 无法可靠覆盖。
 * 因此 dev/prod 都走 Tauri 文件读取 + esbuild-wasm 运行时编译。
 */
import { RENDERER_CONTRACT_VERSION, type RendererManifest } from "@vibegal/engine";
import { readRendererFiles } from "../../lib/tauri";
import { compileRenderer, formatRuntimeCompilerError, type RuntimeCompilerError } from "./runtimeCompiler";
import {
  RendererDiagnosticError,
  findPropertyLocation,
  rendererFilePath,
  sourceLocation,
  type RendererDiagnostic,
} from "./diagnostics";
import { isProjectRendererTrusted } from "./rendererTrust";

const cache = new Map<string, RendererManifest>();
let rendererCacheVersion = 0;

export class RendererTrustRequiredError extends Error {
  readonly code = "renderer_trust_required";

  constructor(readonly projectPath: string) {
    super("项目渲染层包含会执行的代码。请仅在信任此项目来源时授权运行。");
    this.name = "RendererTrustRequiredError";
  }
}

export { getRendererDiagnostics, type RendererDiagnostic } from "./diagnostics";

function indexSource(files: { path: string; content: string }[]): string {
  return files.find((file) => file.path === "index.tsx")?.content
    ?? files.find((file) => file.path === "index.ts")?.content
    ?? files[0]?.content
    ?? "";
}

function indexFile(rendererId: string, files: { path: string }[]): string {
  return rendererFilePath(
    rendererId,
    files.find((file) => file.path === "index.tsx")?.path
      ?? files.find((file) => file.path === "index.ts")?.path
      ?? "index.tsx",
  );
}

function manifestDiagnostics(raw: unknown, rendererId: string, files: { path: string; content: string }[]): RendererDiagnostic[] {
  const source = indexSource(files);
  const file = indexFile(rendererId, files);
  const manifest = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  if (!manifest) {
    return [{
      severity: "error",
      code: "renderer_missing_default_export",
      rendererId,
      step: "manifest",
      message: `Renderer ${rendererId} must default-export a RendererManifest.`,
      file,
      ...sourceLocation(source, 0),
    }];
  }

  const diagnostics: RendererDiagnostic[] = [];
  if (manifest.id !== rendererId) {
    diagnostics.push({
      severity: "error",
      code: "renderer_manifest_id_mismatch",
      rendererId,
      step: "manifest",
      message: `Renderer manifest id must match directory id "${rendererId}".`,
      file,
      ...findPropertyLocation(source, "id"),
    });
  }
  if (!("contractVersion" in manifest)) {
    diagnostics.push({
      severity: "error",
      code: "renderer_contract_missing",
      rendererId,
      step: "contract",
      message: `Renderer ${rendererId} is missing contractVersion.`,
      file,
      ...sourceLocation(source, source.indexOf("export default") >= 0 ? source.indexOf("export default") : 0),
    });
  } else if (manifest.contractVersion !== RENDERER_CONTRACT_VERSION) {
    diagnostics.push({
      severity: "error",
      code: "renderer_contract_unsupported",
      rendererId,
      step: "contract",
      message: `Unsupported renderer contract version ${String(manifest.contractVersion)}; expected ${RENDERER_CONTRACT_VERSION}.`,
      file,
      ...findPropertyLocation(source, "contractVersion"),
    });
  }
  return diagnostics;
}

export async function loadRenderer(
  projectPath: string,
  rendererId: string,
): Promise<RendererManifest> {
  const assertExecutionTrusted = () => {
    if (!isProjectRendererTrusted(projectPath)) throw new RendererTrustRequiredError(projectPath);
  };
  assertExecutionTrusted();
  const cacheKey = `${projectPath}::${rendererId}::${rendererCacheVersion}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const files = await readRendererFiles(projectPath, rendererId);
  let defaultExport: unknown;
  try {
    defaultExport = await compileRenderer(files, { rendererId, beforeExecute: assertExecutionTrusted });
  } catch (error) {
    if (error instanceof RendererDiagnosticError) throw error;
    if (typeof error === "object" && error != null && "kind" in error) {
      throw new Error(formatRuntimeCompilerError({
        rendererId,
        error: error as RuntimeCompilerError,
      }));
    }
    throw error;
  }

  const diagnostics = manifestDiagnostics(defaultExport, rendererId, files);
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    throw new RendererDiagnosticError(diagnostics);
  }
  const manifest = defaultExport as RendererManifest;
  cache.set(cacheKey, manifest);
  return manifest;
}

export async function loadAllRenderers(
  projectPath: string,
  rendererIds: string[],
): Promise<RendererManifest[]> {
  const results = await Promise.allSettled(rendererIds.map((id) => loadRenderer(projectPath, id)));
  return results
    .map((r, i) => (r.status === "fulfilled" ? r.value : (console.warn(`渲染层 ${rendererIds[i]} 加载失败:`, r.reason), null)))
    .filter((m): m is RendererManifest => m !== null);
}

export function clearRendererCache() {
  cache.clear();
  rendererCacheVersion += 1;
}
