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
