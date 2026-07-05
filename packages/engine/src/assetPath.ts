/**
 * 把 manifest 里的相对路径（相对 content 根）解析为运行时可 fetch 的绝对路径。
 *
 * 归属说明：这是纯路径解析逻辑，与渲染无关，属于引擎层。
 * 渲染层（components/）可以正向 import 它；引擎不反向依赖组件。
 *
 * 这是引擎与可替换渲染层之间的少数共享工具之一——因为「把 id 解析成路径」
 * 是两边都需要的、稳定的操作，不属于任何一方的私有职责。
 */
export function resolveAsset(contentBase: string, rel: string): string {
  const base = stripTrailingSlash(contentBase);
  const tail = rel.startsWith("/") ? rel.slice(1) : rel;
  const path = `${base}/${tail}`;
  const convertFileSrc = tauriConvertFileSrc();

  if (convertFileSrc && !isUrlLike(base)) {
    return convertFileSrc(path, "asset");
  }

  return path;
}

function stripTrailingSlash(path: string): string {
  return path.replace(/[\\/]+$/, "");
}

function isUrlLike(value: string): boolean {
  if (/^[A-Za-z]:[\\/]/.test(value)) return false;
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}

function tauriConvertFileSrc(): ((path: string, protocol?: string) => string) | null {
  const internals = (globalThis as {
    __TAURI_INTERNALS__?: {
      convertFileSrc?: (path: string, protocol?: string) => string;
    };
  }).__TAURI_INTERNALS__;

  return typeof internals?.convertFileSrc === "function" ? internals.convertFileSrc : null;
}
