import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createInitialState } from "@vibegal/engine";
import { isRuntimeStateEmpty, RuntimeStateInspector } from "./RuntimeStateInspector";

describe("RuntimeStateInspector", () => {
  it("renders current runtime state details for debug preview", () => {
    const state = {
      ...createInitialState(),
      vars: { affection: 3, has_key: true },
      background: "school",
      speaker: { id: "hero", name: "Hero", color: "#fff", expr: "smile" },
      sprites: [{ id: "hero", pos: "center", expr: "smile", changeId: 1, justEntered: false, prevExpr: null, prevPos: null, trans: "fade", leaving: false }],
      audio: { bgm: { id: "theme", fade: 500, loop: true }, sfx: [], voice: { id: "line01", seq: 1 } },
    };

    const html = renderToStaticMarkup(createElement(RuntimeStateInspector, { state, currentNodeLabel: "序章 (prologue)" }));

    expect(html).toContain("序章 (prologue)");
    expect(html).toContain("school");
    expect(html).toContain("Hero");
    expect(html).toContain("theme");
    expect(html).toContain("affection");
  });

  it("collapses the field dump into a hint while the preview state is empty", () => {
    const state = createInitialState();

    expect(isRuntimeStateEmpty(state)).toBe(true);

    const html = renderToStaticMarkup(createElement(RuntimeStateInspector, { state, currentNodeLabel: "开始 (start)" }));

    expect(html).toContain("开始 (start)");
    expect(html).toContain("预览运行后");
    expect(html).not.toContain("BGM");
    expect(html).not.toContain("Sprites");
  });

  it("keeps the full field dump once any runtime state exists", () => {
    const state = { ...createInitialState(), background: "school" };

    expect(isRuntimeStateEmpty(state)).toBe(false);

    const html = renderToStaticMarkup(createElement(RuntimeStateInspector, { state }));

    expect(html).toContain("school");
    expect(html).toContain("BGM");
    expect(html).not.toContain("预览运行后");
  });
});
