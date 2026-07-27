import { describe, expect, it } from "vitest";
import { clampStageFrameZoom, computeStageFrameScale } from "./StageFrame";

describe("computeStageFrameScale", () => {
  it("fits a fixed stage into a wider container without stretching", () => {
    expect(computeStageFrameScale({ width: 1920, height: 800 }, { width: 1280, height: 720 })).toBeCloseTo(800 / 720);
  });

  it("fits a fixed stage into a taller container without stretching", () => {
    expect(computeStageFrameScale({ width: 960, height: 1080 }, { width: 1920, height: 1080 })).toBeCloseTo(0.5);
  });
});

describe("clampStageFrameZoom", () => {
  it("把设计画布查看倍率限制在 50% 到 200%", () => {
    expect(clampStageFrameZoom(0.1)).toBe(0.5);
    expect(clampStageFrameZoom(1.25)).toBe(1.25);
    expect(clampStageFrameZoom(4)).toBe(2);
    expect(clampStageFrameZoom(Number.NaN)).toBe(1);
  });
});
