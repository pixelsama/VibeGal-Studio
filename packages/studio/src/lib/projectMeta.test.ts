import { describe, expect, it } from "vitest";
import {
  DEFAULT_STAGE_RESOLUTION,
  readStageResolution,
  withStageResolution,
} from "./projectMeta";

describe("project meta helpers", () => {
  it("uses the default stage resolution when meta has no stage", () => {
    expect(readStageResolution({ title: "T" })).toEqual(DEFAULT_STAGE_RESOLUTION);
  });

  it("reads a valid fixed stage resolution from project meta", () => {
    expect(readStageResolution({ stage: { width: 1920, height: 1080 } })).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it("preserves existing meta fields when writing stage resolution", () => {
    expect(withStageResolution({ title: "T", autoAdvanceMs: 1200 }, { width: 1280, height: 720 })).toEqual({
      title: "T",
      autoAdvanceMs: 1200,
      stage: { width: 1280, height: 720 },
    });
  });
});
