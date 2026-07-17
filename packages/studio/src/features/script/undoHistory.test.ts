import { describe, expect, it } from "vitest";
import {
  createUndoHistory,
  recordUndoCheckpoint,
  redoScenarioText,
  TYPING_COALESCE_MS,
  UNDO_HISTORY_LIMIT,
  undoScenarioText,
  undoShortcutType,
} from "./undoHistory";

describe("recordUndoCheckpoint", () => {
  it("coalesces typing inside the time window into a single step", () => {
    let history = createUndoHistory();
    history = recordUndoCheckpoint(history, "", { now: 1000 });
    history = recordUndoCheckpoint(history, "夜", { now: 1000 + TYPING_COALESCE_MS - 100 });
    history = recordUndoCheckpoint(history, "夜深", { now: 1000 + TYPING_COALESCE_MS - 50 });

    expect(history.past).toEqual([""]);
  });

  it("starts a new step once the typing window has passed", () => {
    let history = createUndoHistory();
    history = recordUndoCheckpoint(history, "", { now: 1000 });
    history = recordUndoCheckpoint(history, "夜深了。", { now: 1000 + TYPING_COALESCE_MS + 1 });

    expect(history.past).toEqual(["", "夜深了。"]);
  });

  it("always records programmatic edits as their own step", () => {
    let history = createUndoHistory();
    history = recordUndoCheckpoint(history, "", { now: 1000 });
    history = recordUndoCheckpoint(history, "夜深了。", { programmatic: true, now: 1001 });

    expect(history.past).toEqual(["", "夜深了。"]);
  });

  it("clears the redo stack on a new checkpoint and caps the history", () => {
    let history = createUndoHistory();
    history = recordUndoCheckpoint(history, "a", { now: 1000 });
    const undone = undoScenarioText(history, "b");
    expect(undone).not.toBeNull();
    history = recordUndoCheckpoint(undone!.history, "c", { now: 2000 });
    expect(history.future).toEqual([]);

    for (let index = 0; index < UNDO_HISTORY_LIMIT + 10; index += 1) {
      history = recordUndoCheckpoint(history, `text-${index}`, { now: 3000 + index * (TYPING_COALESCE_MS + 1) });
    }
    expect(history.past.length).toBe(UNDO_HISTORY_LIMIT);
  });
});

describe("undoScenarioText / redoScenarioText", () => {
  it("round-trips text through undo and redo", () => {
    let history = createUndoHistory();
    history = recordUndoCheckpoint(history, "第一句", { now: 1000 });

    const undone = undoScenarioText(history, "第一句\n第二句");
    expect(undone).not.toBeNull();
    expect(undone!.text).toBe("第一句");
    expect(undone!.history.future).toEqual(["第一句\n第二句"]);

    const redone = redoScenarioText(undone!.history, undone!.text);
    expect(redone).not.toBeNull();
    expect(redone!.text).toBe("第一句\n第二句");
    expect(redone!.history.past).toEqual(["第一句"]);
  });

  it("returns null when there is nothing to undo or redo", () => {
    const history = createUndoHistory();

    expect(undoScenarioText(history, "x")).toBeNull();
    expect(redoScenarioText(history, "x")).toBeNull();
  });

  it("treats an empty-string snapshot as a valid undo target", () => {
    let history = createUndoHistory();
    history = recordUndoCheckpoint(history, "", { now: 1000 });

    const undone = undoScenarioText(history, "模板文本");
    expect(undone).not.toBeNull();
    expect(undone!.text).toBe("");
  });
});

describe("undoShortcutType", () => {
  it("maps platform undo and redo shortcuts", () => {
    expect(undoShortcutType({ key: "z", ctrlKey: true, metaKey: false, shiftKey: false })).toBe("undo");
    expect(undoShortcutType({ key: "Z", ctrlKey: false, metaKey: true, shiftKey: false })).toBe("undo");
    expect(undoShortcutType({ key: "z", ctrlKey: true, metaKey: false, shiftKey: true })).toBe("redo");
    expect(undoShortcutType({ key: "z", ctrlKey: false, metaKey: true, shiftKey: true })).toBe("redo");
    expect(undoShortcutType({ key: "y", ctrlKey: true, metaKey: false, shiftKey: false })).toBe("redo");
    expect(undoShortcutType({ key: "z", ctrlKey: false, metaKey: false, shiftKey: false })).toBeNull();
    expect(undoShortcutType({ key: "y", ctrlKey: false, metaKey: true, shiftKey: false })).toBeNull();
  });
});
