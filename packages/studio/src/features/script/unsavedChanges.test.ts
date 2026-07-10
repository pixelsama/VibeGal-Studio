import { describe, expect, it, vi } from "vitest";
import {
  confirmUnsavedNavigation,
  isDraftSnapshotCurrent,
  isSaveKeyboardShortcut,
  preventUnloadWhenDirty,
} from "./unsavedChanges";

describe("unsaved changes guard", () => {
  it("recognizes Cmd/Ctrl+S without hijacking unrelated shortcuts", () => {
    expect(isSaveKeyboardShortcut({ key: "s", metaKey: true, ctrlKey: false })).toBe(true);
    expect(isSaveKeyboardShortcut({ key: "S", metaKey: false, ctrlKey: true })).toBe(true);
    expect(isSaveKeyboardShortcut({ key: "s", metaKey: false, ctrlKey: false })).toBe(false);
    expect(isSaveKeyboardShortcut({ key: "p", metaKey: true, ctrlKey: false })).toBe(false);
  });

  it("prevents browser unload only while a draft is dirty", () => {
    const cleanEvent = { preventDefault: vi.fn(), returnValue: undefined as string | undefined };
    const dirtyEvent = { preventDefault: vi.fn(), returnValue: undefined as string | undefined };

    expect(preventUnloadWhenDirty(cleanEvent, false)).toBe(false);
    expect(cleanEvent.preventDefault).not.toHaveBeenCalled();
    expect(preventUnloadWhenDirty(dirtyEvent, true)).toBe(true);
    expect(dirtyEvent.preventDefault).toHaveBeenCalledOnce();
    expect(dirtyEvent.returnValue).toBe("");
  });

  it("asks before internal navigation when the node draft is dirty", () => {
    const confirm = vi.fn(() => false);

    expect(confirmUnsavedNavigation(true, confirm)).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirmUnsavedNavigation(false, confirm)).toBe(true);
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("only clears the draft that was current when an async save started", () => {
    expect(isDraftSnapshotCurrent(3, 3)).toBe(true);
    expect(isDraftSnapshotCurrent(3, 4)).toBe(false);
  });
});
