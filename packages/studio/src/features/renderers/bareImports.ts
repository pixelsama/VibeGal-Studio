/**
 * 解析并注入 bare import 的 URL 映射。
 *
 * 渲染层 .tsx 会 import "react"、"@galstudio/engine" 这类 bare specifier。
 * 编译后这些被 esbuild 标记为 external（保留原样），需要一个 import map 把它们
 * 映射到真实 URL，否则浏览器无法解析 bare specifier。
 *
 * URL 来源：studio 自己打包好的依赖 chunk。我们用 Vite 的 import.meta.glob
 * 配合动态 import 在运行时拿到这些模块的 URL，再注入 import map。
 *
 * 因为渲染层是运行时动态编译的，不能用「首次加载即冻结」的原生 import map，
 * 必须用 es-module-shims 的 shim 模式（支持运行时 import map 更新）。
 * es-module-shims 由 index.html 引入。
 */

let injected = false;

/**
 * 在文档里注入 import map（含 react、@galstudio/engine 的子路径映射）。
 * 用 es-module-shims 的 shim 类型，可在运行时更新。
 * 仅注入一次。
 */
export async function ensureBareImportMap(): Promise<void> {
  if (injected) return;

  // 拿到 bare 模块的真实 URL：通过动态 import 后，从 performance 条目或
  // Vite 的模块解析拿。最可靠的是用 import.meta.resolve（现代浏览器支持）。
  const map: Record<string, string> = {};

  // react 全家桶：jsx-runtime 是 automatic runtime 必须
  for (const spec of ["react", "react/jsx-runtime", "react-dom", "@galstudio/engine"]) {
    const url = await resolveSpecUrl(spec);
    if (url) map[spec] = url;
  }

  // react-dom/client、react 的其他子路径也常见，尽量补全
  setImportMap(map);
  injected = true;
}

/**
 * 解析单个 bare specifier 的真实 URL。
 * 用 import.meta.resolve（ES2024+，现代 webview 支持），回退到动态 import 探测。
 */
async function resolveSpecUrl(spec: string): Promise<string | null> {
  // import.meta.resolve 返回绝对 URL
  try {
    const resolve = (import.meta as unknown as { resolve?: (s: string) => string }).resolve;
    if (resolve) {
      const url = resolve(spec);
      return url;
    }
  } catch {
    /* 回退 */
  }

  // 回退：动态 import，然后用 PerformanceObserver 捕获 URL（脆弱，仅兜底）
  // 对于 react/@galstudio/engine，Vite dev 下 /node_modules/.vite/deps 可解析；
  // 打包后 import 成功即可，URL 不强求精确。
  try {
    await import(/* @vite-ignore */ spec);
    // 若到这里没抛错，说明浏览器/import map 已能解析，返回 spec 让 es-module-shims 处理
    return null;
  } catch {
    console.warn(`[bareImports] 无法解析 ${spec}，渲染层的该 import 可能失败`);
    return null;
  }
}

/** 注入/更新 import map 到 document（es-module-shims shim 类型） */
function setImportMap(map: Record<string, string>): void {
  // 只放有 URL 的条目
  const entries = Object.entries(map).filter(([, v]) => v);
  if (entries.length === 0) return;
  const json = JSON.stringify({ imports: Object.fromEntries(entries) });
  const script = document.createElement("script");
  script.type = "importmap-shim"; // es-module-shims 的 shim 类型，支持运行时更新
  script.textContent = json;
  document.head.appendChild(script);
}
