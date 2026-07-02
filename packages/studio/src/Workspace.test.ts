import { describe, expect, it } from "vitest";
import { shouldStartWindowDrag } from "./Workspace";

function targetWithClosest(result: Element | null): EventTarget {
  return {
    closest: () => result,
  } as unknown as EventTarget;
}

describe("shouldStartWindowDrag", () => {
  it("starts dragging when the primary button presses a non-interactive title bar area", () => {
    expect(shouldStartWindowDrag({ button: 0, target: targetWithClosest(null) })).toBe(true);
  });

  it("does not start dragging from interactive controls", () => {
    expect(shouldStartWindowDrag({ button: 0, target: targetWithClosest({} as Element) })).toBe(false);
  });

  it("does not start dragging from non-primary mouse buttons", () => {
    expect(shouldStartWindowDrag({ button: 1, target: targetWithClosest(null) })).toBe(false);
  });

  it("allows dragging when the event target has no closest helper", () => {
    expect(shouldStartWindowDrag({ button: 0, target: {} as EventTarget })).toBe(true);
  });
});
