/**
 * 运行时渲染层编译器 —— 在 webview 里把用户写的 .tsx 编译成可执行的 JS。
 *
 * 方案（源码预处理 + 全局变量，零 bare import）：
 *   1. studio 启动时把 react / @galstudio/engine 注入 globalThis.__GAL_VENDOR__
 *      （见 main.tsx）。单例，studio 与渲染层共用同一份实例。
 *   2. 用户 .tsx 进入 esbuild 前，先做字符串预处理：把 bare import 改写成
 *      从 globalThis.__GAL_VENDOR__ 取具名导出。
 *      例：`import { jsx } from "react/jsx-runtime"` →
 *          `const { jsx } = globalThis.__GAL_VENDOR__["react/jsx-runtime"];`
 *   3. esbuild bundle 整个渲染层（jsx automatic，此时 jsx-runtime 的 import 已被改成
 *      全局变量取值，但 esbuild 的 jsx:'automatic' 会自己生成 import jsx from 'react/jsx-runtime'。
 *      所以预处理要在 esbuild transform 之后做，对生成的 import 语句再改写）。
 *
 * 实际顺序：先用 esbuild.transform 逐文件编译（jsx→jsx 函数调用，含 import jsx），
 *          再把每个编译产物的 bare import 改写成全局变量，
 *          最后用 esbuild.build（仅做模块图合并，不再 transform）bundle。
 *
 * 这样产物零 bare import，blob URL + dynamic import 直接可用，无需 import map。
 */
import * as esbuild from "esbuild-wasm";
import type { Plugin } from "esbuild-wasm";
import type { RendererFile } from "../../lib/tauri";
import {
  RendererDiagnosticError,
  rendererFilePath,
  sourceLocation,
  type RendererDiagnostic,
} from "./diagnostics";

let esbuildReady = false;
const ESBUILD_READY_GLOBAL = "__GAL_ESBUILD_READY__";

async function ensureEsbuild(): Promise<void> {
  if (esbuildReady || Boolean((globalThis as Record<string, unknown>)[ESBUILD_READY_GLOBAL])) {
    esbuildReady = true;
    return;
  }

  try {
    if (typeof window === "undefined") {
      await esbuild.initialize({});
    } else {
      await esbuild.initialize({ wasmURL: "/esbuild.wasm" });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!message.includes('Cannot call "initialize" more than once')) throw e;
  }

  esbuildReady = true;
  (globalThis as Record<string, unknown>)[ESBUILD_READY_GLOBAL] = true;
}

export const VENDOR_GLOBAL = "__GAL_VENDOR__";

/**
 * bare specifier → 在 globalThis.__GAL_VENDOR__ 里的 key。
 * main.tsx 注入时用这些 key。jsx-runtime 由 esbuild automatic runtime 引入。
 */
const BARE_MAP: Record<string, string> = {
  react: "react",
  "react/jsx-runtime": "react/jsx-runtime",
  "react/jsx-dev-runtime": "react/jsx-runtime",
  "react-dom": "react-dom",
  "react-dom/client": "react-dom/client",
  "@galstudio/engine": "@galstudio/engine",
};

function bareKey(spec: string): string | null {
  if (spec in BARE_MAP) return BARE_MAP[spec];
  if (spec.startsWith("@galstudio/engine")) return "@galstudio/engine";
  if (spec.startsWith("react-dom/")) return "react-dom/client";
  if (spec.startsWith("react/")) return "react/jsx-runtime";
  return null;
}

function isRelativeSpecifier(spec: string): boolean {
  return spec.startsWith("./") || spec.startsWith("../");
}

function normalizeNamedImports(names: string): string {
  return names
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^(.+?)\s+as\s+(.+)$/);
      return match ? `${match[1].trim()}: ${match[2].trim()}` : part;
    })
    .join(", ");
}

function exportLocalNames(names: string): string {
  return names
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^(.+?)\s+as\s+(.+)$/);
      return match ? match[2].trim() : part;
    })
    .join(", ");
}

function vendorAccess(key: string): string {
  return `globalThis.${VENDOR_GLOBAL}[${JSON.stringify(key)}]`;
}

function vendorLocalName(key: string): string {
  return `__gal_vendor_${key.replace(/[^A-Za-z0-9_$]/g, "_")}`;
}

/**
 * 把一段 ESM 代码里的 bare import 改写成从 globalThis.__GAL_VENDOR__ 取值。
 * 处理三种形式：import 声明、export ... from、动态 import()。
 */
function rewriteBareImports(code: string): { code: string; unknownSpecs: string[] } {
  const unknown: string[] = [];

  // 1. import 声明：import def, { a, b as c } from "spec" / import { a } from "spec" / import def from "spec" / import * as ns from "spec"
  code = code.replace(
    /import\s+([A-Za-z_$][\w$]*)\s*,\s*\{([^}]*)\}\s+from\s+["']([^"']+)["']/g,
    (_m, def: string, names: string, spec: string) => {
      if (isRelativeSpecifier(spec)) return _m;
      const key = bareKey(spec);
      if (!key) { unknown.push(spec); return _m; }
      const vendor = vendorLocalName(key);
      return `const ${vendor} = ${vendorAccess(key)}; const ${def} = ${vendor}.default ?? ${vendor}; const { ${normalizeNamedImports(names)} } = ${vendor};`;
    },
  );
  code = code.replace(
    /import\s+\{([^}]*)\}\s+from\s+["']([^"']+)["']/g,
    (_m, names: string, spec: string) => {
      if (isRelativeSpecifier(spec)) return _m;
      const key = bareKey(spec);
      if (!key) { unknown.push(spec); return _m; }
      return `const { ${normalizeNamedImports(names)} } = ${vendorAccess(key)};`;
    },
  );
  code = code.replace(
    /import\s+(\w+)\s+from\s+["']([^"']+)["']/g,
    (_m, def: string, spec: string) => {
      if (isRelativeSpecifier(spec)) return _m;
      const key = bareKey(spec);
      if (!key) { unknown.push(spec); return _m; }
      return `const ${def} = (${vendorAccess(key)}).default ?? ${vendorAccess(key)};`;
    },
  );
  code = code.replace(
    /import\s+\*\s+as\s+(\w+)\s+from\s+["']([^"']+)["']/g,
    (_m, ns: string, spec: string) => {
      if (isRelativeSpecifier(spec)) return _m;
      const key = bareKey(spec);
      if (!key) { unknown.push(spec); return _m; }
      return `const ${ns} = ${vendorAccess(key)};`;
    },
  );

  // 2. export ... from "spec" —— 渲染层一般不 re-export bare，但兜底
  code = code.replace(
    /export\s+\{([^}]*)\}\s+from\s+["']([^"']+)["']/g,
    (_m, names: string, spec: string) => {
      if (isRelativeSpecifier(spec)) return _m;
      const key = bareKey(spec);
      if (!key) { unknown.push(spec); return _m; }
      return `const { ${normalizeNamedImports(names)} } = ${vendorAccess(key)}; export { ${exportLocalNames(names)} };`;
    },
  );

  // 3. 动态 import("spec") —— bare 的改写
  code = code.replace(/import\(\s*["']([^"']+)["']\s*\)/g, (_m, spec: string) => {
    if (isRelativeSpecifier(spec)) return _m;
    const key = bareKey(spec);
    if (!key) { unknown.push(spec); return _m; }
    return `Promise.resolve(${vendorAccess(key)})`;
  });

  return { code, unknownSpecs: unknown };
}

export function __rewriteBareImportsForTest(code: string): { code: string; unknownSpecs: string[] } {
  return rewriteBareImports(code);
}

export type RuntimeCompilerError =
  | { kind: "unsupported-import"; file: string; specs: string[]; diagnostics?: RendererDiagnostic[] }
  | { kind: "esbuild"; message: string };

export function formatRuntimeCompilerError({
  rendererId,
  error,
}: {
  rendererId: string;
  error: RuntimeCompilerError;
}): string {
  if (error.kind === "unsupported-import") {
    const diagnostic = error.diagnostics?.[0];
    const location = diagnostic?.file
      ? `${diagnostic.file}${diagnostic.line != null && diagnostic.column != null ? `:${diagnostic.line}:${diagnostic.column}` : ""}`
      : error.file;
    return `渲染层 ${rendererId} 的 ${location} 使用了未支持的 bare import：${error.specs.join(", ")}。仅支持 react、react/jsx-runtime、react-dom、@galstudio/engine 与相对路径 import。`;
  }
  return `渲染层 ${rendererId} 编译失败：${error.message}`;
}

export function formatRuntimeCompilerErrorForTest(args: {
  rendererId: string;
  error: RuntimeCompilerError;
}): string {
  return formatRuntimeCompilerError(args);
}

function memoryPlugin(files: Map<string, string>): Plugin {
  return {
    name: "galstudio-memory",
    setup(build) {
      // 所有 memory namespace 内的解析（入口 + 相对 import）统一处理
      build.onResolve({ filter: /.*/, namespace: "memory" }, (args) => {
        // 入口（path 可能是 "index"，importer 为空）或相对 import
        const resolved = args.importer ? resolveRel(args.path, args.importer) : normKey(args.path);
        return { path: resolved, namespace: "memory" };
      });
      // 顶层入口解析：entryPoints 形如 memory://index，esbuild 先用默认 namespace 解析
      build.onResolve({ filter: /^memory:\/\// }, (args) => {
        const key = args.path.replace(/^memory:\/\//, "");
        return { path: key, namespace: "memory" };
      });
      build.onLoad({ filter: /.*/, namespace: "memory" }, (args) => {
        const key = normKey(args.path);
        const content = files.get(key);
        if (content == null) return { errors: [{ text: `找不到模块: ${args.path}（key=${key}）` }] };
        // 文件内容已是【bare import 改写完、esbuild transform 过】的 JS
        return { contents: content, loader: "js" };
      });
      // 漏网的 bare import（理论上预处理已改写完）——仅在非 memory namespace 捕获
      build.onResolve({ filter: /^[^./]/, namespace: "file" }, (args) => {
        return { path: args.path, namespace: "error" };
      });
      build.onLoad({ filter: /.*/, namespace: "error" }, (args) => ({
        errors: [{ text: `未处理的 bare import: ${args.path}（应为预处理阶段改写，请检查 BARE_MAP）` }],
      }));
    },
  };
}

function normKey(p: string): string {
  let s = p.replace(/^\.?\//, "").replace(/^memory:\/\//, "");
  // 预处理后所有文件统一存 .mjs 形式的 key，不带原扩展名歧义
  return s;
}

function resolveRel(spec: string, importer: string): string {
  const importerKey = importer.replace(/^memory:\/\//, "").replace(/^\.?\//, "");
  const baseDir = importerKey.includes("/") ? importerKey.slice(0, importerKey.lastIndexOf("/")) : "";
  const parts = (baseDir ? baseDir.split("/") : []).concat(spec.split("/"));
  const resolved: string[] = [];
  for (const p of parts) {
    if (p === "." || p === "") continue;
    if (p === "..") { resolved.pop(); continue; }
    resolved.push(p);
  }
  return resolved.join("/");
}

function importSpecifierOffset(matchText: string, spec: string): number {
  const doubleQuoted = matchText.indexOf(`"${spec}"`);
  if (doubleQuoted >= 0) return doubleQuoted;
  const singleQuoted = matchText.indexOf(`'${spec}'`);
  return singleQuoted >= 0 ? singleQuoted : 0;
}

function findUnsupportedBareImports(files: RendererFile[], rendererId: string): RendererDiagnostic[] {
  const diagnostics: RendererDiagnostic[] = [];
  const importPattern = /\b(?:import\s+(?:[^"'()]+?\s+from\s*)?|export\s+[^"']+?\s+from\s*|import\s*\(\s*)["']([^"']+)["']/g;
  for (const file of files) {
    if (!file.path.endsWith(".tsx") && !file.path.endsWith(".ts")) continue;
    for (const match of file.content.matchAll(importPattern)) {
      const spec = match[1];
      if (isRelativeSpecifier(spec) || bareKey(spec)) continue;
      const matchIndex = match.index ?? 0;
      const quoteIndex = matchIndex + importSpecifierOffset(match[0], spec);
      const location = sourceLocation(file.content, quoteIndex);
      diagnostics.push({
        severity: "error",
        code: "renderer_unsupported_import",
        rendererId,
        step: "compile",
        message: `Unsupported renderer bare import: ${spec}.`,
        file: rendererFilePath(rendererId, file.path),
        ...location,
      });
    }
  }
  return diagnostics;
}

export function __findUnsupportedBareImportsForTest(files: RendererFile[], rendererId: string): RendererDiagnostic[] {
  return findUnsupportedBareImports(files, rendererId);
}

export async function compileRenderer(files: RendererFile[], options: { rendererId?: string } = {}): Promise<unknown> {
  await ensureEsbuild();
  const rendererId = options.rendererId ?? "unknown";
  const unsupportedDiagnostics = findUnsupportedBareImports(files, rendererId);
  if (unsupportedDiagnostics.length > 0) {
    throw new RendererDiagnosticError(unsupportedDiagnostics);
  }

  // 1. 逐文件：esbuild transform（tsx→js，jsx automatic 生成 import jsx）
  const compiled = new Map<string, string>();
  for (const f of files) {
    if (!f.path.endsWith(".tsx") && !f.path.endsWith(".ts")) continue;
    const result = await esbuild.transform(f.content, {
      loader: f.path.endsWith(".tsx") ? "tsx" : "ts",
      jsx: "automatic",
      format: "esm",
      target: "es2022",
    });
    // 2. 改写 bare import 为全局变量
    const { code, unknownSpecs } = rewriteBareImports(result.code);
    if (unknownSpecs.length > 0) {
      const diagnostics = unknownSpecs.map((spec) => ({
        severity: "error" as const,
        code: "renderer_unsupported_import",
        rendererId,
        step: "compile" as const,
        message: `Unsupported renderer bare import: ${spec}.`,
        file: rendererFilePath(rendererId, f.path),
      }));
      throw {
        kind: "unsupported-import",
        file: rendererFilePath(rendererId, f.path),
        specs: unknownSpecs,
        diagnostics,
      } satisfies RuntimeCompilerError;
    }
    compiled.set(stripExt(f.path), code);
  }

  // 3. bundle（合并模块图，此时只剩相对 import + 全局变量，无 bare import）
  const entryKey = stripExt(
    files.some((f) => f.path === "index.tsx") ? "index.tsx"
      : files.some((f) => f.path === "index.ts") ? "index.ts"
      : "",
  );
  if (!entryKey) throw new Error("渲染层缺少 index.tsx 入口");

  const result = await esbuild.build({
    entryPoints: [`memory://${entryKey}`],
    plugins: [memoryPlugin(compiled)],
    bundle: true,
    format: "esm",
    target: "es2022",
    write: false,
    logLevel: "warning",
  });

  const code = result.outputFiles[0].text;
  const blob = new Blob([code], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  try {
    const mod = await import(/* @vite-ignore */ url);
    return mod.default;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function stripExt(p: string): string {
  return p.replace(/\.(tsx?|js)$/, "");
}

/**
 * 运行时环境自检 —— 验证打包后 esbuild-wasm + blob import 链路是否可用。
 * 把结果写入磁盘供自动化验证（通过 Tauri fs）。
 */
export async function selfCheck(): Promise<string> {
  const steps: string[] = [];
  try {
    steps.push("1. esbuild.initialize 开始");
    await ensureEsbuild();
    steps.push("2. esbuild.initialize OK");

    // 测试 transform
    const r = await esbuild.transform("const x: number = 1;", { loader: "ts" });
    steps.push(`3. transform OK: ${r.code.trim().slice(0, 40)}`);

    // 测试 blob dynamic import（关键！）
    const testCode = "export const hi = 'blob-import-works';";
    const blob = new Blob([testCode], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    const mod = await import(/* @vite-ignore */ url);
    steps.push(`4. blob dynamic import OK: ${(mod as { hi?: string }).hi}`);
    URL.revokeObjectURL(url);

    return "SELFCHECK_PASS\n" + steps.join("\n");
  } catch (e) {
    return "SELFCHECK_FAIL\n" + steps.join("\n") + "\nERROR: " + (e instanceof Error ? e.stack ?? e.message : String(e));
  }
}

/**
 * 端到端自检：真实编译项目里的某个渲染层（多文件 .tsx + react + engine bare import）。
 * 验证整条链路：读源码 → esbuild bundle → bare import 改写 → blob import → 拿到 default 导出。
 */
export async function selfCheckFull(projectPath: string, rendererId: string): Promise<string> {
  const steps: string[] = [];
  try {
    const { readRendererFiles } = await import("../../lib/tauri");
    steps.push(`1. 读取渲染层 ${rendererId} 源码`);
    const files = await readRendererFiles(projectPath, rendererId);
    steps.push(`2. 读到 ${files.length} 个文件: ${files.map((f) => f.path).join(", ")}`);

    steps.push("3. 编译渲染层（esbuild bundle + bare import 改写）");
    const defaultExport = await compileRenderer(files);
    steps.push(`4. 编译成功，default 导出类型: ${typeof defaultExport}`);
    if (defaultExport && typeof defaultExport === "object") {
      const m = defaultExport as { id?: string; name?: string; Component?: unknown };
      steps.push(`5. RendererManifest: id=${m.id}, name=${m.name}, Component=${typeof m.Component}`);
    }
    return "SELFCHECK_FULL_PASS\n" + steps.join("\n");
  } catch (e) {
    // esbuild 失败时 errors 在 e.errors 数组里，展开成可读文本
    const esbuildErrs = (e as { errors?: { text?: string; location?: { file?: string; line?: number; column?: number } }[] }).errors;
    let detail = "";
    if (esbuildErrs && esbuildErrs.length > 0) {
      detail = esbuildErrs.map((er) =>
        `${er.text ?? ""}${er.location ? ` (${er.location.file}:${er.location.line}:${er.location.column})` : ""}`,
      ).join("\n");
    }
    return "SELFCHECK_FULL_FAIL\n" + steps.join("\n")
      + "\nERROR: " + (e instanceof Error ? e.message : String(e))
      + (detail ? "\nESBUILD_ERRORS:\n" + detail : "");
  }
}
