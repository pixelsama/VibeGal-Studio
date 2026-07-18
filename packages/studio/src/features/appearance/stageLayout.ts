/**
 * 舞台拖拽 overlay 的纯几何层（Spec 17 步骤 4 / 第 7 节）。
 *
 * 坐标体系：
 * - client 坐标：getBoundingClientRect 所在的 viewport CSS px 空间；
 * - 舞台坐标：渲染器契约的舞台空间（原点 = 舞台左上角，单位 = 舞台 px），
 *   几何 token（dialogueBox.x 等）就落在这个坐标系；
 * - 缩放比 scale = 舞台表层的 client 宽 / 舞台宽。舞台表层是 StageFrame 里
 *   带 transform: scale(...) 的那层（data-stage-surface），它的
 *   getBoundingClientRect 已含缩放，直接量出来最可靠 —— 不依赖
 *   StageFrame 内部如何计算 letterbox。
 *
 * 所有判定与换算收在这里以便单测；组件（StageDesignView）只做 DOM 测量与
 * 指针事件编排。
 */

/** 渲染器声明支持舞台拖拽的 capability（Spec 17 §7）。 */
export const LAYOUT_PARTS_CAPABILITY = "layout-parts-v1";

/** 部件最小尺寸（舞台 px），防止拖成不可见/不可选。 */
export const MIN_PART_WIDTH = 40;
export const MIN_PART_HEIGHT = 24;

export interface StageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** client（viewport CSS px）坐标系里的矩形。 */
export interface ClientRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface StageSize {
  width: number;
  height: number;
}

export interface StagePoint {
  x: number;
  y: number;
}

export type ResizeCorner = "nw" | "ne" | "sw" | "se";

// ──────────────────────────────────────────────
// capability 判定
// ──────────────────────────────────────────────

export function supportsLayoutParts(capabilities: string[] | null | undefined): boolean {
  return Array.isArray(capabilities) && capabilities.includes(LAYOUT_PARTS_CAPABILITY);
}

// ──────────────────────────────────────────────
// client ↔ 舞台坐标换算
// ──────────────────────────────────────────────

/** 舞台缩放比：舞台表层 client 宽 / 舞台宽。 */
export function stageScaleFromSurface(surfaceClientWidth: number, stageWidth: number): number {
  return stageWidth > 0 ? surfaceClientWidth / stageWidth : 1;
}

/** 部件 client rect → 舞台坐标 rect（减舞台原点、除以缩放比）。 */
export function clientRectToStage(part: ClientRect, surface: ClientRect, scale: number): StageRect {
  if (scale <= 0) return { x: 0, y: 0, width: 0, height: 0 };
  return {
    x: (part.left - surface.left) / scale,
    y: (part.top - surface.top) / scale,
    width: part.width / scale,
    height: part.height / scale,
  };
}

/** 舞台坐标 rect → client rect（overlay 选框定位用）。 */
export function stageRectToClient(rect: StageRect, surface: ClientRect, scale: number): ClientRect {
  return {
    left: surface.left + rect.x * scale,
    top: surface.top + rect.y * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  };
}

/** 指针位置（clientX/clientY）→ 舞台坐标点。 */
export function clientPointToStage(clientX: number, clientY: number, surface: ClientRect, scale: number): StagePoint {
  if (scale <= 0) return { x: 0, y: 0 };
  return { x: (clientX - surface.left) / scale, y: (clientY - surface.top) / scale };
}

// ──────────────────────────────────────────────
// move / resize（含最小尺寸与舞台边界钳制）
// ──────────────────────────────────────────────

/** 数值取整到 0.01（几何 token 落盘精度）。 */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 把 rect 钳制进舞台：尺寸 ∈ [最小值, 舞台尺寸]，位置保证整体在舞台内。 */
export function clampStageRect(rect: StageRect, stage: StageSize): StageRect {
  const width = Math.min(Math.max(rect.width, MIN_PART_WIDTH), stage.width);
  const height = Math.min(Math.max(rect.height, MIN_PART_HEIGHT), stage.height);
  const x = Math.min(Math.max(rect.x, 0), stage.width - width);
  const y = Math.min(Math.max(rect.y, 0), stage.height - height);
  return { x: round2(x), y: round2(y), width: round2(width), height: round2(height) };
}

/** 移动：只改 x/y，尺寸不动（nameBox 的 auto 宽高因此不会被误写）。 */
export function moveStageRect(start: StageRect, dx: number, dy: number, stage: StageSize): StageRect {
  return clampStageRect({ ...start, x: start.x + dx, y: start.y + dy }, stage);
}

/**
 * 四角缩放：被拖动的角随指针，对角锚定。边先钳进舞台，再保证最小尺寸
 * （锚定对边回推），最后再钳一次位置。宽高超限时不翻转部件。
 */
export function resizeStageRect(start: StageRect, corner: ResizeCorner, dx: number, dy: number, stage: StageSize): StageRect {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;

  if (corner === "nw" || corner === "sw") left += dx;
  if (corner === "ne" || corner === "se") right += dx;
  if (corner === "nw" || corner === "ne") top += dy;
  if (corner === "sw" || corner === "se") bottom += dy;

  // 边不越出舞台
  left = Math.min(Math.max(left, 0), stage.width);
  right = Math.min(Math.max(right, 0), stage.width);
  top = Math.min(Math.max(top, 0), stage.height);
  bottom = Math.min(Math.max(bottom, 0), stage.height);

  // 最小尺寸：锚定被拖动角的对边回推
  if (right - left < MIN_PART_WIDTH) {
    if (corner === "nw" || corner === "sw") left = right - MIN_PART_WIDTH;
    else right = left + MIN_PART_WIDTH;
  }
  if (bottom - top < MIN_PART_HEIGHT) {
    if (corner === "nw" || corner === "ne") top = bottom - MIN_PART_HEIGHT;
    else bottom = top + MIN_PART_HEIGHT;
  }

  // 回推可能把 left/top 推出舞台，再钳一次（此时对边不动，尺寸恢复变大）
  left = Math.max(left, 0);
  top = Math.max(top, 0);

  return {
    x: round2(left),
    y: round2(top),
    width: round2(right - left),
    height: round2(bottom - top),
  };
}

// ──────────────────────────────────────────────
// 几何 → token override 键值
// ──────────────────────────────────────────────

/**
 * 部件几何 → token override。move 只写 x/y（不触碰 width/height —— nameBox
 * 默认 auto 宽高只在 resize 时才从 DOM 现值写回具体 px，见 Spec 17 §7）。
 */
export function geometryTokenEntries(partName: string, rect: StageRect, includeSize: boolean): Record<string, number> {
  const entries: Record<string, number> = {
    [`${partName}.x`]: round2(rect.x),
    [`${partName}.y`]: round2(rect.y),
  };
  if (includeSize) {
    entries[`${partName}.width`] = round2(rect.width);
    entries[`${partName}.height`] = round2(rect.height);
  }
  return entries;
}

// ──────────────────────────────────────────────
// 命中与选择
// ──────────────────────────────────────────────

/**
 * 命中最上层部件：candidates 按 DOM 序（querySelectorAll 返回顺序），重叠时
 * 取 DOM 序最上 = 数组中最后一个命中项（Spec 17 §7）。
 */
export function pickTopmostPart<T extends { rect: StageRect }>(candidates: T[], point: StagePoint): T | null {
  let hit: T | null = null;
  for (const candidate of candidates) {
    const { rect } = candidate;
    if (
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.height
    ) {
      hit = candidate;
    }
  }
  return hit;
}

/** Tab 循环切换选中部件（DOM 序循环，支持 Shift+Tab 反向）。 */
export function cyclePartSelection(partNames: string[], current: string | null, delta: 1 | -1 = 1): string | null {
  if (partNames.length === 0) return null;
  const index = current ? partNames.indexOf(current) : -1;
  if (index < 0) return delta === 1 ? partNames[0] : partNames[partNames.length - 1];
  return partNames[(index + delta + partNames.length) % partNames.length];
}
