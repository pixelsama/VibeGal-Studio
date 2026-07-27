/**
 * 渲染层加载器 —— 根据运行环境选择加载方式。
 *
 * 用户项目目录可以在任意磁盘位置；dev server 的 /@fs allow-list 无法可靠覆盖。
 * 因此 dev/prod 都走 Tauri 文件读取 + esbuild-wasm 运行时编译。
 */
import { RENDERER_CONTRACT_VERSION, validateRendererManifestContract, type RendererManifest } from "@vibegal/engine";
import { readRendererSource } from "../../lib/tauri";
import { compileRenderer } from "./runtimeCompiler";
import {
  RendererDiagnosticError,
  findPropertyLocation,
  rendererFilePath,
  sourceLocation,
  type RendererDiagnostic,
} from "./diagnostics";
import { initializeRendererTrust, isProjectRendererTrusted } from "./rendererTrust";

const cache = new Map<string, RendererManifest>();
let rendererCacheVersion = 0;

export class RendererTrustRequiredError extends Error {
  readonly code = "renderer_trust_required";

  constructor(
    readonly projectPath: string,
    readonly rendererId: string,
    readonly fingerprint: string,
  ) {
    super("项目界面风格包含会执行的代码。请仅在信任此项目来源时授权运行。");
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
      message: `界面风格「${rendererId}」必须通过 default export 导出 RendererManifest。`,
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
      message: `界面风格标识必须与目录名「${rendererId}」一致。`,
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
      message: `界面风格「${rendererId}」缺少 contractVersion。`,
      file,
      ...sourceLocation(source, source.indexOf("export default") >= 0 ? source.indexOf("export default") : 0),
    });
  } else if (manifest.contractVersion !== RENDERER_CONTRACT_VERSION) {
    diagnostics.push({
      severity: "error",
      code: "renderer_contract_unsupported",
      rendererId,
      step: "contract",
      message: `不支持界面风格契约版本 ${String(manifest.contractVersion)}；期望版本为 ${RENDERER_CONTRACT_VERSION}。`,
      file,
      ...findPropertyLocation(source, "contractVersion"),
    });
  }
  const contractIssues = validateRendererManifestContract(raw);
  for (const issue of contractIssues) {
    if (issue.code === "renderer_contract_unsupported" && manifest.contractVersion !== RENDERER_CONTRACT_VERSION) continue;
    diagnostics.push({
      severity: issue.level,
      code: issue.code,
      rendererId,
      step: "manifest",
      message: issue.message,
      file,
      ...findPropertyLocation(source, issue.message.includes("appearance") ? "appearance" : "Component"),
    });
  }
  return diagnostics;
}

export async function loadRenderer(
  projectPath: string,
  rendererId: string,
): Promise<RendererManifest> {
  await initializeRendererTrust();
  const source = await readRendererSource(projectPath, rendererId);
  const { files, fingerprint } = source;
  const assertExecutionTrusted = () => {
    if (!isProjectRendererTrusted(projectPath, rendererId, fingerprint)) {
      throw new RendererTrustRequiredError(projectPath, rendererId, fingerprint);
    }
  };
  assertExecutionTrusted();
  const cacheKey = `${projectPath}::${rendererId}::${fingerprint}::${rendererCacheVersion}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const defaultExport = await compileRenderer(files, { rendererId, beforeExecute: assertExecutionTrusted });

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
    .map((r, i) => (r.status === "fulfilled" ? r.value : (console.warn(`界面风格 ${rendererIds[i]} 加载失败:`, r.reason), null)))
    .filter((m): m is RendererManifest => m !== null);
}

export function clearRendererCache() {
  cache.clear();
  rendererCacheVersion += 1;
}
