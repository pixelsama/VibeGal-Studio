import { describe, expect, it } from "vitest";
import { clampCompletionIndex, moveCompletionIndex } from "./completionNavigation";

describe("completion navigation", () => {
  it("normalizes an invalid index and keeps it inside the candidate list", () => {
    expect(clampCompletionIndex(Number.NaN, 3)).toBe(0);
    expect(clampCompletionIndex(Number.POSITIVE_INFINITY, 3)).toBe(0);
    expect(clampCompletionIndex(-4, 3)).toBe(0);
    expect(clampCompletionIndex(8, 3)).toBe(2);
    expect(clampCompletionIndex(1.9, 3)).toBe(1);
    expect(clampCompletionIndex(2, 0)).toBe(0);
  });

  it("wraps keyboard movement and safely handles an empty list", () => {
    expect(moveCompletionIndex(0, -1, 3)).toBe(2);
    expect(moveCompletionIndex(2, 1, 3)).toBe(0);
    expect(moveCompletionIndex(Number.NaN, 1, 3)).toBe(1);
    expect(moveCompletionIndex(0, 1, 0)).toBe(0);
  });
});
