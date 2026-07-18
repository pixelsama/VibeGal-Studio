import { describe, expect, it } from "vitest";
import {
  MIN_PART_HEIGHT,
  MIN_PART_WIDTH,
  clampStageRect,
  clientPointToStage,
  clientRectToStage,
  cyclePartSelection,
  geometryTokenEntries,
  moveStageRect,
  pickTopmostPart,
  resizeStageRect,
  round2,
  stageRectToClient,
  stageScaleFromSurface,
  supportsLayoutParts,
  type ClientRect,
  type StageRect,
} from "./stageLayout";

const STAGE = { width: 1280, height: 720 };
/** 舞台表层 client rect：1280×720 舞台按 0.5 缩放、偏移 (100, 50)。 */
const SURFACE: ClientRect = { left: 100, top: 50, width: 640, height: 360 };
const SCALE = 0.5;

describe("supportsLayoutParts", () => {
  it("capabilities 含 layout-parts-v1 才为真", () => {
    expect(supportsLayoutParts(["layout-parts-v1"])).toBe(true);
    expect(supportsLayoutParts(["player-ui-v1", "layout-parts-v1"])).toBe(true);
    expect(supportsLayoutParts(["player-ui-v1"])).toBe(false);
    expect(supportsLayoutParts([])).toBe(false);
    expect(supportsLayoutParts(undefined)).toBe(false);
    expect(supportsLayoutParts(null)).toBe(false);
  });
});

describe("client ↔ 舞台坐标换算", () => {
  it("stageScaleFromSurface = 表层 client 宽 / 舞台宽", () => {
    expect(stageScaleFromSurface(640, 1280)).toBe(0.5);
    expect(stageScaleFromSurface(320, 1280)).toBe(0.25);
    expect(stageScaleFromSurface(640, 0)).toBe(1);
  });

  it("clientRectToStage：减舞台原点、除以缩放比", () => {
    const part: ClientRect = { left: 200, top: 150, width: 320, height: 90 };
    expect(clientRectToStage(part, SURFACE, SCALE)).toEqual({ x: 200, y: 200, width: 640, height: 180 });
  });

  it("clientRectToStage：scale 非法时返回零矩形（防御）", () => {
    const part: ClientRect = { left: 200, top: 150, width: 320, height: 90 };
    expect(clientRectToStage(part, SURFACE, 0)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it("stageRectToClient 是 clientRectToStage 的逆变换", () => {
    const stageRect: StageRect = { x: 77.08, y: 497, width: 1125.84, height: 175 };
    const client = stageRectToClient(stageRect, SURFACE, SCALE);
    // 浮点往返用近似比较（0.5 缩放下 77.08 无精确二进制表示）
    const roundTrip = clientRectToStage(client, SURFACE, SCALE);
    expect(roundTrip.x).toBeCloseTo(stageRect.x);
    expect(roundTrip.y).toBeCloseTo(stageRect.y);
    expect(roundTrip.width).toBeCloseTo(stageRect.width);
    expect(roundTrip.height).toBeCloseTo(stageRect.height);
    // 绝对值核对：left = 100 + 77.08*0.5
    expect(client.left).toBeCloseTo(138.54);
    expect(client.width).toBeCloseTo(562.92);
  });

  it("clientPointToStage：指针位置换算", () => {
    expect(clientPointToStage(740, 410, SURFACE, SCALE)).toEqual({ x: 1280, y: 720 });
    expect(clientPointToStage(100, 50, SURFACE, SCALE)).toEqual({ x: 0, y: 0 });
  });
});

describe("round2", () => {
  it("取整到 0.01", () => {
    expect(round2(1.23456)).toBe(1.23);
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(100)).toBe(100);
  });
});

describe("clampStageRect", () => {
  it("尺寸钳到 [最小值, 舞台尺寸]，位置保持在舞台内", () => {
    expect(clampStageRect({ x: 10, y: 10, width: 5, height: 5 }, STAGE)).toEqual({
      x: 10, y: 10, width: MIN_PART_WIDTH, height: MIN_PART_HEIGHT,
    });
    expect(clampStageRect({ x: 0, y: 0, width: 2000, height: 1000 }, STAGE)).toEqual({
      x: 0, y: 0, width: 1280, height: 720,
    });
    expect(clampStageRect({ x: -50, y: -20, width: 100, height: 100 }, STAGE)).toEqual({
      x: 0, y: 0, width: 100, height: 100,
    });
    expect(clampStageRect({ x: 1250, y: 700, width: 100, height: 100 }, STAGE)).toEqual({
      x: 1180, y: 620, width: 100, height: 100,
    });
  });
});

describe("moveStageRect", () => {
  const start: StageRect = { x: 100, y: 100, width: 200, height: 100 };

  it("正常移动并保留尺寸", () => {
    expect(moveStageRect(start, 30, -20, STAGE)).toEqual({ x: 130, y: 80, width: 200, height: 100 });
  });

  it("移出舞台被钳制", () => {
    expect(moveStageRect(start, -500, -500, STAGE)).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    expect(moveStageRect(start, 5000, 5000, STAGE)).toEqual({ x: 1080, y: 620, width: 200, height: 100 });
  });
});

describe("resizeStageRect", () => {
  const start: StageRect = { x: 100, y: 100, width: 200, height: 100 };

  it("se 角：右下角随指针，左上角锚定", () => {
    expect(resizeStageRect(start, "se", 50, 30, STAGE)).toEqual({ x: 100, y: 100, width: 250, height: 130 });
  });

  it("nw 角：左上角随指针，右下角锚定", () => {
    expect(resizeStageRect(start, "nw", 20, 10, STAGE)).toEqual({ x: 120, y: 110, width: 180, height: 90 });
  });

  it("ne/sw 角方向正确", () => {
    expect(resizeStageRect(start, "ne", 30, 20, STAGE)).toEqual({ x: 100, y: 120, width: 230, height: 80 });
    expect(resizeStageRect(start, "sw", -20, 10, STAGE)).toEqual({ x: 80, y: 100, width: 220, height: 110 });
  });

  it("缩到小于最小尺寸时锚定对边回推，不翻转", () => {
    // se 角向左上拖过头：宽/高钳到最小值
    expect(resizeStageRect(start, "se", -1000, -1000, STAGE)).toEqual({
      x: 100, y: 100, width: MIN_PART_WIDTH, height: MIN_PART_HEIGHT,
    });
    // nw 角向右下拖过头：x/y 停在 right/bottom - 最小尺寸
    expect(resizeStageRect(start, "nw", 1000, 1000, STAGE)).toEqual({
      x: 300 - MIN_PART_WIDTH, y: 200 - MIN_PART_HEIGHT, width: MIN_PART_WIDTH, height: MIN_PART_HEIGHT,
    });
  });

  it("拖出舞台的边被钳制", () => {
    // se 角拖出右下边界
    expect(resizeStageRect(start, "se", 5000, 5000, STAGE)).toEqual({
      x: 100, y: 100, width: 1180, height: 620,
    });
    // nw 角拖出左上边界
    expect(resizeStageRect(start, "nw", -500, -500, STAGE)).toEqual({
      x: 0, y: 0, width: 300, height: 200,
    });
  });

  it("结果取整到 0.01", () => {
    const result = resizeStageRect(start, "se", 33.333, 0, STAGE);
    expect(result.width).toBe(233.33);
  });
});

describe("geometryTokenEntries", () => {
  it("move（includeSize=false）只写 x/y，不触碰 auto 宽高", () => {
    expect(geometryTokenEntries("dialogueBox", { x: 120.005, y: 480, width: 900, height: 200 }, false)).toEqual({
      "dialogueBox.x": 120.01,
      "dialogueBox.y": 480,
    });
  });

  it("resize 写全四个几何值（nameBox auto 宽高借此落为具体 px）", () => {
    expect(geometryTokenEntries("nameBox", { x: 102.08, y: 481, width: 140, height: 30.004 }, true)).toEqual({
      "nameBox.x": 102.08,
      "nameBox.y": 481,
      "nameBox.width": 140,
      "nameBox.height": 30,
    });
  });
});

describe("pickTopmostPart", () => {
  const parts = [
    { name: "a", rect: { x: 0, y: 0, width: 100, height: 100 } },
    { name: "b", rect: { x: 50, y: 50, width: 100, height: 100 } },
    { name: "c", rect: { x: 500, y: 500, width: 100, height: 100 } },
  ];

  it("重叠时取 DOM 序最后（最上层）的命中项", () => {
    expect(pickTopmostPart(parts, { x: 75, y: 75 })?.name).toBe("b");
    expect(pickTopmostPart(parts, { x: 25, y: 25 })?.name).toBe("a");
  });

  it("未命中返回 null", () => {
    expect(pickTopmostPart(parts, { x: 300, y: 300 })).toBeNull();
  });
});

describe("cyclePartSelection", () => {
  const names = ["dialogueBox", "nameBox"];

  it("无选中时从第一个开始（反向从最后一个）", () => {
    expect(cyclePartSelection(names, null, 1)).toBe("dialogueBox");
    expect(cyclePartSelection(names, null, -1)).toBe("nameBox");
  });

  it("循环切换并回绕", () => {
    expect(cyclePartSelection(names, "dialogueBox", 1)).toBe("nameBox");
    expect(cyclePartSelection(names, "nameBox", 1)).toBe("dialogueBox");
    expect(cyclePartSelection(names, "dialogueBox", -1)).toBe("nameBox");
  });

  it("空列表返回 null", () => {
    expect(cyclePartSelection([], null, 1)).toBeNull();
  });
});
