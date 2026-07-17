/**
 * 运行时渲染层编译器 —— 在 webview 里把用户写的 .tsx 编译成可执行的 JS。
 *
 * 方案（单趟 esbuild.build + 插件，产物零 bare import）：
 *   1. studio 启动时把 react / @vibegal/engine 注入 globalThis.__GAL_VENDOR__
 *      （见 main.tsx）。单例，studio 与渲染层共用同一份实例。
 *   2. 一次 esbuild.build 完成编译与打包，插件负责模块解析：
 *      - 相对 import → 内存文件表（带扩展名 / 目录 index 补全）；
 *      - bare import（react / react-dom / @vibegal/engine）→ vendor shim 虚拟模块，
 *        shim 在运行时从 globalThis.__GAL_VENDOR__ 取真实模块并 re-export；
 *      - 其余 bare import → 编译错误（esbuild 自动带上 import 语句的真实行列位置）。
 *   3. esbuild 的 jsx automatic 生成的 react/jsx-runtime import 同样走 vendor shim，链路自洽。
 *
 * 产物零外部依赖，blob URL + dynamic import 直接可用，无需 import map。
 */
import * as esbuild from "esbuild-wasm";
import type { Loader, Message, Plugin } from "esbuild-wasm";
import type { RendererFile } from "../../lib/tauri";
import {
  RendererDiagnosticError,
  rendererFilePath,
  type RendererDiagnostic,
} from "./diagnostics";

let esbuildReady = false;
let esbuildInitPromise: Promise<void> | null = null;
const ESBUILD_READY_GLOBAL = "__GAL_ESBUILD_READY__";
const ESBUILD_INIT_PROMISE_GLOBAL = "__GAL_ESBUILD_INIT_PROMISE__";

async function ensureEsbuild(): Promise<void> {
  const globalState = globalThis as Record<string, unknown>;
  if (esbuildReady || Boolean(globalState[ESBUILD_READY_GLOBAL])) {
    esbuildReady = true;
    return;
  }

  if (!esbuildInitPromise) {
    const globalPromise = globalState[ESBUILD_INIT_PROMISE_GLOBAL];
    if (globalPromise instanceof Promise) {
      esbuildInitPromise = globalPromise;
    } else {
      esbuildInitPromise = (async () => {
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
        globalState[ESBUILD_READY_GLOBAL] = true;
      })();
      globalState[ESBUILD_INIT_PROMISE_GLOBAL] = esbuildInitPromise;
    }
  }

  try {
    await esbuildInitPromise;
  } catch (error) {
    if (globalState[ESBUILD_INIT_PROMISE_GLOBAL] === esbuildInitPromise) {
      delete globalState[ESBUILD_INIT_PROMISE_GLOBAL];
    }
    esbuildInitPromise = null;
    throw error;
  }
  esbuildReady = true;
  globalState[ESBUILD_READY_GLOBAL] = true;
}

export const __ensureEsbuildForTest = ensureEsbuild;

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
  "@vibegal/engine": "@vibegal/engine",
  "@galstudio/engine": "@vibegal/engine",
};

function bareKey(spec: string): string | null {
  if (spec in BARE_MAP) return BARE_MAP[spec];
  if (spec.startsWith("@vibegal/engine")) return "@vibegal/engine";
  if (spec.startsWith("@galstudio/engine")) return "@vibegal/engine";
  if (spec.startsWith("react-dom/")) return "react-dom/client";
  if (spec.startsWith("react/")) return "react/jsx-runtime";
  return null;
}

function isRelativeSpecifier(spec: string): boolean {
  return spec.startsWith("./") || spec.startsWith("../");
}

/** 不支持的 bare import 错误文本前缀，esbuild error → diagnostic 映射时据此识别 */
const UNSUPPORTED_IMPORT_PREFIX = "VIBEGAL_UNSUPPORTED_RENDERER_IMPORT:";

function normKey(p: string): string {
  return p.replace(/^\.?\//, "").replace(/^memory:\/\//, "");
}

function resolveRel(spec: string, importer: string): string {
  const importerKey = normKey(importer);
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

/** 相对 specifier 的候选补全顺序：原样 → 补扩展名 → 目录 index */
const RESOLVE_CANDIDATE_SUFFIXES = ["", ".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts"];

function resolveMemoryPath(spec: string, importer: string, files: { has(key: string): boolean }): string | null {
  const base = resolveRel(spec, importer);
  for (const suffix of RESOLVE_CANDIDATE_SUFFIXES) {
    const candidate = base + suffix;
    if (files.has(candidate)) return candidate;
  }
  return null;
}

export function __resolveMemoryPathForTest(
  spec: string,
  importer: string,
  files: { has(key: string): boolean },
): string | null {
  return resolveMemoryPath(spec, importer, files);
}

function loaderFor(path: string): Loader {
  if (path.endsWith(".tsx")) return "tsx";
  if (path.endsWith(".ts")) return "ts";
  if (path.endsWith(".jsx")) return "jsx";
  return "js";
}

const VALID_IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * 生成 vendor shim 模块源码：运行时从 globalThis.__GAL_VENDOR__ 取真实模块，
 * 把它的可枚举导出 re-export 出去（named / default / namespace / 动态 import 均可用）。
 * 导出名单不硬编码，直接枚举运行时真实模块；vendor 未注入时返回 null。
 */
function vendorShimSource(key: string): string | null {
  const vendor = (globalThis as Record<string, unknown>)[VENDOR_GLOBAL];
  const mod = vendor && typeof vendor === "object"
    ? (vendor as Record<string, unknown>)[key]
    : undefined;
  if (mod == null || (typeof mod !== "object" && typeof mod !== "function")) return null;
  const names = [...new Set(
    Object.keys(mod as object).filter((name) => name !== "default" && VALID_IDENTIFIER.test(name)),
  )];
  const lines = [
    `const __m = globalThis.${VENDOR_GLOBAL}[${JSON.stringify(key)}];`,
    "export default (__m && __m.default !== undefined) ? __m.default : __m;",
    ...names.map((name) => `export const ${name} = __m[${JSON.stringify(name)}];`),
  ];
  return lines.join("\n") + "\n";
}

export function __vendorShimForTest(key: string): string | null {
  return vendorShimSource(key);
}

function rendererPlugin(files: Map<string, string>): Plugin {
  return {
    name: "vibegal-renderer",
    setup(build) {
      // 入口解析：entryPoints 形如 memory://index.tsx，在默认 namespace 先剥掉前缀
      build.onResolve({ filter: /^memory:\/\// }, (args) => ({
        path: args.path.replace(/^memory:\/\//, ""),
        namespace: "memory",
      }));
      // memory namespace 内的所有 import：相对 → 内存文件；bare → vendor shim / 编译错误
      build.onResolve({ filter: /.*/, namespace: "memory" }, (args) => {
        if (isRelativeSpecifier(args.path)) {
          const resolved = resolveMemoryPath(args.path, args.importer, files);
          if (resolved == null) {
            return { errors: [{ text: `找不到模块: ${args.path}（从 ${args.importer} 导入）` }] };
          }
          return { path: resolved, namespace: "memory" };
        }
        const key = bareKey(args.path);
        if (key) return { path: key, namespace: "vendor" };
        return { errors: [{ text: `${UNSUPPORTED_IMPORT_PREFIX}${args.path}` }] };
      });
      build.onLoad({ filter: /.*/, namespace: "memory" }, (args) => {
        const key = normKey(args.path);
        const content = files.get(key);
        if (content == null) return { errors: [{ text: `找不到模块: ${args.path}（key=${key}）` }] };
        return { contents: content, loader: loaderFor(key) };
      });
      build.onLoad({ filter: /.*/, namespace: "vendor" }, (args) => {
        const source = vendorShimSource(args.path);
        if (source == null) {
          return { errors: [{ text: `vendor 模块未注入: globalThis.${VENDOR_GLOBAL}[${JSON.stringify(args.path)}]（渲染层运行时依赖 main.tsx 注入的 vendor 单例）` }] };
        }
        return { contents: source, loader: "js" };
      });
    },
  };
}

function esbuildErrorToDiagnostic(rendererId: string, error: Message): RendererDiagnostic {
  const unsupported = error.text.startsWith(UNSUPPORTED_IMPORT_PREFIX);
  const spec = unsupported ? error.text.slice(UNSUPPORTED_IMPORT_PREFIX.length) : "";
  const location = error.location;
  return {
    severity: "error",
    code: unsupported ? "renderer_unsupported_import" : "renderer_compile_failed",
    rendererId,
    step: "compile",
    message: unsupported
      ? `渲染层使用了未支持的 bare import：${spec}。仅支持 react、react/jsx-runtime、react-dom、@vibegal/engine 与相对路径 import。`
      : error.text,
    file: location?.file ? rendererFilePath(rendererId, normKey(location.file)) : undefined,
    line: location?.line ?? undefined,
    column: location?.column ?? undefined,
    snippet: location?.lineText ?? undefined,
  };
}

export function __esbuildErrorToDiagnosticForTest(rendererId: string, error: Message): RendererDiagnostic {
  return esbuildErrorToDiagnostic(rendererId, error);
}

export async function compileRenderer(
  files: RendererFile[],
  options: { rendererId?: string; beforeExecute?: () => void } = {},
): Promise<unknown> {
  await ensureEsbuild();
  const rendererId = options.rendererId ?? "unknown";

  const entry = files.some((f) => f.path === "index.tsx") ? "index.tsx"
    : files.some((f) => f.path === "index.ts") ? "index.ts"
    : null;
  if (!entry) throw new Error("渲染层缺少 index.tsx 入口");

  const fileMap = new Map(files.map((f) => [normKey(f.path), f.content]));
  let result: esbuild.BuildResult & { outputFiles: esbuild.OutputFile[] };
  try {
    result = await esbuild.build({
      entryPoints: [`memory://${entry}`],
      bundle: true,
      format: "esm",
      target: "es2022",
      jsx: "automatic",
      write: false,
      logLevel: "warning",
      plugins: [rendererPlugin(fileMap)],
    });
  } catch (error) {
    const messages = (error as { errors?: Message[] }).errors;
    if (Array.isArray(messages) && messages.length > 0) {
      throw new RendererDiagnosticError(messages.map((m) => esbuildErrorToDiagnostic(rendererId, m)));
    }
    throw error;
  }

  const code = result.outputFiles[0].text;
  const blob = new Blob([code], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  try {
    options.beforeExecute?.();
    const mod = await import(/* @vite-ignore */ url);
    return mod.default;
  } finally {
    URL.revokeObjectURL(url);
  }
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
 * 验证整条链路：读源码 → esbuild build（插件解析 + vendor shim）→ blob import → 拿到 default 导出。
 */
export async function selfCheckFull(projectPath: string, rendererId: string): Promise<string> {
  const steps: string[] = [];
  try {
    const { readRendererFiles } = await import("../../lib/tauri");
    steps.push(`1. 读取渲染层 ${rendererId} 源码`);
    const files = await readRendererFiles(projectPath, rendererId);
    steps.push(`2. 读到 ${files.length} 个文件: ${files.map((f) => f.path).join(", ")}`);

    steps.push("3. 编译渲染层（esbuild build + vendor shim）");
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
