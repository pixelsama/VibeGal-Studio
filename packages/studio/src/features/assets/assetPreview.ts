/**
 * 资产预览 URL 解析。
 *
 * 复用 useProjectPlayer / useNodePreview 的同一模式：
 * convertFileSrc 把磁盘路径转成 webview 可访问的 asset: 协议 URL，
 * 再拼接相对 content 根的路径。CSP 已放行 asset: / http://asset.localhost。
 */
import { convertFileSrc } from "@tauri-apps/api/core";

/** 给定项目路径，返回 content 目录的 webview 可访问 URL 根（无尾部斜杠）。 */
export function contentBaseUrl(projectPath: string): string {
  return convertFileSrc(`${projectPath}/content`);
}

/**
 * 把相对 content 根的资产路径（如 "assets/backgrounds/x.png"）
 * 解析成 webview 可加载的完整 URL。
 */
export function resolveAssetUrl(projectPath: string, relPath: string): string {
  const tail = relPath.startsWith("/") ? relPath.slice(1) : relPath;
  return convertFileSrc(`${projectPath}/content/${tail}`);
}

/** 判断路径是否为图片扩展名（决定卡片用 <img> 预览）。 */
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg", "bmp"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "flac", "m4a", "aac"]);
const VIDEO_EXTS = new Set(["mp4", "webm", "mov", "mkv"]);

export type PreviewKind = "image" | "audio" | "video" | "other";

/** 由扩展名推断卡片预览方式。 */
export function previewKind(relPath: string): PreviewKind {
  const ext = relPath.split(".").pop()?.toLowerCase() ?? "";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (VIDEO_EXTS.has(ext)) return "video";
  return "other";
}

/** 取路径最后一段作为显示名（不含目录与扩展名）。 */
export function baseName(relPath: string): string {
  const file = relPath.split("/").pop() ?? relPath;
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(0, dot) : file;
}
