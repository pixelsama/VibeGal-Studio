import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SetInstr, VariableRegistry } from "@vibegal/engine";
import type { GraphEdge, ProjectGraph } from "../../lib/types";
import { resolveCatalogMessage, StudioI18nProvider } from "../../lib/i18n";
import { EdgeEffectsEditor, defaultEffect, describeEdgeEffects } from "./EdgeEffectsEditor";
import { normalizeBranchEdge } from "./BranchRules";

const registry: VariableRegistry = {
  version: 1,
  variables: {
    affection: {
      kind: "meter", type: "number", default: 0, nullable: false, scope: "run", label: "好感度", min: 0, max: 100,
    },
    has_key: { kind: "flag", type: "boolean", default: false, nullable: false, scope: "run", label: "拿到钥匙" },
    route: {
      kind: "state", type: "string", default: "common", nullable: false, scope: "run", label: "当前路线",
      options: [{ id: "common", label: "共通线" }, { id: "yuki", label: "雪线" }],
    },
  },
};

const render = (effects?: SetInstr[], disabled = false) => renderToStaticMarkup(createElement(EdgeEffectsEditor, {
  effects, registry, disabled, onChange: () => {},
}));

describe("EdgeEffectsEditor", () => {
  it("offers to add an effect in the author's words", () => {
    expect(render()).toContain("走这条之后…");
  });

  it("reuses the increase/decrease/set sentence from node instructions", () => {
    const html = render([{ t: "set", key: "affection", expr: "affection + 3" }]);
    expect(html).toContain("走这条之后");
    expect(html).toContain("好感度");
    expect(html).toContain("增加");
    expect(html).toMatch(/aria-checked="true"[^>]*>增加/);
  });

  it("stays silent and unclickable when read-only and empty", () => {
    expect(render(undefined, true)).toBe("");
  });

  it("cannot add an effect when the project has no story state yet", () => {
    const html = renderToStaticMarkup(createElement(EdgeEffectsEditor, {
      registry: { version: 1, variables: {} },
      onChange: () => {},
    }));
    expect(html).toContain("disabled");
    expect(html).toContain("先在「故事状态」里建一个状态");
  });

  it("renders English actions while preserving story-state names", () => {
    const html = renderToStaticMarkup(createElement(
      StudioI18nProvider,
      { preference: "en" },
      createElement(EdgeEffectsEditor, {
        effects: [{ t: "set", key: "affection", expr: "affection + 3" }],
        registry,
        onChange: () => {},
      }),
    ));

    expect(html).toContain("After taking this exit");
    expect(html).toContain("Add another");
    expect(html).toContain("Increase");
    expect(html).toContain("好感度");
    expect(html).not.toContain("走这条之后");
  });
});

describe("defaultEffect", () => {
  it("starts a meter on the most common action,累加", () => {
    expect(defaultEffect("affection", registry)).toEqual({ t: "set", key: "affection", expr: "affection + 1" });
  });

  it("starts a flag as 已发生", () => {
    expect(defaultEffect("has_key", registry)).toEqual({ t: "set", key: "has_key", value: true });
  });

  it("starts a state on its declared default so the value is always legal", () => {
    expect(defaultEffect("route", registry)).toEqual({ t: "set", key: "route", value: "common" });
  });
});

describe("describeEdgeEffects", () => {
  it("summarises effects as a sentence", () => {
    expect(describeEdgeEffects([
      { t: "set", key: "affection", expr: "affection + 3" },
      { t: "set", key: "has_key", value: true },
    ], registry)).toBe("好感度 增加 3；拿到钥匙 标记为已发生");
  });

  it("does not pretend to read an arbitrary expression", () => {
    expect(describeEdgeEffects([{ t: "set", key: "affection", expr: "affection * 2" }], registry))
      .toBe("好感度 由表达式计算");
  });

  it("is empty when there is nothing attached", () => {
    expect(describeEdgeEffects(undefined, registry)).toBe("");
    expect(describeEdgeEffects([], registry)).toBe("");
  });

  it("localizes summaries without translating creator-authored labels", () => {
    expect(describeEdgeEffects(
      [
        { t: "set", key: "affection", expr: "affection + 3" },
        { t: "set", key: "has_key", value: true },
      ],
      registry,
      (key, params) => resolveCatalogMessage("en", key, params),
    )).toBe("Increase 好感度 by 3; Mark 拿到钥匙 as happened");
  });
});

describe("effects survive branch edits", () => {
  const graph: ProjectGraph = {
    version: 1,
    entryNodeId: "start",
    chapters: [{ id: "c1", title: "第一章" }],
    nodes: [
      { id: "start", title: "天台", file: "nodes/start.json", chapterId: "c1", position: { x: 0, y: 0 } },
      { id: "morning", title: "早上", file: "nodes/morning.json", chapterId: "c1", position: { x: 200, y: 0 } },
    ],
    edges: [],
  };
  const edge: GraphEdge = {
    id: "start__morning", from: "start", to: "morning", mode: "choice", label: "留下", condition: null,
    effects: [{ t: "set", key: "affection", expr: "affection + 3" }],
  };

  it("keeps effects when the author switches to automatic branching", () => {
    // effects 与 choice/auto 无关，切换分流方式不该把作者写好的加分丢掉。
    expect(normalizeBranchEdge(graph, "start", edge, 0, "auto").effects).toEqual(edge.effects);
  });

  it("keeps effects when switching back to a player choice", () => {
    expect(normalizeBranchEdge(graph, "start", edge, 0, "choice").effects).toEqual(edge.effects);
  });
});
