import { describe, expect, it } from "vitest";
import { graphFocusTargetFromIssue, shouldStartWindowDrag } from "./Workspace";

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

describe("graphFocusTargetFromIssue", () => {
  it("creates a node focus request for graph issues with nodeId", () => {
    expect(graphFocusTargetFromIssue({ source: "graph", nodeId: "intro" }, 3)).toEqual({
      requestId: 3,
      nodeId: "intro",
    });
  });

  it("creates an edge focus request for graph issues with edgeId", () => {
    expect(graphFocusTargetFromIssue({ source: "graph", edgeId: "intro__end" }, 4)).toEqual({
      requestId: 4,
      edgeId: "intro__end",
    });
  });

  it("ignores non-graph issues", () => {
    expect(graphFocusTargetFromIssue({ source: "asset", nodeId: "intro" }, 1)).toBeNull();
    expect(graphFocusTargetFromIssue({ source: "manifest" }, 1)).toBeNull();
  });
});
