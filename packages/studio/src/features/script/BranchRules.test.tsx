import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { VariableRegistry } from "@vibegal/engine";
import type { GraphEdge, ProjectGraph } from "../../lib/types";
import { BranchRules, evaluateBranchOutcomes, moveEdge, moveEdgeById, orderDefaultAutoEdgeLast } from "./BranchRules";
import { collectStateSources, stateSourceDefaults } from "./storyState";

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

const graph: ProjectGraph = {
  version: 1,
  entryNodeId: "start",
  chapters: [{ id: "c1", title: "第一章" }],
  nodes: [
    { id: "start", title: "天台·夜", file: "nodes/start.json", chapterId: "c1", position: { x: 0, y: 0 } },
    { id: "confess", title: "雪·告白", file: "nodes/confess.json", chapterId: "c1", position: { x: 200, y: 0 } },
    { id: "normal", title: "普通结局", file: "nodes/normal.json", chapterId: "c1", position: { x: 200, y: 80 } },
  ],
  edges: [],
};

const sources = collectStateSources({ registry, graph });
const defaults = stateSourceDefaults(sources);

const autoEdges: GraphEdge[] = [
  { id: "start__confess", from: "start", to: "confess", mode: "auto", label: null, condition: "affection >= 30" },
  { id: "start__normal", from: "start", to: "normal", mode: "auto", label: null, condition: null },
];

const render = (edges: GraphEdge[], trialValues = defaults) => renderToStaticMarkup(createElement(BranchRules, {
  graph, nodeId: "start", edges, sources, onChange: () => {}, trialValues, onTrialChange: () => {},
}));

describe("BranchRules", () => {
  it("renders the fallback branch as 否则 rather than 默认边", () => {
    const html = render(autoEdges);
    expect(html).toContain("否则");
    expect(html).toContain("从上往下，第一条满足的生效");
    expect(html).not.toContain("默认边");
    expect(html).not.toContain("兜底");
  });

  it("names the target node instead of showing edge ids in the row title", () => {
    const html = render(autoEdges);
    expect(html).toContain("走到「雪·告白」");
    expect(html).toContain("走到「普通结局」");
  });

  it("says which branch wins under the current trial values", () => {
    const html = render(autoEdges, { ...defaults, affection: 60 });
    expect(html).toContain("按当前试算值，会走这一条");
    expect(html).toContain("gs-branch__row--winner");
  });

  it("warns when no fallback exists, because the player would get stuck", () => {
    const html = render(autoEdges.map((edge) => edge.condition ? edge : { ...edge, condition: "has_key" }));
    expect(html).toContain("没有兜底分支");
    expect(html).toContain("玩家会卡住");
  });

  it("describes a single exit and a terminal node in plain words", () => {
    expect(render([autoEdges[0]])).toContain("播放完直接走到「雪·告白」");
    expect(render([])).toContain("这个节点是终点");
  });

  it("keeps the fallback row from being dragged out of last place", () => {
    const html = render(autoEdges);
    // 兜底行不可拖拽，也没有上下移动按钮。
    expect(html).not.toContain('aria-label="上移 start__normal"');
    expect(html).toContain('aria-label="下移 start__confess"');
  });
});

describe("evaluateBranchOutcomes", () => {
  it("marks the first satisfied branch as the winner and stops there", () => {
    const outcomes = evaluateBranchOutcomes(autoEdges, { ...defaults, affection: 60 });
    expect(outcomes[0].winner).toBe(true);
    expect(outcomes[1].winner).toBe(false);
  });

  it("falls through to the fallback when nothing matches", () => {
    const outcomes = evaluateBranchOutcomes(autoEdges, { ...defaults, affection: 0 });
    expect(outcomes[0].winner).toBe(false);
    expect(outcomes[1].winner).toBe(true);
  });

  it("explains an unreachable branch and how to fix it", () => {
    const shadowed: GraphEdge[] = [
      { ...autoEdges[1], condition: null },
      { ...autoEdges[0], condition: "affection >= 30" },
    ];
    const outcomes = evaluateBranchOutcomes(shadowed, defaults);
    expect(outcomes[1].problem).toContain("这条永远走不到");
    expect(outcomes[1].problem).toContain("第 1 条不带条件");
    // 挡住别人的那一条自己没问题。
    expect(outcomes[0].problem).toBeNull();
  });

  it("does not call a branch unreachable just because this trial did not reach it", () => {
    const outcomes = evaluateBranchOutcomes(
      [
        { ...autoEdges[0], condition: "has_key" },
        { ...autoEdges[1], condition: "affection >= 30" },
      ],
      { ...defaults, has_key: true, affection: 60 },
    );
    expect(outcomes[0].winner).toBe(true);
    expect(outcomes[1].problem).toBeNull();
  });

  it("reports an uncomputable condition instead of silently failing", () => {
    const outcomes = evaluateBranchOutcomes(
      [{ ...autoEdges[0], condition: "affection >= \"x\"" }],
      defaults,
    );
    expect(outcomes[0].problem).toContain("无法计算");
  });

  it("does not report 未知变量 for story experience or system state", () => {
    const outcomes = evaluateBranchOutcomes(
      [{ ...autoEdges[0], condition: "system.playthroughCount >= 1" }],
      defaults,
    );
    expect(outcomes[0].problem).toBeNull();
  });
});

describe("edge ordering", () => {
  it("keeps the fallback last no matter how rows are moved", () => {
    const reordered = orderDefaultAutoEdgeLast(moveEdge(autoEdges, 1, -1));
    expect(reordered.map((edge) => edge.id)).toEqual(["start__confess", "start__normal"]);
  });

  it("drag and keyboard reordering agree", () => {
    expect(moveEdgeById(autoEdges, "start__normal", "start__confess").map((edge) => edge.id))
      .toEqual(moveEdge(autoEdges, 1, -1).map((edge) => edge.id));
  });
});
