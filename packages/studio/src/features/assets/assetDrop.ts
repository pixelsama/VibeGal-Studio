/**
 * 资产文件拖放导入的分类推断。
 *
 * 拖放与工具栏"导入"按钮共用同一条导入管线（importAsset + manifest 登记），
 * 区别只在目标分类的确定方式：
 *   - 当前停留在某个具体分类（背景 / BGM / …）时，拖入的文件全部归入该分类，
 *     与导入按钮的行为一致；
 *   - 停留在"总览"等不可直接登记的分类时，按文件扩展名逐个推断；
 *     无法识别的文件进入 rejected，由调用方提示跳过。
 *
 * 音频扩展名无法区分 BGM / 音效 / 语音，统一推断为 bgm，导入后可在 manifest 调整。
 */
import type { AssetKind } from "../../lib/types";
import type { AssetSection } from "./AssetsSidebar";

export type RegistrableAssetKind = Exclude<AssetKind, "character" | "unknown">;

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif", "svg"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "ogg", "wav", "flac", "m4a", "aac", "opus"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "mkv"]);
const FONT_EXTENSIONS = new Set(["ttf", "otf", "woff", "woff2"]);

export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : "";
}

/** 按扩展名推断资产分类；无法识别时返回 null。 */
export function inferAssetKindFromFileName(fileName: string): RegistrableAssetKind | null {
  const ext = fileExtension(fileName);
  if (IMAGE_EXTENSIONS.has(ext)) return "background";
  if (AUDIO_EXTENSIONS.has(ext)) return "bgm";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (FONT_EXTENSIONS.has(ext)) return "font";
  return null;
}

/** 当前分类是否可作为导入目标（与导入按钮的可用范围一致）。 */
export function isRegistrableSection(section: AssetSection): section is RegistrableAssetKind {
  return section !== "overview" && section !== "character" && section !== "unknown";
}

export interface DropPlanItem {
  /** 外部文件的绝对路径（拖放事件给出） */
  src: string;
  kind: RegistrableAssetKind;
}

export interface AssetDropPlan {
  items: DropPlanItem[];
  /** 无法识别类型的文件名（用于跳过提示） */
  rejected: string[];
}

/** 规划一次拖放导入：具体分类全部归入该分类，否则按扩展名逐个推断。 */
export function planAssetDrop(paths: string[], section: AssetSection): AssetDropPlan {
  const items: DropPlanItem[] = [];
  const rejected: string[] = [];
  for (const src of paths) {
    const fileName = src.split(/[/\\]/).pop() ?? "";
    const kind = isRegistrableSection(section) ? section : inferAssetKindFromFileName(fileName);
    if (kind) {
      items.push({ src, kind });
    } else {
      rejected.push(fileName || src);
    }
  }
  return { items, rejected };
}
