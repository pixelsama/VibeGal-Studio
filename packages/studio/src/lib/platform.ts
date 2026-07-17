/**
 * 桌面平台检测。
 *
 * 用于处理 macOS / Windows 的窗口装饰差异：macOS 用 Overlay 标题栏（红绿灯
 * 悬浮在内容上，需要左避让）；Windows 上 titleBarStyle 不生效，保留原生标题栏，
 * 无需避让。Tauri WebView 的 UA 含平台标识，不额外引入 os 插件。
 */

export type DesktopPlatform = "macos" | "windows" | "linux" | "unknown";

export function detectDesktopPlatform(userAgent: string): DesktopPlatform {
  const ua = userAgent.toLowerCase();
  if (ua.includes("windows")) return "windows";
  if (ua.includes("mac os x") || ua.includes("macintosh")) return "macos";
  if (ua.includes("linux") || ua.includes("x11")) return "linux";
  return "unknown";
}

export function getDesktopPlatform(): DesktopPlatform {
  if (typeof navigator === "undefined" || typeof navigator.userAgent !== "string") {
    return "unknown";
  }
  return detectDesktopPlatform(navigator.userAgent);
}
