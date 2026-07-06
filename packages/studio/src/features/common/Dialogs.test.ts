import { describe, expect, it } from "vitest";
import { dialogGlobalKeyAction, dialogTabTrapTarget } from "./Dialogs";

describe("dialogGlobalKeyAction", () => {
  it("only closes dialogs for Escape at the global key level", () => {
    expect(dialogGlobalKeyAction("Escape")).toBe("close");
    expect(dialogGlobalKeyAction("Enter")).toBe("none");
    expect(dialogGlobalKeyAction(" ")).toBe("none");
  });
});

describe("dialogTabTrapTarget", () => {
  it("wraps Tab from the last focusable element to the first", () => {
    expect(dialogTabTrapTarget(3, 2, false)).toEqual({ type: "focusable", index: 0 });
  });

  it("wraps Shift+Tab from the first focusable element to the last", () => {
    expect(dialogTabTrapTarget(3, 0, true)).toEqual({ type: "focusable", index: 2 });
  });

  it("lets native tab order handle focus movement inside the dialog", () => {
    expect(dialogTabTrapTarget(3, 1, false)).toEqual({ type: "none" });
    expect(dialogTabTrapTarget(3, 1, true)).toEqual({ type: "none" });
  });

  it("keeps focus inside when only one focusable element exists", () => {
    expect(dialogTabTrapTarget(1, 0, false)).toEqual({ type: "focusable", index: 0 });
    expect(dialogTabTrapTarget(1, 0, true)).toEqual({ type: "focusable", index: 0 });
  });

  it("moves stray focus back into the dialog", () => {
    expect(dialogTabTrapTarget(2, -1, false)).toEqual({ type: "focusable", index: 0 });
    expect(dialogTabTrapTarget(2, -1, true)).toEqual({ type: "focusable", index: 1 });
  });

  it("falls back to the dialog container when no focusable element exists", () => {
    expect(dialogTabTrapTarget(0, -1, false)).toEqual({ type: "container" });
  });
});
