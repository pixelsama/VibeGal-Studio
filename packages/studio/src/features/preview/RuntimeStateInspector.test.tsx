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
    expect(html).not.toContain("背景音乐");
    expect(html).not.toContain("角色立绘");
  });

  it("keeps the full field dump once any runtime state exists", () => {
    const state = { ...createInitialState(), background: "school" };

    expect(isRuntimeStateEmpty(state)).toBe(false);

    const html = renderToStaticMarkup(createElement(RuntimeStateInspector, { state }));

    expect(html).toContain("school");
    expect(html).toContain("背景音乐");
    expect(html).not.toContain("预览运行后");
  });

  it("drops its own title and side border when docked into a bottom sheet", () => {
    const state = { ...createInitialState(), background: "school" };

    const html = renderToStaticMarkup(createElement(RuntimeStateInspector, { state, dock: "bottom" }));

    expect(html).toContain("school");
    expect(html).not.toContain("运行状态");
    expect(html).not.toContain("border-left");
  });

  it("uses creator-facing Chinese labels and keeps technical terms inside folded details", () => {
    const state = {
      ...createInitialState(),
      vars: {
        affection: 3,
        route_done: true,
        legacy: "x",
        "system.playthroughCount": 2,
        "system.lastEndingId": null,
      },
    };
    const registry = { version: 1 as const, variables: {
      affection: { label: "好感度", type: "number" as const, default: 0, nullable: false, scope: "run" as const },
      route_done: { label: "路线已完成", type: "boolean" as const, default: false, nullable: false, scope: "global" as const },
    } };
    const html = renderToStaticMarkup(createElement(RuntimeStateInspector, { state, registry }));

    for (const text of ["运行状态", "选项", "背景音乐", "语音", "角色立绘", "变量"]) {
      expect(html).toContain(text);
    }
    for (const group of ["本轮变量", "跨周目变量", "未声明变量", "系统状态"]) {
      expect(html).toContain(group);
    }
    expect(html).toContain("好感度");
    expect(html).toContain("路线已完成");
    expect(html).toContain("通关次数");
    expect(html).toContain("上次达成结局");
    expect(html).toContain("尚无");
    expect(html).toContain("<summary>技术详情</summary>");
    expect(html).toMatch(/<details[^>]*><summary>技术详情<\/summary>[\s\S]*system\.playthroughCount/);
    expect(html).toMatch(/<details[^>]*><summary>技术详情<\/summary>[\s\S]*system\.lastEndingId/);
    expect(html).not.toContain("<details open");
  });

  it("keeps variable rows shrinkable inside a narrow runtime sidebar", () => {
    const state = {
      ...createInitialState(),
      vars: { a_very_long_creator_variable_identifier_that_must_not_expand_the_sidebar: 3 },
    };
    const html = renderToStaticMarkup(createElement(RuntimeStateInspector, {
      state,
      onVariableChange: () => {},
      onResetVariables: () => {},
    }));

    expect(html).toContain("min-width:0");
    expect(html).toContain("grid-template-columns:minmax(0, 1fr)");
    expect(html).toContain("width:100%");
    expect(html).not.toContain("overflow-x:auto");
  });
});
