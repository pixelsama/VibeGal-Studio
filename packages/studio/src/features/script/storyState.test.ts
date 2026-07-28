import { describe, expect, it } from "vitest";
import type { Manifest, VariableRegistry } from "@vibegal/engine";
import type { ProjectGraph } from "../../lib/types";
import { resolveCatalogMessage } from "../../lib/i18n";
import {
  bandThreshold,
  collectStateSources,
  defaultClause,
  formatConditionSentence,
  operatorsForSource,
  parseConditionSentence,
  stateSourceDefaults,
  variableLabel,
} from "./storyState";

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

const manifest = { characters: { yuki: { name: "雪", color: "#fff", sprites: {} } }, backgrounds: {}, audio: { bgm: {}, sfx: {}, voice: {} } } as unknown as Manifest;

const graph: ProjectGraph = {
  version: 1,
  entryNodeId: "rooftop",
  chapters: [{ id: "c1", title: "第一章" }],
  nodes: [
    { id: "rooftop", title: "天台·夜", file: "nodes/rooftop.json", chapterId: "c1", position: { x: 0, y: 0 } },
    { id: "stay", title: "留下", file: "nodes/stay.json", chapterId: "c1", position: { x: 200, y: 0 } },
  ],
  edges: [
    { id: "rooftop__stay", from: "rooftop", to: "stay", mode: "choice", label: "陪她留下", condition: null },
  ],
};

describe("variableLabel", () => {
  it("prefixes the owning character so two meters never read the same", () => {
    expect(variableLabel("affection_yuki", registry.variables.affection_yuki, manifest)).toBe("雪 · 好感度");
  });

  it("falls back to the internal name when nothing was authored", () => {
    expect(variableLabel("variable_1", { type: "string", default: "", nullable: false, scope: "run" })).toBe("variable_1");
  });
});

describe("collectStateSources", () => {
  const sources = collectStateSources({ registry, graph, manifest });
  const byName = new Map(sources.map((source) => [source.name, source]));

  it("groups declared variables by what they are used for", () => {
    expect(byName.get("affection_yuki")?.group).toBe("数值");
    expect(byName.get("has_key")?.group).toBe("是否发生");
    expect(byName.get("route")?.group).toBe("状态");
  });

  it("offers每个选择支 as a story experience nobody had to declare", () => {
    const chose = byName.get("chose.rooftop__stay");
    expect(chose?.label).toBe("在「天台·夜」选了「陪她留下」");
    expect(chose?.group).toBe("剧情经历");
    expect(chose?.readonly).toBe(true);
  });

  it("offers每个节点 as a visited flag", () => {
    expect(byName.get("seen.stay")?.label).toBe("到过「留下」");
  });

  it("includes system state so conditions can gate on playthrough count", () => {
    expect(byName.get("system.playthroughCount")?.label).toBe("通关次数");
  });

  it("localizes synthetic sources without changing creator-authored titles", () => {
    const english = collectStateSources({
      registry,
      graph,
      manifest,
      t: (key, params) => resolveCatalogMessage("en", key, params),
    });
    const englishByName = new Map(english.map((source) => [source.name, source]));

    expect(englishByName.get("chose.rooftop__stay")?.label)
      .toBe("Chose “陪她留下” at “天台·夜”");
    expect(englishByName.get("chose.rooftop__stay")?.group).toBe("Story experience");
    expect(englishByName.get("system.playthroughCount")?.label).toBe("Completed playthroughs");
    expect(englishByName.get("affection_yuki")?.label).toBe("雪 · 好感度");
  });
});

describe("stateSourceDefaults", () => {
  it("covers read-only namespaces so a preview never reports 未知变量", () => {
    const defaults = stateSourceDefaults(collectStateSources({ registry, graph, manifest }));
    expect(defaults["chose.rooftop__stay"]).toBe(false);
    expect(defaults["seen.stay"]).toBe(false);
    expect(defaults["system.playthroughCount"]).toBe(0);
    expect(defaults.affection_yuki).toBe(0);
  });
});

describe("parseConditionSentence", () => {
  it("reads a bare flag, which the old visual builder could not", () => {
    expect(parseConditionSentence("has_key")).toEqual({ join: "all", clauses: [{ source: "has_key", operator: "happened" }] });
  });

  it("reads a negated flag", () => {
    expect(parseConditionSentence("!has_key")).toEqual({ join: "all", clauses: [{ source: "has_key", operator: "notHappened" }] });
  });

  it("normalises == true / != true into the same 已发生 vocabulary", () => {
    expect(parseConditionSentence("has_key == true")?.clauses[0].operator).toBe("happened");
    expect(parseConditionSentence("has_key != true")?.clauses[0].operator).toBe("notHappened");
    expect(parseConditionSentence("has_key == false")?.clauses[0].operator).toBe("notHappened");
  });

  it("flattens a chain of the same connective", () => {
    const sentence = parseConditionSentence("affection_yuki >= 60 && has_key && route == \"yuki\"");
    expect(sentence?.join).toBe("all");
    expect(sentence?.clauses).toEqual([
      { source: "affection_yuki", operator: "atLeast", value: 60 },
      { source: "has_key", operator: "happened" },
      { source: "route", operator: "is", value: "yuki" },
    ]);
  });

  it("reads an any-of chain", () => {
    expect(parseConditionSentence("has_key || route == \"yuki\"")?.join).toBe("any");
  });

  it("declines mixed connectives so the author keeps the expression editor", () => {
    expect(parseConditionSentence("a && (b || c)")).toBeNull();
  });

  it("declines arithmetic and variable-to-variable comparisons", () => {
    expect(parseConditionSentence("affection_yuki > trust")).toBeNull();
    expect(parseConditionSentence("affection_yuki + 1 >= 3")).toBeNull();
  });

  it("treats an empty condition as no sentence at all", () => {
    expect(parseConditionSentence("   ")).toBeNull();
  });
});

describe("formatConditionSentence", () => {
  it("round trips every clause shape", () => {
    const source = "affection_yuki >= 60 && !has_key && route != \"common\"";
    const sentence = parseConditionSentence(source)!;
    expect(formatConditionSentence(sentence)).toBe(source);
  });

  it("emits an empty string for an empty sentence, which means 默认边", () => {
    expect(formatConditionSentence({ join: "all", clauses: [] })).toBe("");
  });
});

describe("operatorsForSource", () => {
  const sources = collectStateSources({ registry, graph, manifest });
  const find = (name: string) => sources.find((source) => source.name === name);

  it("offers only 已发生/还没发生 for flags and story experience", () => {
    expect(operatorsForSource(find("has_key"))).toEqual(["happened", "notHappened"]);
    expect(operatorsForSource(find("chose.rooftop__stay"))).toEqual(["happened", "notHappened"]);
  });

  it("offers thresholds for meters and playthrough count", () => {
    expect(operatorsForSource(find("affection_yuki"))).toEqual(["atLeast", "atMost"]);
    expect(operatorsForSource(find("system.playthroughCount"))).toEqual(["atLeast", "atMost"]);
  });

  it("offers equality for states", () => {
    expect(operatorsForSource(find("route"))).toEqual(["is", "isNot"]);
  });
});

describe("defaultClause", () => {
  const sources = collectStateSources({ registry, graph, manifest });
  const find = (name: string) => sources.find((source) => source.name === name);

  it("starts a state clause on its first declared option rather than an empty string", () => {
    expect(defaultClause(find("route"))).toEqual({ source: "route", operator: "is", value: "common" });
  });

  it("starts a meter clause at its declared minimum", () => {
    expect(defaultClause(find("affection_yuki"))).toEqual({ source: "affection_yuki", operator: "atLeast", value: 0 });
  });
});

describe("bandThreshold", () => {
  it("turns a band name into the first value that reaches it", () => {
    const declaration = registry.variables.affection_yuki;
    expect(bandThreshold(declaration, "cold")).toBe(0);
    expect(bandThreshold(declaration, "care")).toBe(30);
    expect(bandThreshold(declaration, "love")).toBe(60);
  });
});
