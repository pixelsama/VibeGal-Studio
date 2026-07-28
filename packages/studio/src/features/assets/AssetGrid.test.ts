import { describe, expect, it } from "vitest";
import { assetGridWindow } from "./AssetGrid";

describe("assetGridWindow", () => {
  it("mounts a bounded overscanned slice for large grids", () => {
    const first = assetGridWindow(500, 900, 640, 0);
    const middle = assetGridWindow(500, 900, 640, 8_000);

    expect(first.columns).toBe(4);
    expect(first.start).toBe(0);
    expect(first.end).toBeLessThan(40);
    expect(middle.start).toBeGreaterThan(0);
    expect(middle.end - middle.start).toBeLessThan(50);
    expect(middle.totalHeight).toBe(first.totalHeight);
  });

  it("keeps the logical item count independent from the mounted window", () => {
    const window = assetGridWindow(3, 200, 200, 999);
    expect(window.columns).toBe(1);
    expect(window.end).toBe(3);
    expect(window.totalHeight).toBeGreaterThan(700);
  });
});
