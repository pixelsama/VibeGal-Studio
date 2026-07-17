import { describe, expect, it } from "vitest";
import { diffLines, externalDiffTexts, summarizeDiff } from "./externalDiff";

describe("diffLines", () => {
  it("returns all-same rows for identical texts", () => {
    const rows = diffLines("a\nb\nc", "a\nb\nc");

    expect(rows).toEqual([
      { type: "same", text: "a" },
      { type: "same", text: "b" },
      { type: "same", text: "c" },
    ]);
    expect(summarizeDiff(rows)).toEqual({ added: 0, removed: 0 });
  });

  it("marks added and removed lines", () => {
    const rows = diffLines("a\nb\nc", "a\nx\nc");

    expect(rows).toEqual([
      { type: "same", text: "a" },
      { type: "removed", text: "b" },
      { type: "added", text: "x" },
      { type: "same", text: "c" },
    ]);
    expect(summarizeDiff(rows)).toEqual({ added: 1, removed: 1 });
  });

  it("keeps common prefix and suffix out of the changed block", () => {
    const rows = diffLines("head\nold1\nold2\ntail", "head\nnew1\ntail");

    expect(rows).toEqual([
      { type: "same", text: "head" },
      { type: "removed", text: "old1" },
      { type: "removed", text: "old2" },
      { type: "added", text: "new1" },
      { type: "same", text: "tail" },
    ]);
  });

  it("treats empty before text as all-added", () => {
    const rows = diffLines("", "a\nb");

    expect(rows).toEqual([
      { type: "added", text: "a" },
      { type: "added", text: "b" },
    ]);
  });

  it("treats empty after text as all-removed", () => {
    const rows = diffLines("a\nb", "");

    expect(rows).toEqual([
      { type: "removed", text: "a" },
      { type: "removed", text: "b" },
    ]);
  });

  it("aligns moved lines instead of rewriting the whole block", () => {
    const rows = diffLines("a\nb\nc\nd", "a\nc\nb\nd");

    expect(rows).toEqual([
      { type: "same", text: "a" },
      { type: "removed", text: "b" },
      { type: "same", text: "c" },
      { type: "added", text: "b" },
      { type: "same", text: "d" },
    ]);
  });
});

describe("externalDiffTexts", () => {
  it("passes raw JSON through in json mode", () => {
    const view = externalDiffTexts({
      mode: "json",
      draftText: "[\n  1\n]",
      externalJsonText: "[\n  2\n]",
    });

    expect(view).toEqual({ beforeText: "[\n  1\n]", afterText: "[\n  2\n]" });
  });

  it("formats external JSON as scenario text in scenario mode", () => {
    const view = externalDiffTexts({
      mode: "scenario",
      draftText: "旧台词。",
      externalJsonText: JSON.stringify([{ t: "narrate", text: "夜深了。" }], null, 2),
    });

    expect(view).toEqual({ beforeText: "旧台词。", afterText: "夜深了。" });
  });

  it("falls back to raw external text when external JSON is unparseable", () => {
    const view = externalDiffTexts({
      mode: "scenario",
      draftText: "旧台词。",
      externalJsonText: "{not-json",
    });

    expect(view).toEqual({ beforeText: "旧台词。", afterText: "{not-json" });
  });
});
