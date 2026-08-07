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

const manifest: Manifest = {
  characters: {}, backgrounds: {}, audio: { bgm: {}, sfx: {}, voice: {} },
  cg: {}, videos: {}, fonts: {}, uiSkins: {}, animationAtlases: {},
  unlocks: { cg: {}, music: {}, replay: {}, endings: {} },
};
const meta: Meta = {
  title: "Story state",
  typingSpeedCps: 600,
  autoAdvanceMs: 0,
  chapterGapMs: 0,
  stage: { width: 1280, height: 720 },
};

// Spec 35：choice 是节点内指令，不再由图边表达。下面这个图没有 choice 边 ——
// 玩家选择由 start 节点里的 choice 指令驱动。
const graph: ProjectGraphData = {
  version: 1,
  entryNodeId: "start",
  chapters: [],
  nodes: [
    { id: "start", title: "Start", file: "nodes/start.json", position: { x: 0, y: 0 }, chapterId: "chapter_1" },
    { id: "left", title: "Left", file: "nodes/left.json", position: { x: 200, y: 0 }, chapterId: "chapter_1" },
    { id: "right", title: "Right", file: "nodes/right.json", position: { x: 200, y: 100 }, chapterId: "chapter_1" },
  ],
  edges: [],
};

const meter: VariableDeclaration = {
  kind: "meter", type: "number", default: 0, nullable: false, scope: "run",
  min: 0, max: 100,
  bands: [{ id: "cold", label: "冷淡", upTo: 29 }, { id: "care", label: "在意", upTo: 59 }, { id: "love", label: "喜欢" }],
};

// start 节点内的 choice 指令：两个选项分别跳 left / right。带 id = 参与追踪。
const startChoice = {
  t: "choice" as const,
  id: "start_choice" as const,
  options: [
    { text: "陪她留下", to: "left" },
    { text: "先回去", to: "right" },
  ],
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
    expect(isReadonlyVariableName("chose.start_choice.0")).toBe(true);
    expect(isReadonlyVariableName("seen.left")).toBe(true);
    expect(isReadonlyVariableName("affection_yuki")).toBe(false);
  });
});

describe("story experience", () => {
  // Spec 35：chose.* 从节点内 choice 指令派生。需要传 nodeEntries。
  const nodeEntries = [
    { id: "start", instructions: [startChoice] },
    { id: "left", instructions: [] },
    { id: "right", instructions: [] },
  ];

  it("seeds every choice option and node as false so conditions never hit unknown_variable", () => {
    const experience = storyExperienceVariables(graph, nodeEntries, []);
    expect(experience["chose.start_choice.0"]).toBe(false);
    expect(experience["chose.start_choice.1"]).toBe(false);
    expect(experience["seen.left"]).toBe(false);
  });

  it("records player choices and every arrival", () => {
    const experience = storyExperienceVariables(graph, nodeEntries, [
      { type: "start", nodeId: "start" },
      { type: "choice", fromNodeId: "start", toNodeId: "left", choiceInstructionId: "start_choice", optionIndex: 0 },
    ]);
    expect(experience["seen.start"]).toBe(true);
    expect(experience["chose.start_choice.0"]).toBe(true);
    expect(experience["seen.left"]).toBe(true);
    expect(experience["chose.start_choice.1"]).toBe(false);
  });

  it("does not credit auto transitions as player choices", () => {
    const experience = storyExperienceVariables(graph, nodeEntries, [
      { type: "start", nodeId: "start" },
      { type: "auto", fromNodeId: "start", toNodeId: "right" },
    ]);
    expect(experience["seen.right"]).toBe(true);
    expect(experience["chose.start_choice.1"]).toBe(false);
  });

  it("ignores choice instructions without an id", () => {
    const anonEntries = [
      { id: "start", instructions: [{ t: "choice" as const, options: [{ text: "x", to: "left" }] }] },
    ];
    const experience = storyExperienceVariables(graph, anonEntries, []);
    expect(Object.keys(experience).some((k) => k.startsWith("chose."))).toBe(false);
  });
});

describe("decision log truncation", () => {
  it("drops decisions taken after the rollback target", () => {
    const decisions = [
      { type: "start", nodeId: "start" },
      { type: "choice", fromNodeId: "start", toNodeId: "left", choiceInstructionId: "start_choice", optionIndex: 0 },
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
      { id: "start", instructions: [{ t: "narrate", id: "start_01", text: "岔路。" }, startChoice] },
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
    player.choose(undefined, 0);
    const writes = player.getStateWrites();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ variable: "affection", from: 0, to: 10, nodeId: "left", instructionIndex: 0 });
    player.dispose();
  });

  it("keeps every change in order as the player advances", () => {
    const player = play();
    advanceToChoice(player);
    player.choose(undefined, 0);
    player.advance();
    player.advance();
    expect(player.getStateWrites().map((event) => [event.instructionIndex, event.to])).toEqual([[0, 10], [2, 15]]);
    player.dispose();
  });

  it("drops changes the player rolled back past", () => {
    const player = play();
    advanceToChoice(player);
    player.choose(undefined, 0);
    expect(player.getStateWrites()).toHaveLength(1);
    player.jumpToStoryPoint({ nodeId: "start", instructionId: "start_01" });
    expect(player.getStateWrites()).toHaveLength(0);
    player.dispose();
  });

  it("replays a self-referencing assignment without losing declared values", () => {
    const player = play();
    advanceToChoice(player);
    player.choose(undefined, 0);
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
    player.choose(undefined, 0);
    const snapshot = player.createSnapshot() as unknown as Record<string, unknown>;
    expect(Object.keys(snapshot)).not.toContain("stateWrites");
    player.dispose();
  });
});

describe("choice option effects (Spec 35)", () => {
  const variables: VariableRegistry = { version: 1, variables: { affection: meter } };

  /** 两个选项汇入同一个节点 —— 这正是「把 set 放进目标节点」会出错的形状。 */
  const merging: ProjectGraphData = {
    version: 1,
    entryNodeId: "start",
    chapters: [],
    nodes: [
      { id: "start", title: "天台", file: "nodes/start.json", position: { x: 0, y: 0 }, chapterId: "chapter_1" },
      { id: "morning", title: "第二天早上", file: "nodes/morning.json", position: { x: 200, y: 0 }, chapterId: "chapter_1" },
    ],
    edges: [],
  };

  const mergingChoice = {
    t: "choice" as const,
    id: "stay_choice" as const,
    options: [
      { text: "陪她留下", to: "morning", effects: [{ t: "set", key: "affection", expr: "affection + 3" }] },
      { text: "先回去", to: "morning", effects: [{ t: "set", key: "affection", expr: "affection - 1" }] },
    ],
  };

  function play(graphData = merging, choiceInstr = mergingChoice) {
    const player = new GraphNovelPlayer({ manifest, meta, variables });
    player.loadGraph(graphData, [
      { id: "start", instructions: [{ t: "narrate", id: "start_01", text: "岔路。" }, choiceInstr] },
      { id: "morning", instructions: [{ t: "narrate", id: "morning_01", text: "早上。" }] },
    ]);
    while (!player.state.choice) player.advance();
    return player;
  }

  it("credits only the option the player actually took", () => {
    const player = play();
    player.choose(undefined, 0);
    expect(player.state.vars.affection).toBe(3);
    player.dispose();
  });

  it("applies the other option's effect when that one is taken", () => {
    const player = play();
    player.choose(undefined, 1);
    // 选项 1 是 affection - 1，但 affection 声明为 [0,100] 的 meter，0 - 1 钳到 0。
    expect(player.state.vars.affection).toBe(0);
    player.dispose();
  });

  it("attributes the change to the choice option, not to an instruction", () => {
    const player = play();
    player.choose(undefined, 0);
    const write = player.getStateWrites().at(-1);
    expect(write).toMatchObject({ variable: "affection", from: 0, to: 3, choiceInstructionId: "stay_choice", optionIndex: 0 });
    expect(write?.instructionIndex).toBeUndefined();
    player.dispose();
  });

  it("is visible to the target node's own instructions", () => {
    const player = new GraphNovelPlayer({ manifest, meta, variables });
    player.loadGraph(merging, [
      { id: "start", instructions: [{ t: "narrate", id: "start_01", text: "岔路。" }, mergingChoice] },
      { id: "morning", instructions: [{ t: "set", key: "affection", expr: "affection * 2" }, { t: "narrate", id: "m1", text: "早上。" }] },
    ]);
    while (!player.state.choice) player.advance();
    player.choose(undefined, 0);
    // 选项效果先生效（0 → 3），节点内指令随后翻倍。
    expect(player.state.vars.affection).toBe(6);
    player.dispose();
  });

  it("respects the declared range", () => {
    const bigChoice = {
      ...mergingChoice,
      options: [{ text: "陪她留下", to: "morning", effects: [{ t: "set", key: "affection", expr: "affection + 500" }] }],
    };
    const player = play(merging, bigChoice);
    player.choose(undefined, 0);
    expect(player.state.vars.affection).toBe(100);
    player.dispose();
  });

  it("runs the option body before continuing when there is no to", () => {
    const bodyChoice = {
      t: "choice" as const,
      id: "body_choice" as const,
      options: [{
        text: "回应",
        effects: [{ t: "set", key: "affection", expr: "affection + 4" }],
        body: [{ t: "set", key: "affection", expr: "affection + 1" }],
      }],
    };
    const player = new GraphNovelPlayer({ manifest, meta, variables });
    player.loadGraph({
      ...merging,
      nodes: [merging.nodes[0]], // 只有 start，无出口 = 节点结束
    }, [
      { id: "start", instructions: [{ t: "narrate", id: "start_01", text: "岔路。" }, bodyChoice] },
    ]);
    while (!player.state.choice) player.advance();
    player.choose(undefined, 0);
    // effects 先（0→4），body 后（4→5），无 to → 合流到 choice 之后续跑（无后续指令）。
    expect(player.state.vars.affection).toBe(5);
    player.dispose();
  });

  it("leaves options without effects untouched", () => {
    const plainChoice = {
      t: "choice" as const,
      id: "plain_choice" as const,
      options: [{ text: "陪她留下", to: "morning" }, { text: "先回去", to: "morning" }],
    };
    const player = play(merging, plainChoice);
    player.choose(undefined, 0);
    expect(player.state.vars.affection).toBe(0);
    expect(player.getStateWrites()).toHaveLength(0);
    player.dispose();
  });

  it("drops the change when the player rolls back before the choice", () => {
    const player = play();
    player.choose(undefined, 0);
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
      { id: "start", instructions: [{ t: "narrate", id: "start_01", text: "岔路。" }, startChoice] },
      { id: "left", instructions: [{ t: "set", key: "affection", expr: "affection + 140" }, { t: "narrate", id: "left_01", text: "留下。" }] },
      { id: "right", instructions: [{ t: "narrate", id: "right_01", text: "回去。" }] },
    ]);
    return player;
  }

  /** 走到 start 节点末尾并解析出选择支：补完打字 → 走完 narrate → 呈现 choice 指令。 */
  function advanceToChoice(player: GraphNovelPlayer) {
    while (!player.state.choice) player.advance();
  }

  it("exposes chose./seen. to conditions without the project declaring anything", () => {
    const player = play();
    expect(player.state.vars["chose.start_choice.0"]).toBe(false);
    advanceToChoice(player);
    player.choose(undefined, 0);
    expect(player.state.vars["chose.start_choice.0"]).toBe(true);
    expect(player.state.vars["seen.left"]).toBe(true);
    player.dispose();
  });

  it("clamps a set expression to the declared maximum", () => {
    const player = play();
    advanceToChoice(player);
    player.choose(undefined, 0);
    expect(player.state.vars.affection).toBe(100);
    player.dispose();
  });

  it("keeps derived experience out of save snapshots", () => {
    const player = play();
    advanceToChoice(player);
    player.choose(undefined, 0);
    const snapshot = player.createSnapshot();
    expect(Object.keys(snapshot.vars).some((name) => isReadonlyVariableName(name))).toBe(false);
    expect(snapshot.vars.affection).toBe(100);
    player.dispose();
  });

  it("un-sets a choice when the player rolls back before it", () => {
    const player = play();
    advanceToChoice(player);
    player.choose(undefined, 0);
    expect(player.state.vars["chose.start_choice.0"]).toBe(true);
    player.jumpToStoryPoint({ nodeId: "start", instructionId: "start_01" });
    expect(player.state.vars["chose.start_choice.0"]).toBe(false);
    expect(player.state.vars["seen.left"]).toBe(false);
    player.dispose();
  });

  it("carries accumulated variables through a rollback", () => {
    const player = play();
    advanceToChoice(player);
    player.choose(undefined, 0);
    player.jumpToStoryPoint({ nodeId: "start", instructionId: "start_01" });
    expect(player.state.vars.affection).toBe(100);
    player.dispose();
  });
});
