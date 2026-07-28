import { describe, expect, it } from "vitest";
import { fixedListWindow } from "./virtualWindow";

describe("fixedListWindow", () => {
  it("returns a bounded overscanned range", () => {
    const window = fixedListWindow(1_000, 10_000, 600, 40, 4);
    expect(window.start).toBe(246);
    expect(window.end).toBe(269);
    expect(window.paddingTop).toBe(window.start * 40);
    expect(window.paddingBottom).toBe((1_000 - window.end) * 40);
  });

  it("clamps empty and first-page ranges", () => {
    expect(fixedListWindow(0, 0, 600, 40)).toEqual({
      start: 0,
      end: 0,
      paddingTop: 0,
      paddingBottom: 0,
    });
    expect(fixedListWindow(10, 0, 600, 40).start).toBe(0);
    expect(fixedListWindow(10, 0, 600, 40).end).toBe(10);
  });
});
