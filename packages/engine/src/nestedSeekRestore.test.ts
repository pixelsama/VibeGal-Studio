/**
 * Spec 35 Phase 4 - 嵌套帧 seek / checkpoint 恢复。
 *
 * Phase 1 妥协 3 + Phase 2 妥协 2 的清理：
 * - seekToInstruction 能重放 if 分支内的 set 指令（条件求值后进入 then/else）。
 * - applyStoryPoint / jumpToStoryPoint 能定位到嵌套在 if.then / choice.body 里的停点。
 * - createSnapshot + restoreSnapshot 在嵌套停点处存读档一致。
 * - setCurrentLocale 在嵌套停点处能重新本地化 say/narrate 文本。
 */
import { describe, expect, it } from "vitest";
import { GraphNovelPlayer } from "./graphPlayer";
import type { Manifest, Meta, ProjectGraphData } from "./types";
import type { VariableRegistry } from "./variables";

const manifest: Manifest = {
  characters: { npc: { name: "NPC", color: "#fff", sprites: { default: "n.png", happy: "n.png" } } },
  backgrounds: {}, audio: { bgm: {}, sfx: {}, voice: {} },
  cg: {}, videos: {}, fonts: {}, uiSkins: {}, animationAtlases: {},
  unlocks: { cg: {}, music: {}, replay: {}, endings: {} },
};
const meta: Meta = { title: "t", typingSpeedCps: 600, autoAdvanceMs: 0, chapterGapMs: 0, stage: { width: 1280, height: 720 } };

const graph: ProjectGraphData = {
  version: 1, entryNodeId: "start", chapters: [],
  nodes: [
    { id: "start", title: "s", file: "n", position: { x: 0, y: 0 }, chapterId: "c1" },
    { id: "next", title: "n", file: "n", position: { x: 1, y: 0 }, chapterId: "c1" },
  ],
  edges: [],
};

const variables: VariableRegistry = {
  version: 1,
  variables: { affection: { scope: "run", type: "number", min: 0, max: 100 } },
};

describe("seekToInstruction into nested if-branches (Phase 4)", () => {
  it("replays set instructions inside the taken if-then branch", () => {
    const player = new GraphNovelPlayer({ manifest, meta, variables });
    player.loadGraph(graph, [{
      id: "start",
      instructions: [
        { t: "set", key: "affection", value: 80 },
        { t: "if", condition: "affection >= 60", then: [
          { t: "set", key: "affection", expr: "affection + 10" },
          { t: "narrate", id: "hi", text: "高好感。" },
        ] },
        { t: "narrate", id: "after", text: "合流。" },
      ],
    }]);
    // 走完整条节点。
    player.advance(); // set
    player.advance(); // if then: set + narrate
    expect(player.state.vars.affection).toBe(90);
    player.advance(); // 合流 narrate
    expect(player.state.narration?.text).toBe("合流。");

    // seek 到合流 narrate 之前 -- 重放应当评估条件并进入 then 分支重跑 set。
    player.seekToInstruction(2);
    // 关键断言：affection 反映 then 分支的 set（80 + 10 = 90），而不是停留在 80（旧 bug）。
    expect(player.state.vars.affection).toBe(90);
    player.dispose();
  });

  it("replays set instructions inside the taken if-else branch", () => {
    const player = new GraphNovelPlayer({ manifest, meta, variables });
    player.loadGraph(graph, [{
      id: "start",
      instructions: [
        { t: "set", key: "affection", value: 10 },
        { t: "if", condition: "affection >= 60",
          then: [{ t: "set", key: "affection", expr: "affection + 10" }],
          else: [{ t: "set", key: "affection", expr: "affection + 5" }],
        },
        { t: "narrate", id: "after", text: "合流。" },
      ],
    }]);
    player.advance(); // set
    player.advance(); // if else: set
    expect(player.state.vars.affection).toBe(15);
    player.advance(); // narrate

    // seek 到 narrate -- else 分支的 set 应当被重放。
    player.seekToInstruction(2);
    expect(player.state.vars.affection).toBe(15);
    player.dispose();
  });

  it("skips the if branch when condition is false during replay (no else)", () => {
    const player = new GraphNovelPlayer({ manifest, meta, variables });
    player.loadGraph(graph, [{
      id: "start",
      instructions: [
        { t: "set", key: "affection", value: 0 },
        { t: "if", condition: "affection >= 60", then: [
          { t: "set", key: "affection", expr: "affection + 100" },
        ] },
        { t: "narrate", id: "after", text: "合流。" },
      ],
    }]);
    player.advance(); // set
    player.advance(); // if 跳过
    player.advance(); // narrate

    // seek 到 narrate -- 重放时条件仍为假，then 分支的 set 不应执行。
    player.seekToInstruction(3);
    expect(player.state.vars.affection).toBe(0);
    expect(player.state.narration?.text).toBe("合流。");
    player.dispose();
  });

  it("replays choice option effects + body when a decision log entry exists", () => {
    const player = new GraphNovelPlayer({ manifest, meta, variables });
    player.loadGraph(graph, [{
      id: "start",
      instructions: [
        { t: "set", key: "affection", value: 0 },
        { t: "narrate", id: "intro", text: "岔路。" },
        { t: "choice", id: "branch", options: [{
          text: "继续",
          effects: [{ t: "set", key: "affection", expr: "affection + 4" }],
          body: [{ t: "set", key: "affection", expr: "affection + 1" }],
        }] },
        { t: "narrate", id: "after", text: "合流。" },
      ],
    }]);
    // 走到 choice 并选择。
    while (!player.state.choice) player.advance();
    player.choose(undefined, 0);
    // effects（0->4）+ body（4->5）已执行。
    expect(player.state.vars.affection).toBe(5);

    // 走完 body 的 set（已执行），advance 到合流 narrate。
    player.advance(); // narrate "合流。"
    expect(player.state.narration?.text).toBe("合流。");

    // seek 回到 choice 之后 -- 重放应当重跑 decision log 里记录的选项 effects + body。
    player.seekToInstruction(3);
    // affection 应反映 choice 选项的 effects + body 重放（0 + 4 + 1 = 5）。
    expect(player.state.vars.affection).toBe(5);
    player.dispose();
  });
});

describe("applyStoryPoint into nested frames (Phase 4)", () => {
  it("jumpToStoryPoint lands on a narrate inside an if-then branch", () => {
    const player = new GraphNovelPlayer({ manifest, meta, variables });
    player.loadGraph(graph, [{
      id: "start",
      instructions: [
        { t: "set", key: "affection", value: 80 },
        { t: "if", condition: "affection >= 60", then: [
          { t: "narrate", id: "nested_hi", text: "高好感。" },
        ] },
        { t: "narrate", id: "after", text: "合流。" },
      ],
    }]);
    player.advance(); // set
    player.advance(); // if then narrate
    player.advance(); // 合流

    // 回滚到嵌套停点。
    player.jumpToStoryPoint({ nodeId: "start", instructionId: "nested_hi" });
    expect(player.getCurrentStoryPoint()).toEqual({ nodeId: "start", instructionId: "nested_hi" });
    expect(player.state.narration?.text).toBe("高好感。");
    player.dispose();
  });

  it("jumpToStoryPoint lands on a deeply nested narrate (if-then inside if-then)", () => {
    const player = new GraphNovelPlayer({ manifest, meta, variables });
    player.loadGraph(graph, [{
      id: "start",
      instructions: [
        { t: "set", key: "affection", value: 90 },
        { t: "if", condition: "affection >= 60", then: [
          { t: "if", condition: "affection >= 80", then: [
            { t: "narrate", id: "deep_nested", text: "极高好感。" },
          ] },
        ] },
        { t: "narrate", id: "after", text: "合流。" },
      ],
    }]);
    player.advance(); // set
    player.advance(); // outer if -> inner if -> narrate
    player.advance(); // 合流

    // 回滚到双重嵌套停点。
    player.jumpToStoryPoint({ nodeId: "start", instructionId: "deep_nested" });
    expect(player.getCurrentStoryPoint()).toEqual({ nodeId: "start", instructionId: "deep_nested" });
    expect(player.state.narration?.text).toBe("极高好感。");
    player.dispose();
  });

  it("jumpToStoryPoint lands on a say inside a choice option body", () => {
    const player = new GraphNovelPlayer({ manifest, meta, variables });
    player.loadGraph(graph, [{
      id: "start",
      instructions: [
        { t: "narrate", id: "intro", text: "岔路。" },
        { t: "choice", id: "branch", options: [{
          text: "继续",
          body: [{ t: "say", id: "react", who: "npc", expr: "default", text: "你选了。" }],
        }] },
        { t: "narrate", id: "after", text: "合流。" },
      ],
    }]);
    while (!player.state.choice) player.advance();
    player.choose(undefined, 0);
    player.advance(); // body say
    player.advance(); // 合流 narrate

    // 回滚到 choice body 内的 say 停点。
    player.jumpToStoryPoint({ nodeId: "start", instructionId: "react" });
    expect(player.getCurrentStoryPoint()).toEqual({ nodeId: "start", instructionId: "react" });
    expect(player.state.dialogue?.text).toBe("你选了。");
    player.dispose();
  });

  it("createSnapshot + restoreSnapshot preserves a nested story point", () => {
    const player = new GraphNovelPlayer({ manifest, meta, variables });
    player.loadGraph(graph, [{
      id: "start",
      instructions: [
        { t: "set", key: "affection", value: 80 },
        { t: "if", condition: "affection >= 60", then: [
          { t: "narrate", id: "nested_hi", text: "高好感。" },
        ] },
        { t: "narrate", id: "after", text: "合流。" },
      ],
    }]);
    player.advance(); // set
    player.advance(); // if then narrate (停在 nested_hi)
    const snapshot = player.createSnapshot();
    expect(snapshot.currentStoryPoint).toEqual({ nodeId: "start", instructionId: "nested_hi" });

    // 在另一个 player 实例上恢复。
    const restored = new GraphNovelPlayer({ manifest, meta, variables });
    restored.loadGraph(graph, [{ id: "start", instructions: [
      { t: "set", key: "affection", value: 80 },
      { t: "if", condition: "affection >= 60", then: [
        { t: "narrate", id: "nested_hi", text: "高好感。" },
      ] },
      { t: "narrate", id: "after", text: "合流。" },
    ] }]);
    expect(restored.restoreSnapshot(snapshot).warnings).toEqual([]);
    expect(restored.getCurrentStoryPoint()).toEqual({ nodeId: "start", instructionId: "nested_hi" });
    expect(restored.state.narration?.text).toBe("高好感。");
    expect(restored.state.vars.affection).toBe(80);
    player.dispose();
    restored.dispose();
  });

  it("startDebugSession lands on a nested story point via instructionId", () => {
    const player = new GraphNovelPlayer({ manifest, meta, variables });
    player.loadGraph(graph, [{
      id: "start",
      instructions: [
        { t: "set", key: "affection", value: 80 },
        { t: "if", condition: "affection >= 60", then: [
          { t: "narrate", id: "nested_hi", text: "高好感。" },
        ] },
        { t: "narrate", id: "after", text: "合流。" },
      ],
    }]);
    const result = player.startDebugSession({
      nodeId: "start",
      instructionId: "nested_hi",
      variableOverrides: { affection: 80 },
    });
    expect(result.warnings).toEqual([]);
    expect(player.getCurrentStoryPoint()).toEqual({ nodeId: "start", instructionId: "nested_hi" });
    expect(player.state.narration?.text).toBe("高好感。");
    player.dispose();
  });
});

describe("setCurrentLocale at nested story point (Phase 4)", () => {
  it("re-localizes a say instruction nested inside an if-then branch", () => {
    const locales = {
      "zh-CN": { "scene.nested_say": "高好感台词。" },
      en: { "scene.nested_say": "High affection line." },
    };
    const player = new GraphNovelPlayer({
      manifest,
      meta: { ...meta, locale: { default: "zh-CN" } },
      variables,
      locales,
    });
    player.loadGraph(graph, [{
      id: "start",
      instructions: [
        { t: "set", key: "affection", value: 80 },
        { t: "if", condition: "affection >= 60", then: [
          { t: "say", id: "nested_say", who: "npc", expr: "default", text: "高好感台词。", textKey: "scene.nested_say" },
        ] },
      ],
    }]);
    player.advance(); // set
    player.advance(); // if then say -- 停在 nested_say

    // 切换 locale 应当重新本地化嵌套帧里的 say。
    player.setCurrentLocale("en");
    expect(player.state.dialogue?.text).toBe("High affection line.");
    player.dispose();
  });
});
