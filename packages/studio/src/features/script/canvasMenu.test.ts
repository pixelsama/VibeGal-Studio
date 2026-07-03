import { describe, expect, it } from "vitest";
import { clampMenuPosition } from "./canvasMenu";

const VIEWPORT = { width: 1280, height: 820 };

describe("clampMenuPosition", () => {
  it("keeps position when there is enough room to the bottom-right", () => {
    expect(clampMenuPosition({ x: 400, y: 300 }, VIEWPORT)).toEqual({ x: 400, y: 300 });
  });

  it("flips left when too close to the right edge", () => {
    // 鼠标在 x=1200，菜单宽 200+padding，应被钳到 maxX
    const result = clampMenuPosition({ x: 1200, y: 300 }, VIEWPORT);
    expect(result.x).toBeLessThan(1200);
    expect(result.x).toBe(VIEWPORT.width - 200 - 8);
  });

  it("flips up when too close to the bottom edge", () => {
    const result = clampMenuPosition({ x: 400, y: 780 }, VIEWPORT);
    expect(result.y).toBeLessThan(780);
    expect(result.y).toBe(VIEWPORT.height - 200 - 8);
  });

  it("never goes below padding", () => {
    expect(clampMenuPosition({ x: 0, y: 0 }, VIEWPORT)).toEqual({ x: 8, y: 8 });
    expect(clampMenuPosition({ x: -50, y: -50 }, VIEWPORT)).toEqual({ x: 8, y: 8 });
  });

  it("respects custom menu size and padding", () => {
    const result = clampMenuPosition(
      { x: 500, y: 700 },
      { width: 800, height: 600 },
      { menuWidth: 160, menuHeight: 240, padding: 4 },
    );
    // 右边放得下（500+160 < 800），x 不变；y 钳到 600-240-4
    expect(result.x).toBe(500);
    expect(result.y).toBe(600 - 240 - 4);
  });
});
