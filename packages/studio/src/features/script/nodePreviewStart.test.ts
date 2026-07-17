import { describe, expect, it } from "vitest";
import { collectNodeStoryPoints, sliceNodeDataFromIndex } from "./nodePreviewStart";

describe("node preview start helpers", () => {
  it("collects story points with their instruction index", () => {
    const data = [
      { t: "set", key: "seen", value: true },
      { t: "say", id: "line_01", who: "hero", text: "before" },
      { t: "narrate", id: "line_02", text: "target" },
    ];

    expect(collectNodeStoryPoints(data)).toEqual([
      { index: 1, id: "line_01", label: "#2 line_01 · before" },
      { index: 2, id: "line_02", label: "#3 line_02 · target" },
    ]);
  });

  it("slices preview data from an instruction index with clamping", () => {
    const data = [
      { t: "say", id: "line_01", who: "hero", text: "before" },
      { t: "narrate", id: "line_02", text: "target" },
    ];

    expect(sliceNodeDataFromIndex(data, 1)).toEqual([{ t: "narrate", id: "line_02", text: "target" }]);
    expect(sliceNodeDataFromIndex(data, null)).toBe(data);
    expect(sliceNodeDataFromIndex(data, 99)).toEqual([]);
    expect(sliceNodeDataFromIndex(data, -3)).toEqual(data);
    expect(sliceNodeDataFromIndex(null, 1)).toBe(null);
  });
});
