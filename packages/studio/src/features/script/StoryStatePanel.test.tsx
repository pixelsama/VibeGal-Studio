import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Manifest, VariableRegistry } from "@vibegal/engine";
import type { ProjectGraph } from "../../lib/types";
import { StoryStatePanel, declarationForKind, registerInferredVariable, slugify, uniqueName } from "./StoryStatePanel";
import { StudioI18nProvider } from "../../lib/i18n";

const graph: ProjectGraph = {
  version: 1,
  entryNodeId: "start",
  chapters: [{ id: "chapter_1", title: "第一章" }],
  nodes: [{ id: "start", title: "开场", file: "nodes/start.json", chapterId: "chapter_1", position: { x: 0, y: 0 } }],
  edges: [],
};

const manifest = {
  characters: { yuki: { name: "雪", color: "#fff", sprites: {} } },
  backgrounds: {},
  audio: { bgm: {}, sfx: {}, voice: {} },
} as unknown as Manifest;

const registry: VariableRegistry = {
  version: 1,
  variables: {
    affection_yuki: {
      kind: "meter", type: "number", default: 20, nullable: false, scope: "run",
      label: "好感度", of: "yuki", min: 0, max: 100,
      bands: [{ id: "cold", label: "冷淡", upTo: 29 }, { id: "love", label: "喜欢" }],
    },
    has_key: { kind: "flag", type: "boolean", default: false, nullable: false, scope: "run", label: "拿到钥匙" },
  },
};

const render = (props: Partial<Parameters<typeof StoryStatePanel>[0]> = {}) =>
  renderToStaticMarkup(createElement(StoryStatePanel, {
    registry, graph, manifest, onChange: () => {}, ...props,
  }));

describe("StoryStatePanel", () => {
  it("leads with what the state is for, in creator vocabulary", () => {
    const html = render();
    expect(html).toContain("雪 · 好感度");
    expect(html).toContain("数值 · 本轮游戏");
    expect(html).toContain("拿到钥匙");
    expect(html).toContain("是否发生");
  });

  it("shows a flag's initial value as a switch rather than asking for true", () => {
    const html = render();
    expect(html).toContain("开局时");
    expect(html).toContain("还没发生");
    expect(html).toContain('role="switch"');
  });

  it("shows a bounded meter as a slider labelled by its band", () => {
    const html = render();
    expect(html).toContain('type="range"');
    // 初始值 20 落在「冷淡」段。
    expect(html).toContain('aria-valuetext="冷淡"');
  });

  it("keeps identifiers, data types and storage semantics inside technical details", () => {
    const html = render();
    expect(html).toContain("<summary>技术详情</summary>");
    expect(html).toContain("内部标识");
    expect(html).toContain("affection_yuki");
    expect(html).not.toContain("<details open");
    // 用途词在正文，实现术语不在正文。
    const beforeDetails = html.slice(0, html.indexOf("技术详情"));
    expect(beforeDetails).not.toContain("nullable");
    expect(beforeDetails).not.toContain("boolean");
  });

  it("describes usage in sentences instead of write/read counters", () => {
    const html = render();
    expect(html).toContain("剧本里还没有用到它");
    expect(html).not.toContain("write_without_read");
    expect(html).not.toContain("read_before_write");
  });

  it("explains that choices alone may be enough when nothing is declared", () => {
    const html = render({ registry: { version: 1, variables: {} } });
    expect(html).toContain("玩家的选择本身已经可以直接用在分流条件里");
  });

  it("renders creator-facing controls in English without translating project content", () => {
    const html = renderToStaticMarkup(
      createElement(
        StudioI18nProvider,
        { preference: "en" },
        createElement(StoryStatePanel, {
          registry,
          graph,
          manifest,
          onChange: () => {},
        }),
      ),
    );

    expect(html).toContain('aria-label="Search story state"');
    expect(html).toContain("Display name");
    expect(html).toContain("Initial value");
    expect(html).toContain("Technical details");
    expect(html).toContain("雪 · 好感度");
    expect(html).not.toContain("技术详情");
  });

  it("hides editing affordances in read-only mode", () => {
    const html = render({ onChange: undefined });
    expect(html).not.toContain("新建");
    expect(html).toContain("雪 · 好感度");
  });
});

describe("new state defaults", () => {
  it("gives a meter a usable range and bands out of the box", () => {
    const declaration = declarationForKind("meter", "好感度");
    expect(declaration).toMatchObject({ kind: "meter", type: "number", default: 0, min: 0, max: 100 });
    expect(declaration.bands).toHaveLength(3);
  });

  it("gives a state one starting option so the default is always valid", () => {
    const declaration = declarationForKind("state", "当前路线");
    expect(declaration.options).toEqual([{ id: "state_1", label: "状态 1" }]);
    expect(declaration.default).toBe("state_1");
  });

  it("keeps persisted defaults independent from the Studio locale", () => {
    expect(declarationForKind("meter", "Affection")).toMatchObject({
      bands: [
        { id: "low", label: "低", upTo: 29 },
        { id: "mid", label: "中", upTo: 59 },
        { id: "high", label: "高" },
      ],
    });
    expect(declarationForKind("state", "Route")).toMatchObject({
      options: [{ id: "state_1", label: "状态 1" }],
    });
  });

  it("keeps a counter non-negative", () => {
    expect(declarationForKind("counter", "见面次数")).toMatchObject({ min: 0, default: 0 });
  });
});

describe("identifier generation", () => {
  it("derives an identifier from a latin label", () => {
    expect(slugify("Has Key")).toBe("has_key");
  });

  it("falls back when the label has no usable ascii, rather than emitting variable_1", () => {
    expect(slugify("拿到钥匙")).toBe("");
    expect(uniqueName(slugify("拿到钥匙"), new Set())).toBe("state");
  });

  it("never collides with an existing identifier", () => {
    expect(uniqueName("state", new Set(["state", "state_2"]))).toBe("state_3");
  });
});

describe("registerInferredVariable", () => {
  it("adds a kind so legacy variables land in the right group", () => {
    expect(registerInferredVariable({ version: 1, variables: {} }, "affection", ["number"])).toEqual({
      version: 1,
      variables: { affection: { kind: "meter", type: "number", default: 0, nullable: false, scope: "run" } },
    });
  });

  it("leaves an already-declared variable untouched", () => {
    expect(registerInferredVariable(registry, "has_key", ["boolean"])).toBe(registry);
  });
});
