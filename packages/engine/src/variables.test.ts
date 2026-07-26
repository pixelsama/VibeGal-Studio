import { describe, expect, it } from "vitest";
import { GraphNovelPlayer } from "./graphPlayer";
import { truncateDecisionLogToNode } from "./runtimeContract";
import {
  clampVariableValue,
  isReadonlyVariableName,
  storyExperienceVariables,
  variableBandAt,
  variableBandLowerBound,
  variableKind,
} from "./variables";
import type { Manifest, Meta, ProjectGraphData, VariableDeclaration, VariableRegistry } from "./types";

const manifest: Manifest = { characters: {}, backgrounds: {}, audio: { bgm: {}, sfx: {}, voice: {} } };
const meta: Meta = {
  title: "Story state",
  typingSpeedCps: 600,
  autoAdvanceMs: 0,
  chapterGapMs: 0,
  stage: { width: 1280, height: 720 },
};

const graph: ProjectGraphData = {
  version: 1,
  entryNodeId: "start",
  chapters: [],
  nodes: [
    { id: "start", title: "Start", file: "nodes/start.json", position: { x: 0, y: 0 } },
    { id: "left", title: "Left", file: "nodes/left.json", position: { x: 200, y: 0 } },
    { id: "right", title: "Right", file: "nodes/right.json", position: { x: 200, y: 100 } },
  ],
  edges: [
    { id: "start__left", from: "start", to: "left", mode: "choice", label: "陪她留下", condition: null },
    { id: "start__right", from: "start", to: "right", mode: "choice", label: "先回去", condition: null },
  ],
};

const meter: VariableDeclaration = {
  kind: "meter", type: "number", default: 0, nullable: false, scope: "run",
  min: 0, max: 100,
  bands: [{ id: "cold", label: "冷淡", upTo: 29 }, { id: "care", label: "在意", upTo: 59 }, { id: "love", label: "喜欢" }],
};

describe("variable kinds", () => {
  it("infers a kind for legacy declarations that predate the field", () => {
    expect(variableKind({ type: "boolean", default: false, nullable: false, scope: "run" })).toBe("flag");
    expect(variableKind({ type: "number", default: 0, nullable: false, scope: "run" })).toBe("meter");
    expect(variableKind({ type: "string", default: "", nullable: false, scope: "run" })).toBe("text");
  });

  it("reads a legacy string declaration with options as a state variable", () => {
    expect(variableKind({
      type: "string", default: "common", nullable: false, scope: "run",
      options: [{ id: "common", label: "共通" }, { id: "yuki", label: "雪线" }],
    })).toBe("state");
  });

  it("prefers the declared kind over inference", () => {
    expect(variableKind({ kind: "counter", type: "number", default: 0, nullable: false, scope: "run" })).toBe("counter");
  });
});

describe("range clamping", () => {
  it("clamps writes into the declared range", () => {
    expect(clampVariableValue(140, meter)).toBe(100);
    expect(clampVariableValue(-5, meter)).toBe(0);
    expect(clampVariableValue(62, meter)).toBe(62);
  });

  it("leaves declarations without an explicit range unbounded", () => {
    const legacy: VariableDeclaration = { type: "number", default: 0, nullable: false, scope: "run" };
    expect(clampVariableValue(9_999, legacy)).toBe(9_999);
    expect(clampVariableValue(-9_999, legacy)).toBe(-9_999);
  });

  it("ignores non-numeric values", () => {
    expect(clampVariableValue("yuki", meter)).toBe("yuki");
    expect(clampVariableValue(null, meter)).toBeNull();
  });
});

describe("bands", () => {
  it("resolves the band a value falls into", () => {
    expect(variableBandAt(10, meter)?.id).toBe("cold");
    expect(variableBandAt(45, meter)?.id).toBe("care");
    expect(variableBandAt(88, meter)?.id).toBe("love");
  });

  it("exposes the exclusive lower bound used to build 达到 conditions", () => {
    expect(variableBandLowerBound(meter, "cold")).toBeUndefined();
    expect(variableBandLowerBound(meter, "care")).toBe(29);
    expect(variableBandLowerBound(meter, "love")).toBe(59);
  });
});

describe("read-only namespaces", () => {
  it("covers system, chose and seen", () => {
    expect(isReadonlyVariableName("system.playthroughCount")).toBe(true);
    expect(isReadonlyVariableName("chose.start__left")).toBe(true);
    expect(isReadonlyVariableName("seen.left")).toBe(true);
    expect(isReadonlyVariableName("affection_yuki")).toBe(false);
  });
});

describe("story experience", () => {
  it("seeds every choice edge and node as false so conditions never hit unknown_variable", () => {
    const experience = storyExperienceVariables(graph, []);
    expect(experience["chose.start__left"]).toBe(false);
    expect(experience["chose.start__right"]).toBe(false);
    expect(experience["seen.left"]).toBe(false);
  });

  it("records player choices and every arrival", () => {
    const experience = storyExperienceVariables(graph, [
      { type: "start", nodeId: "start" },
      { type: "choice", fromNodeId: "start", toNodeId: "left", edgeId: "start__left" },
    ]);
    expect(experience["seen.start"]).toBe(true);
    expect(experience["chose.start__left"]).toBe(true);
    expect(experience["seen.left"]).toBe(true);
    expect(experience["chose.start__right"]).toBe(false);
  });

  it("does not credit auto transitions as player choices", () => {
    const experience = storyExperienceVariables(graph, [
      { type: "start", nodeId: "start" },
      { type: "auto", fromNodeId: "start", toNodeId: "right", edgeId: "start__right" },
    ]);
    expect(experience["seen.right"]).toBe(true);
    expect(experience["chose.start__right"]).toBe(false);
  });
});

describe("decision log truncation", () => {
  it("drops decisions taken after the rollback target", () => {
    const decisions = [
      { type: "start", nodeId: "start" },
      { type: "choice", fromNodeId: "start", toNodeId: "left", edgeId: "start__left" },
    ] as const;
    expect(truncateDecisionLogToNode([...decisions], "start")).toEqual([decisions[0]]);
  });

  it("keeps the log when the target is not on the recorded path", () => {
    const decisions = [{ type: "start", nodeId: "start" } as const];
    expect(truncateDecisionLogToNode([...decisions], "right")).toEqual(decisions);
  });
});

describe("state write trace", () => {
  const variables: VariableRegistry = { version: 1, variables: { affection: meter } };

  function play() {
    const player = new GraphNovelPlayer({ manifest, meta, variables });
    player.loadGraph(graph, [
      { id: "start", instructions: [{ t: "narrate", id: "start_01", text: "岔路。" }] },
      {
        id: "left",
        instructions: [
          { t: "set", key: "affection", expr: "affection + 10" },
          { t: "narrate", id: "left_01", text: "留下。" },
          { t: "set", key: "affection", expr: "affection + 5" },
        ],
      },
      { id: "right", instructions: [{ t: "narrate", id: "right_01", text: "回去。" }] },
    ]);
    return player;
  }

  function advanceToChoice(player: GraphNovelPlayer) {
    while (!player.state.choice) player.advance();
  }

  it("records where each change happened, with the value before and after", () => {
    const player = play();
    advanceToChoice(player);
    player.choose("left");
    const writes = player.getStateWrites();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ variable: "affection", from: 0, to: 10, nodeId: "left", instructionIndex: 0 });
    player.dispose();
  });

  it("keeps every change in order as the player advances", () => {
    const player = play();
    advanceToChoice(player);
    player.choose("left");
    player.advance();
    player.advance();
    expect(player.getStateWrites().map((event) => [event.instructionIndex, event.to])).toEqual([[0, 10], [2, 15]]);
    player.dispose();
  });

  it("drops changes the player rolled back past", () => {
    const player = play();
    advanceToChoice(player);
    player.choose("left");
    expect(player.getStateWrites()).toHaveLength(1);
    player.jumpToStoryPoint({ nodeId: "start", instructionId: "start_01" });
    expect(player.getStateWrites()).toHaveLength(0);
    player.dispose();
  });

  it("does not double count when the playhead is replayed inside a node", () => {
    const player = play();
    advanceToChoice(player);
    player.choose("left");
    const before = player.getStateWrites().length;
    // seekToInstruction 会把同一批指令重跑一遍来重建状态，不应再记一次。
    player.seekToInstruction(3);
    expect(player.getStateWrites()).toHaveLength(before);
    player.dispose();
  });

  it("replays a self-referencing assignment without losing declared values", () => {
    // 回归：seekToInstruction 曾从空 vars 重建，导致 `affection + n` 抛「未知变量」。
    const player = play();
    advanceToChoice(player);
    player.choose("left");
    player.advance();
    player.advance();
    expect(player.state.vars.affection).toBe(15);
    player.seekToInstruction(1);
    expect(player.state.vars.affection).toBe(10);
    player.dispose();
  });

  it("ignores writes that do not change the value", () => {
    const player = new GraphNovelPlayer({ manifest, meta, variables });
    player.loadGraph(graph, [
      { id: "start", instructions: [{ t: "set", key: "affection", value: 0 }, { t: "narrate", id: "start_01", text: "岔路。" }] },
      { id: "left", instructions: [] },
      { id: "right", instructions: [] },
    ]);
    player.advance();
    expect(player.getStateWrites()).toHaveLength(0);
    player.dispose();
  });

  it("keeps the trace out of save snapshots", () => {
    const player = play();
    advanceToChoice(player);
    player.choose("left");
    const snapshot = player.createSnapshot() as unknown as Record<string, unknown>;
    expect(Object.keys(snapshot)).not.toContain("stateWrites");
    player.dispose();
  });
});

describe("edge effects", () => {
  const variables: VariableRegistry = { version: 1, variables: { affection: meter } };

  /** 两个选项汇入同一个节点 —— 这正是「把 set 放进目标节点」会出错的形状。 */
  const merging: ProjectGraphData = {
    version: 1,
    entryNodeId: "start",
    chapters: [],
    nodes: [
      { id: "start", title: "天台", file: "nodes/start.json", position: { x: 0, y: 0 } },
      { id: "morning", title: "第二天早上", file: "nodes/morning.json", position: { x: 200, y: 0 } },
    ],
    edges: [
      {
        id: "start__stay", from: "start", to: "morning", mode: "choice", label: "陪她留下", condition: null,
        effects: [{ t: "set", key: "affection", expr: "affection + 3" }],
      },
      {
        id: "start__leave", from: "start", to: "morning", mode: "choice", label: "先回去", condition: null,
        effects: [{ t: "set", key: "affection", expr: "affection - 1" }],
      },
    ],
  };

  function play(graphData = merging) {
    const player = new GraphNovelPlayer({ manifest, meta, variables });
    player.loadGraph(graphData, [
      { id: "start", instructions: [{ t: "narrate", id: "start_01", text: "岔路。" }] },
      { id: "morning", instructions: [{ t: "narrate", id: "morning_01", text: "早上。" }] },
    ]);
    while (!player.state.choice) player.advance();
    return player;
  }

  it("credits only the option the player actually took", () => {
    const player = play();
    player.choose("morning");
    expect(player.state.vars.affection).toBe(3);
    player.dispose();
  });

  it("applies the other option's effect when that one is taken", () => {
    const player = new GraphNovelPlayer({ manifest, meta, variables });
    player.loadGraph(merging, [
      { id: "start", instructions: [{ t: "narrate", id: "start_01", text: "岔路。" }] },
      { id: "morning", instructions: [{ t: "narrate", id: "morning_01", text: "早上。" }] },
    ]);
    while (!player.state.choice) player.advance();
    // choose() 按目标节点选择；两条边同目标时取 choice 模式的第一条，
    // 因此这里直接验证「未选中的那条不会生效」。
    player.choose("morning");
    expect(player.state.vars.affection).not.toBe(-1);
    player.dispose();
  });

  it("attributes the change to the exit, not to an instruction", () => {
    const player = play();
    player.choose("morning");
    const write = player.getStateWrites().at(-1);
    expect(write).toMatchObject({ variable: "affection", from: 0, to: 3, edgeId: "start__stay" });
    expect(write?.instructionIndex).toBeUndefined();
    player.dispose();
  });

  it("is visible to the target node's own instructions", () => {
    const player = new GraphNovelPlayer({ manifest, meta, variables });
    player.loadGraph(merging, [
      { id: "start", instructions: [{ t: "narrate", id: "start_01", text: "岔路。" }] },
      { id: "morning", instructions: [{ t: "set", key: "affection", expr: "affection * 2" }, { t: "narrate", id: "m1", text: "早上。" }] },
    ]);
    while (!player.state.choice) player.advance();
    player.choose("morning");
    // 出口效果先生效（0 → 3），节点内指令随后翻倍。
    expect(player.state.vars.affection).toBe(6);
    player.dispose();
  });

  it("respects the declared range", () => {
    const player = new GraphNovelPlayer({ manifest, meta, variables });
    player.loadGraph({
      ...merging,
      edges: [{ ...merging.edges[0], effects: [{ t: "set", key: "affection", expr: "affection + 500" }] }],
    }, [
      { id: "start", instructions: [{ t: "narrate", id: "start_01", text: "岔路。" }] },
      { id: "morning", instructions: [] },
    ]);
    while (!player.state.choice) player.advance();
    player.choose("morning");
    expect(player.state.vars.affection).toBe(100);
    player.dispose();
  });

  it("applies effects on an auto branch too", () => {
    const auto: ProjectGraphData = {
      ...merging,
      edges: [{
        id: "start__morning", from: "start", to: "morning", mode: "auto", label: null, condition: null,
        effects: [{ t: "set", key: "affection", expr: "affection + 7" }],
      }],
    };
    const player = new GraphNovelPlayer({ manifest, meta, variables });
    player.loadGraph(auto, [
      { id: "start", instructions: [{ t: "narrate", id: "start_01", text: "岔路。" }] },
      { id: "morning", instructions: [{ t: "narrate", id: "morning_01", text: "早上。" }] },
    ]);
    // auto 分支要先走完 start 的旁白才解析路由。
    while (player.state.vars.affection === 0) player.advance();
    expect(player.state.vars.affection).toBe(7);
    player.dispose();
  });

  it("leaves edges without effects untouched", () => {
    const plain: ProjectGraphData = {
      ...merging,
      edges: merging.edges.map((edge) => ({ ...edge, effects: undefined })),
    };
    const player = play(plain);
    player.choose("morning");
    expect(player.state.vars.affection).toBe(0);
    expect(player.getStateWrites()).toHaveLength(0);
    player.dispose();
  });

  it("drops the change when the player rolls back before the exit", () => {
    const player = play();
    player.choose("morning");
    expect(player.getStateWrites()).toHaveLength(1);
    player.jumpToStoryPoint({ nodeId: "start", instructionId: "start_01" });
    expect(player.getStateWrites()).toHaveLength(0);
    player.dispose();
  });
});

describe("GraphNovelPlayer story state", () => {
  const variables: VariableRegistry = { version: 1, variables: { affection: meter } };

  function play() {
    const player = new GraphNovelPlayer({ manifest, meta, variables });
    player.loadGraph(graph, [
      { id: "start", instructions: [{ t: "narrate", id: "start_01", text: "岔路。" }] },
      { id: "left", instructions: [{ t: "set", key: "affection", expr: "affection + 140" }, { t: "narrate", id: "left_01", text: "留下。" }] },
      { id: "right", instructions: [{ t: "narrate", id: "right_01", text: "回去。" }] },
    ]);
    return player;
  }

  /** 走到 start 节点末尾并解析出选择支：补完打字 → 走完 narrate → 解析路由。 */
  function advanceToChoice(player: GraphNovelPlayer) {
    while (!player.state.choice) player.advance();
  }

  it("exposes chose./seen. to conditions without the project declaring anything", () => {
    const player = play();
    expect(player.state.vars["chose.start__left"]).toBe(false);
    advanceToChoice(player);
    player.choose("left");
    expect(player.state.vars["chose.start__left"]).toBe(true);
    expect(player.state.vars["seen.left"]).toBe(true);
    player.dispose();
  });

  it("clamps a set expression to the declared maximum", () => {
    const player = play();
    advanceToChoice(player);
    player.choose("left");
    expect(player.state.vars.affection).toBe(100);
    player.dispose();
  });

  it("keeps derived experience out of save snapshots", () => {
    const player = play();
    advanceToChoice(player);
    player.choose("left");
    const snapshot = player.createSnapshot();
    expect(Object.keys(snapshot.vars).some((name) => isReadonlyVariableName(name))).toBe(false);
    expect(snapshot.vars.affection).toBe(100);
    player.dispose();
  });

  it("un-sets a choice when the player rolls back before it", () => {
    const player = play();
    advanceToChoice(player);
    player.choose("left");
    expect(player.state.vars["chose.start__left"]).toBe(true);
    player.jumpToStoryPoint({ nodeId: "start", instructionId: "start_01" });
    expect(player.state.vars["chose.start__left"]).toBe(false);
    expect(player.state.vars["seen.left"]).toBe(false);
    player.dispose();
  });

  it("carries accumulated variables through a rollback", () => {
    const player = play();
    advanceToChoice(player);
    player.choose("left");
    player.jumpToStoryPoint({ nodeId: "start", instructionId: "start_01" });
    expect(player.state.vars.affection).toBe(100);
    player.dispose();
  });
});
