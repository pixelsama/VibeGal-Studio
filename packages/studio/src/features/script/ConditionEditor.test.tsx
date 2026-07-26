import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Manifest, VariableRegistry } from "@vibegal/engine";
import type { ProjectGraph } from "../../lib/types";
import { ConditionEditor, describeCondition } from "./ConditionEditor";
import { collectStateSources } from "./storyState";

const registry: VariableRegistry = {
  version: 1,
  variables: {
    affection_yuki: {
      kind: "meter", type: "number", default: 0, nullable: false, scope: "run",
      label: "好感度", of: "yuki", min: 0, max: 100,
      bands: [{ id: "cold", label: "冷淡", upTo: 29 }, { id: "care", label: "在意", upTo: 59 }, { id: "love", label: "喜欢" }],
    },
    has_key: { kind: "flag", type: "boolean", default: false, nullable: false, scope: "run", label: "拿到钥匙" },
    route: {
      kind: "state", type: "string", default: "common", nullable: false, scope: "run", label: "当前路线",
      options: [{ id: "common", label: "共通线" }, { id: "yuki", label: "雪线" }],
    },
  },
};

const manifest = {
  characters: { yuki: { name: "雪", color: "#fff", sprites: {} } },
  backgrounds: {},
  audio: { bgm: {}, sfx: {}, voice: {} },
} as unknown as Manifest;

const graph: ProjectGraph = {
  version: 1,
  entryNodeId: "rooftop",
  chapters: [{ id: "c1", title: "第一章" }],
  nodes: [
    { id: "rooftop", title: "天台·夜", file: "nodes/rooftop.json", chapterId: "c1", position: { x: 0, y: 0 } },
    { id: "stay", title: "留下", file: "nodes/stay.json", chapterId: "c1", position: { x: 200, y: 0 } },
  ],
  edges: [{ id: "rooftop__stay", from: "rooftop", to: "stay", mode: "choice", label: "陪她留下", condition: null }],
};

const sources = collectStateSources({ registry, graph, manifest });
const render = (source: string) => renderToStaticMarkup(createElement(ConditionEditor, {
  source, sources, onChange: () => {},
}));

describe("ConditionEditor", () => {
  it("reads a threshold as a band name, never as an operator", () => {
    const html = render("affection_yuki >= 60");
    expect(html).toContain("雪 · 好感度");
    expect(html).toContain("达到");
    expect(html).toContain("喜欢");
    expect(html).not.toContain(">=");
  });

  it("says a bare flag as 已发生 and offers only the two flag phrasings", () => {
    const html = render("has_key");
    expect(html).toContain("拿到钥匙");
    expect(html).toMatch(/value="happened" selected/);
    expect(html).toContain("还没发生");
    // 旗标不该出现数值/相等类判断方式。
    expect(html).not.toContain("达到");
    expect(html).not.toContain(">是<");
  });

  it("labels clause connectives as 如果 / 并且", () => {
    const html = render("has_key && affection_yuki >= 60");
    expect(html).toContain("如果");
    expect(html).toContain("并且");
    expect(html).not.toContain("AND");
    expect(html).not.toContain("&&");
  });

  it("labels an any-of chain as 或者 and preselects 任一满足", () => {
    const html = render("has_key || affection_yuki >= 60");
    expect(html).toContain("或者");
    expect(html).toMatch(/aria-checked="true"[^>]*>任一满足/);
  });

  it("offers declared options for a state instead of a free text box", () => {
    const html = render('route == "yuki"');
    expect(html).toContain("当前路线");
    expect(html).toContain("雪线");
    expect(html).toContain("共通线");
  });

  it("offers story experience nobody declared", () => {
    const html = render("chose.rooftop__stay");
    expect(html).toContain("在「天台·夜」选了「陪她留下」");
    expect(html).toContain("剧情经历");
  });

  it("keeps an unrepresentable expression as-is rather than mangling it", () => {
    const html = render("affection_yuki + 1 >= trust");
    expect(html).toContain("gs-condition--raw");
    expect(html).toContain("这条判断用了表达式写法");
  });

  it("explains that an empty condition is the fallback branch", () => {
    const html = render("");
    expect(html).toContain("前面的分支都不成立时，走这一条");
  });

  it("marks a reference whose variable was deleted", () => {
    const html = render("deleted_variable >= 1");
    expect(html).toContain("deleted_variable（已失效）");
    expect(html).toContain('aria-invalid="true"');
  });

  it("hides mutation affordances when disabled", () => {
    const html = renderToStaticMarkup(createElement(ConditionEditor, {
      source: "has_key", sources, disabled: true, onChange: () => {},
    }));
    expect(html).not.toContain("添加条件");
    expect(html).not.toContain("删除第 1 个条件");
  });
});

describe("describeCondition", () => {
  it("renders a one-line summary in creator vocabulary", () => {
    expect(describeCondition("affection_yuki >= 60 && has_key", sources))
      .toBe("雪 · 好感度 达到 喜欢 并且 拿到钥匙 已发生");
  });

  it("names the fallback branch 否则", () => {
    expect(describeCondition("", sources)).toBe("否则");
  });

  it("falls back to the raw expression when it cannot be said in words", () => {
    expect(describeCondition("a + b > c", sources)).toBe("a + b > c");
  });
});
