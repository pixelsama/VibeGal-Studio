import { describe, expect, it } from "vitest";
import { computeStageFrameScale } from "./StageFrame";

describe("computeStageFrameScale", () => {
  it("fits a fixed stage into a wider container without stretching", () => {
    expect(computeStageFrameScale({ width: 1920, height: 800 }, { width: 1280, height: 720 })).toBeCloseTo(800 / 720);
  });

  it("fits a fixed stage into a taller container without stretching", () => {
    expect(computeStageFrameScale({ width: 960, height: 1080 }, { width: 1920, height: 1080 })).toBeCloseTo(0.5);
  });
});
