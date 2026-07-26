import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createInitialState, type Manifest, type StateWriteEvent, type VariableRegistry } from "@vibegal/engine";
import type { ProjectGraph } from "../../lib/types";
import { StoryInspection, describeChange, describeNextBranch } from "./StoryInspection";
import { collectStateSources } from "../script/storyState";

const registry: VariableRegistry = {
  version: 1,
  variables: {
    affection: {
      kind: "meter", type: "number", default: 0, nullable: false, scope: "run", label: "好感度",
      min: 0, max: 100,
      bands: [{ id: "cold", label: "冷淡", upTo: 29 }, { id: "love", label: "喜欢" }],
    },
    has_key: { kind: "flag", type: "boolean", default: false, nullable: false, scope: "run", label: "拿到钥匙" },
  },
};

const manifest = { characters: {}, backgrounds: {}, audio: { bgm: {}, sfx: {}, voice: {} } } as unknown as Manifest;

const graph: ProjectGraph = {
  version: 1,
  entryNodeId: "rooftop",
  chapters: [{ id: "c1", title: "第一章" }],
  nodes: [
    { id: "rooftop", title: "天台告白", file: "nodes/rooftop.json", chapterId: "c1", position: { x: 0, y: 0 } },
    { id: "rain", title: "雨夜交谈", file: "nodes/rain.json", chapterId: "c1", position: { x: -200, y: 0 } },
    { id: "yuki", title: "雪线结局", file: "nodes/yuki.json", chapterId: "c1", position: { x: 200, y: 0 } },
    { id: "plain", title: "普通结局", file: "nodes/plain.json", chapterId: "c1", position: { x: 200, y: 90 } },
  ],
  edges: [
    { id: "rooftop__yuki", from: "rooftop", to: "yuki", mode: "auto", label: null, condition: "affection >= 30 && has_key" },
    { id: "rooftop__plain", from: "rooftop", to: "plain", mode: "auto", label: null, condition: null },
  ],
};

const writes: StateWriteEvent[] = [
  { variable: "affection", from: 55, to: 65, nodeId: "rain", instructionIndex: 2, decisionIndex: 1 },
  { variable: "has_key", from: false, to: true, nodeId: "rain", instructionIndex: 4, decisionIndex: 1 },
];

const state = { ...createInitialState(), vars: { affection: 65, has_key: true } };

const render = (props: Partial<Parameters<typeof StoryInspection>[0]> = {}) =>
  renderToStaticMarkup(createElement(StoryInspection, {
    state,
    graph,
    registry,
    manifest,
    stateWrites: writes,
    currentNodeId: "rooftop",
    onClose: () => {},
    onOpenNode: () => {},
    onSelectEdge: () => {},
    ...props,
  }));

describe("StoryInspection", () => {
  it("names where the player is, in the author's own node title", () => {
    expect(render()).toContain("天台告白");
  });

  it("explains where each value came from, not just what it is", () => {
    const html = render();
    expect(html).toContain("好感度");
    expect(html).toContain("65");
    expect(html).toContain("在「雨夜交谈」增加了 10");
    expect(html).toContain("在「雨夜交谈」被标记为已发生");
  });

  it("shows a meter's band alongside the raw number", () => {
    expect(render()).toContain("（喜欢）");
  });

  it("only lists states that actually changed", () => {
    // 图里有 4 个节点，seen.* 全是 false，不该铺进面板。
    const html = render();
    expect(html).not.toContain("到过「普通结局」");
    expect(html).not.toContain("seen.");
  });

  it("explains the upcoming branch clause by clause with the winner", () => {
    const html = render();
    expect(html).toContain("好感度 达到 喜欢");
    expect(html).toContain("拿到钥匙 已发生");
    expect(html).toContain("因此会进入「雪线结局」");
  });

  it("never offers an input for the running values", () => {
    const html = render();
    expect(html).not.toContain("<input");
    expect(html).not.toContain("重置变量");
    expect(html).toContain("这里只解释，不改动");
  });

  it("offers the escape hatch back into a fresh trial", () => {
    expect(render({ onReplayWithCurrentValues: () => {} })).toContain("带着现在这些值重新试演");
  });

  it("says so plainly when nothing has changed yet", () => {
    expect(render({ stateWrites: [] })).toContain("还没有任何故事状态被改变过");
  });
});

describe("describeNextBranch", () => {
  const sources = new Map(collectStateSources({ registry, graph, manifest }).map((s) => [s.name, s]));

  it("marks each clause satisfied or not from the live values", () => {
    const branch = describeNextBranch(graph, "rooftop", { affection: 65, has_key: true }, sources);
    expect(branch.kind).toBe("auto");
    if (branch.kind !== "auto") return;
    expect(branch.clauses.every((clause) => clause.satisfied)).toBe(true);
    expect(branch.winnerNodeId).toBe("yuki");
  });

  it("shows which single clause is holding the branch back", () => {
    const branch = describeNextBranch(graph, "rooftop", { affection: 65, has_key: false }, sources);
    if (branch.kind !== "auto") throw new Error("expected auto");
    // 好感度够了、钥匙没拿到 —— 作者一眼看出差在哪。
    expect(branch.clauses.map((clause) => clause.satisfied)).toEqual([true, false]);
    // 兜底分支接走，所以仍有归宿。
    expect(branch.winnerNodeId).toBe("plain");
  });

  it("recognises a terminal node and a player choice", () => {
    expect(describeNextBranch(graph, "yuki", {}, sources).kind).toBe("end");
    const choiceGraph: ProjectGraph = {
      ...graph,
      edges: [{ ...graph.edges[0], mode: "choice", condition: null, label: "留下" }],
    };
    expect(describeNextBranch(choiceGraph, "rooftop", {}, sources).kind).toBe("choice");
  });

  it("warns when nothing matches and there is no fallback", () => {
    const stuck: ProjectGraph = { ...graph, edges: [graph.edges[0]] };
    const branch = describeNextBranch(stuck, "rooftop", { affection: 0, has_key: false }, sources);
    if (branch.kind !== "auto") throw new Error("expected auto");
    expect(branch.winnerNodeId).toBeNull();
  });
});

describe("describeChange", () => {
  it("prefers a delta over a from/to pair for numbers", () => {
    expect(describeChange({ variable: "a", from: 55, to: 65, nodeId: "n", instructionIndex: 0, decisionIndex: 0 }))
      .toBe("增加了 10");
    expect(describeChange({ variable: "a", from: 10, to: 4, nodeId: "n", instructionIndex: 0, decisionIndex: 0 }))
      .toBe("减少了 6");
  });

  it("uses 已发生 wording for flags", () => {
    expect(describeChange({ variable: "a", from: false, to: true, nodeId: "n", instructionIndex: 0, decisionIndex: 0 }))
      .toBe("被标记为已发生");
  });

  it("falls back to 被设为 for text", () => {
    expect(describeChange({ variable: "a", from: "", to: "雪", nodeId: "n", instructionIndex: 0, decisionIndex: 0 }))
      .toBe("被设为 雪");
  });
});
