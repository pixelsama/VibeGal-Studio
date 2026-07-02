/**
 * 运行时渲染层编译器 —— 在 webview 里把用户写的 .tsx 编译成可执行的 JS。
 *
 * 为什么需要它：渲染层是用户项目里的 .tsx 源码。dev 下 Vite /@fs 即时编译能跑，
 * 但打包后的 studio 没有 Vite，.tsx 无法执行。这里用 esbuild-wasm 在运行时编译。
 *
 * 方案（最朴素可靠）：用 esbuild 的 build API 把整个渲染层当作一个小项目，
 * 以 index.tsx 为入口 bundle 成单个 ESM 字符串，react/@galstudio/engine 作为 external
 * （bare import 保留，由 index.html 注入的 import map 解析）。最后 blob URL + dynamic import。
 *
 * 这样不用自己处理模块图与相对 import 改写——esbuild 全包了。
 */
import * as esbuild from "esbuild-wasm";
import type { Plugin } from "esbuild-wasm";
import type { RendererFile } from "../../lib/tauri";

let esbuildReady = false;

async function ensureEsbuild(): Promise<void> {
  if (esbuildReady) return;
  await esbuild.initialize({
    wasmURL: "https://www.unpkg.com/esbuild-wasm@0.25.5/esbuild.wasm",
  });
  esbuildReady = true;
}

/**
 * esbuild 插件：从内存中的文件表解析 import（虚拟文件系统）。
 * 用户渲染层的源码不在磁盘可访问路径上（来自 Rust 后端读取的字符串），
 * 所以用一个 in-memory plugin 让 esbuild 能 resolve 这些模块。
 */
function memoryPlugin(files: RendererFile[]): Plugin {
  // 规范化路径键：去掉 ./
  const normalized = new Map<string, string>();
  for (const f of files) normalized.set(normKey(f.path), f.content);

  return {
    name: "galstudio-memory",
    setup(build) {
      // 解析入口与相对路径
      build.onResolve({ filter: /.*/ }, (args) => {
        // bare import（react、@galstudio/engine）：external，交给运行时 import map
        if (!args.path.startsWith("./") && !args.path.startsWith("../") && !args.path.startsWith("memory:")) {
          return { path: args.path, external: true };
        }
        const resolved = resolveRel(args.path, args.importer);
        return { path: resolved, namespace: "memory" };
      });
      // 加载 memory 模块
      build.onLoad({ filter: /.*/, namespace: "memory" }, (args) => {
        const key = normKey(args.path);
        const content = normalized.get(key);
        if (content == null) return { errors: [{ text: `找不到模块: ${args.path}` }] };
        const loader = args.path.endsWith(".tsx") ? "tsx" : args.path.endsWith(".ts") ? "ts" : "js";
        return { contents: content, loader };
      });
    },
  };
}

function normKey(p: string): string {
  let s = p.replace(/^\.?\//, "").replace(/^memory:\/\//, "");
  // 补全扩展名（用户写 "./Stage" 时）
  if (!s.endsWith(".tsx") && !s.endsWith(".ts") && !s.endsWith(".js")) s += ".tsx";
  return s;
}

function resolveRel(spec: string, importer: string): string {
  // 把相对路径基于 importer 解析成规范 key
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

/**
 * 编译并加载一个渲染层，返回其默认导出。
 * @param files 渲染层目录的所有源码文件（来自 read_renderer_files）
 */
export async function compileRenderer(files: RendererFile[]): Promise<unknown> {
  await ensureEsbuild();

  // 入口：优先 index.tsx，再 index.ts
  const entryPath = files.some((f) => f.path === "index.tsx")
    ? "index.tsx"
    : files.some((f) => f.path === "index.ts")
      ? "index.ts"
      : null;
  if (!entryPath) throw new Error("渲染层缺少 index.tsx 入口");

  const result = await esbuild.build({
    entryPoints: [`memory://${entryPath}`],
    plugins: [memoryPlugin(files)],
    bundle: true,
    format: "esm",
    target: "es2022",
    jsx: "automatic",
    write: false,
    logLevel: "silent",
  });

  const code = result.outputFiles[0].text;
  const blob = new Blob([code], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  const mod = await import(/* @vite-ignore */ url);
  URL.revokeObjectURL(url);
  return mod.default;
}
