import type { Meta } from "@vibegal/engine";

export interface StageResolution {
  width: number;
  height: number;
}

export const DEFAULT_STAGE_RESOLUTION: StageResolution = { width: 1280, height: 720 };

export const STAGE_WIDTH_RANGE = { min: 320, max: 7680 };
export const STAGE_HEIGHT_RANGE = { min: 180, max: 4320 };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

export function readStageResolution(meta: unknown): StageResolution {
  if (!isRecord(meta) || !isRecord(meta.stage)) return DEFAULT_STAGE_RESOLUTION;
  const { width, height } = meta.stage;
  if (
    !validInteger(width, STAGE_WIDTH_RANGE.min, STAGE_WIDTH_RANGE.max) ||
    !validInteger(height, STAGE_HEIGHT_RANGE.min, STAGE_HEIGHT_RANGE.max)
  ) {
    return DEFAULT_STAGE_RESOLUTION;
  }
  return { width, height };
}

export const DEFAULT_TYPING_SPEED_CPS = 30;
export const DEFAULT_AUTO_ADVANCE_MS = 1_200;
export const DEFAULT_CHAPTER_GAP_MS = 1_500;

/**
 * 把 content/meta.json 的原始内容整理成渲染层可以直接读的 Meta。
 *
 * 作品名的唯一来源是 meta.title —— gal.project.json 的 name 只是磁盘上的项目
 * 标识，不进渲染层。此前渲染层无处可读标题，于是默认渲染层退而去读
 * manifest.name（该字段在 ManifestSchema 里根本不存在），导出物标题恒为空。
 */
export function readProjectMeta(meta: unknown): Meta {
  const record = isRecord(meta) ? meta : {};
  return {
    title: typeof record.title === "string" ? record.title : "",
    typingSpeedCps: typeof record.typingSpeedCps === "number" && record.typingSpeedCps > 0
      ? record.typingSpeedCps
      : DEFAULT_TYPING_SPEED_CPS,
    autoAdvanceMs: nonNegativeInteger(record.autoAdvanceMs, DEFAULT_AUTO_ADVANCE_MS),
    chapterGapMs: nonNegativeInteger(record.chapterGapMs, DEFAULT_CHAPTER_GAP_MS),
    stage: readStageResolution(meta),
  };
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

export function withStageResolution(meta: unknown, stage: StageResolution): Record<string, unknown> {
  const base = isRecord(meta) ? { ...meta } : {};
  return {
    ...base,
    stage: {
      width: stage.width,
      height: stage.height,
    },
  };
}
