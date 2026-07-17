import { describe, expect, it } from "vitest";
import { isEditableEventTarget, resolveUndoRedoShortcut } from "./graphShortcuts";

const base = { ctrlKey: false, metaKey: false, shiftKey: false, targetIsEditable: false };

describe("resolveUndoRedoShortcut", () => {
  it("maps Ctrl/Cmd+Z to undo", () => {
    expect(resolveUndoRedoShortcut({ ...base, key: "z", ctrlKey: true })).toBe("undo");
    expect(resolveUndoRedoShortcut({ ...base, key: "Z", metaKey: true })).toBe("undo");
  });

  it("maps Ctrl+Shift+Z / Cmd+Shift+Z / Ctrl+Y to redo", () => {
    expect(resolveUndoRedoShortcut({ ...base, key: "z", ctrlKey: true, shiftKey: true })).toBe("redo");
    expect(resolveUndoRedoShortcut({ ...base, key: "z", metaKey: true, shiftKey: true })).toBe("redo");
    expect(resolveUndoRedoShortcut({ ...base, key: "y", ctrlKey: true })).toBe("redo");
  });

  it("ignores keys without a modifier and non-undo keys", () => {
    expect(resolveUndoRedoShortcut({ ...base, key: "z" })).toBeNull();
    expect(resolveUndoRedoShortcut({ ...base, key: "a", ctrlKey: true })).toBeNull();
    expect(resolveUndoRedoShortcut({ ...base, key: "y", metaKey: true })).toBeNull();
  });

  it("leaves editable targets to the text editor's own undo stack", () => {
    expect(resolveUndoRedoShortcut({ ...base, key: "z", ctrlKey: true, targetIsEditable: true })).toBeNull();
    expect(resolveUndoRedoShortcut({ ...base, key: "y", ctrlKey: true, targetIsEditable: true })).toBeNull();
  });
});

describe("isEditableEventTarget", () => {
  it("passes null and plain elements", () => {
    expect(isEditableEventTarget(null)).toBe(false);
    const plain = { closest: () => null, isContentEditable: false };
    expect(isEditableEventTarget(plain as unknown as EventTarget)).toBe(false);
  });

  it("detects contenteditable and descendants of form controls", () => {
    expect(isEditableEventTarget({ isContentEditable: true } as unknown as EventTarget)).toBe(true);
    const insideInput = { closest: (selector: string) => (selector.includes("input") ? {} : null) };
    expect(isEditableEventTarget(insideInput as unknown as EventTarget)).toBe(true);
  });
});
