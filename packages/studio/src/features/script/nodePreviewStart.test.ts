import { describe, expect, it } from "vitest";
import { collectNodeStoryPoints, sliceNodeDataFromStoryPoint } from "./nodePreviewStart";

describe("node preview start helpers", () => {
  it("previewFromStoryPointStartsAtInstruction in node preview data", () => {
    const data = [
      { t: "set", key: "seen", value: true },
      { t: "say", id: "line_01", who: "hero", text: "before" },
      { t: "narrate", id: "line_02", text: "target" },
    ];

    expect(collectNodeStoryPoints(data).map((point) => point.id)).toEqual(["line_01", "line_02"]);
    expect(sliceNodeDataFromStoryPoint(data, "line_02")).toEqual([
      { t: "narrate", id: "line_02", text: "target" },
    ]);
  });
});
