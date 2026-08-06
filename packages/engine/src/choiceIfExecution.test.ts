/**
 * Spec 35 — choice / if 指令的执行语义（节点内嵌套指令序列）。
 *
 * 这些用例直接锁定新模型的关键行为：
 * - choice 选项可跳节点（to）或合流（无 to）；
 * - if 按条件走 then/else 后合流回主线；
 * - choice/if 可互相嵌套；
 * - chose.<choiceId>.<optionIndex> 追踪。
 */
import { describe, expect, it } from "vitest";
import { GraphNovelPlayer } from "./graphPlayer";
import type { Manifest, Meta, ProjectGraphData } from "./types";

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
    { id: "approach", title: "a", file: "n", position: { x: 1, y: 0 }, chapterId: "c1" },
    { id: "shore", title: "sh", file: "n", position: { x: 1, y: 1 }, chapterId: "c1" },
  ],
  edges: [],
};

function advanceToChoice(player: GraphNovelPlayer) {
  while (!player.state.choice) player.advance();
}

describe("choice instruction execution (Spec 35)", () => {
  it("jumps to the option's target node when to is set", () => {
    const player = new GraphNovelPlayer({ manifest, meta });
    player.loadGraph(graph, [
      { id: "start", instructions: [
        { t: "narrate", id: "n1", text: "岔路。" },
        { t: "choice", id: "branch", options: [{ text: "去", to: "approach" }, { text: "留", to: "shore" }] },
      ] },
      { id: "approach", instructions: [{ t: "narrate", id: "a1", text: "到了。" }] },
      { id: "shore", instructions: [{ t: "narrate", id: "s1", text: "留下。" }] },
    ]);
    advanceToChoice(player);
    player.choose(undefined, 0);
    expect(player.getCurrentNodeId()).toBe("approach");
    expect(player.state.narration?.text).toBe("到了。");
    player.dispose();
  });

  it("merges back to the main instruction stream when an option has no to and no body", () => {
    const player = new GraphNovelPlayer({ manifest, meta });
    player.loadGraph(graph, [
      { id: "start", instructions: [
        { t: "choice", id: "branch", options: [{ text: "继续" }] },
        { t: "narrate", id: "after", text: "合流后的旁白。" },
      ] },
      { id: "approach", instructions: [] },
      { id: "shore", instructions: [] },
    ]);
    advanceToChoice(player);
    player.choose(undefined, 0);
    expect(player.getCurrentNodeId()).toBe("start");
    expect(player.state.narration?.text).toBe("合流后的旁白。");
    player.dispose();
  });

  it("runs the option body then merges back when an option has body but no to", () => {
    const player = new GraphNovelPlayer({ manifest, meta });
    player.loadGraph(graph, [
      { id: "start", instructions: [
        { t: "set", key: "resolve", value: 0 },
        { t: "choice", id: "branch", options: [{
          text: "继续", effects: [{ t: "set", key: "resolve", expr: "resolve + 4" }],
          body: [{ t: "say", id: "react", who: "npc", expr: "default", text: "你选了。" }],
        }] },
        { t: "narrate", id: "after", text: "合流。" },
      ] },
      { id: "approach", instructions: [] },
      { id: "shore", instructions: [] },
    ]);
    advanceToChoice(player);
    player.choose(undefined, 0);
    // effects 先执行（0 → 4），body 随后演出，最后合流到 choice 之后。
    expect(player.state.vars.resolve).toBe(4);
    expect(player.state.dialogue?.text).toBe("你选了。");
    player.advance(); // 走完 body 的 say
    player.advance(); // 合流到 narrate
    expect(player.state.narration?.text).toBe("合流。");
    player.dispose();
  });

  it("tracks chose.<choiceId>.<optionIndex> for choices with an id", () => {
    const player = new GraphNovelPlayer({ manifest, meta });
    player.loadGraph(graph, [
      { id: "start", instructions: [
        { t: "narrate", id: "n1", text: "岔路。" },
        { t: "choice", id: "branch", options: [{ text: "去", to: "approach" }, { text: "留", to: "shore" }] },
      ] },
      { id: "approach", instructions: [{ t: "narrate", id: "a1", text: "a。" }] },
      { id: "shore", instructions: [{ t: "narrate", id: "s1", text: "s。" }] },
    ]);
    expect(player.state.vars["chose.branch.0"]).toBe(false);
    advanceToChoice(player);
    player.choose(undefined, 1);
    expect(player.state.vars["chose.branch.1"]).toBe(true);
    expect(player.state.vars["chose.branch.0"]).toBe(false);
    player.dispose();
  });

  it("does not track chose.* for choices without an id", () => {
    const player = new GraphNovelPlayer({ manifest, meta });
    player.loadGraph(graph, [
      { id: "start", instructions: [
        { t: "narrate", id: "n1", text: "岔路。" },
        { t: "choice", options: [{ text: "去", to: "approach" }] },
      ] },
      { id: "approach", instructions: [{ t: "narrate", id: "a1", text: "a。" }] },
      { id: "shore", instructions: [] },
    ]);
    advanceToChoice(player);
    player.choose(undefined, 0);
    expect(Object.keys(player.state.vars).some((k) => k.startsWith("chose."))).toBe(false);
    player.dispose();
  });
});

describe("if instruction execution (Spec 35)", () => {
  it("runs then-branch and merges back when condition is true", () => {
    const player = new GraphNovelPlayer({ manifest, meta });
    player.loadGraph(graph, [
      { id: "start", instructions: [
        { t: "set", key: "affection", value: 80 },
        { t: "if", condition: "affection >= 60", then: [{ t: "narrate", id: "hi", text: "高好感。" }] },
        { t: "narrate", id: "after", text: "合流。" },
      ] },
      { id: "approach", instructions: [] },
      { id: "shore", instructions: [] },
    ]);
    player.advance(); // set
    player.advance(); // if then narrate
    expect(player.state.narration?.text).toBe("高好感。");
    player.advance(); // 合流
    expect(player.state.narration?.text).toBe("合流。");
    player.dispose();
  });

  it("runs else-branch when condition is false and else is present", () => {
    const player = new GraphNovelPlayer({ manifest, meta });
    player.loadGraph(graph, [
      { id: "start", instructions: [
        { t: "set", key: "affection", value: 10 },
        { t: "if", condition: "affection >= 60",
          then: [{ t: "narrate", id: "hi", text: "高好感。" }],
          else: [{ t: "narrate", id: "lo", text: "低好感。" }] },
        { t: "narrate", id: "after", text: "合流。" },
      ] },
      { id: "approach", instructions: [] },
      { id: "shore", instructions: [] },
    ]);
    player.advance(); // set
    player.advance(); // if else narrate
    expect(player.state.narration?.text).toBe("低好感。");
    player.advance();
    expect(player.state.narration?.text).toBe("合流。");
    player.dispose();
  });

  it("skips silently when condition is false and there is no else", () => {
    const player = new GraphNovelPlayer({ manifest, meta });
    player.loadGraph(graph, [
      { id: "start", instructions: [
        { t: "set", key: "affection", value: 0 },
        { t: "if", condition: "affection >= 60", then: [{ t: "narrate", id: "hi", text: "高好感。" }] },
        { t: "narrate", id: "after", text: "合流。" },
      ] },
      { id: "approach", instructions: [] },
      { id: "shore", instructions: [] },
    ]);
    player.advance(); // set
    player.advance(); // if (跳过 then) → 合流到 after
    expect(player.state.narration?.text).toBe("合流。");
    player.dispose();
  });

  it("supports a choice nested inside an if-branch", () => {
    const player = new GraphNovelPlayer({ manifest, meta });
    player.loadGraph(graph, [
      { id: "start", instructions: [
        { t: "set", key: "affection", value: 80 },
        { t: "if", condition: "affection >= 60", then: [
          { t: "narrate", id: "hi", text: "高好感，做个选择。" },
          { t: "choice", id: "inner", options: [{ text: "去", to: "approach" }, { text: "留", to: "shore" }] },
        ] },
        { t: "narrate", id: "after", text: "合流。" },
      ] },
      { id: "approach", instructions: [{ t: "narrate", id: "a1", text: "a。" }] },
      { id: "shore", instructions: [{ t: "narrate", id: "s1", text: "s。" }] },
    ]);
    player.advance(); // set
    player.advance(); // then narrate
    advanceToChoice(player); // 内嵌 choice 呈现
    player.choose(undefined, 0);
    expect(player.getCurrentNodeId()).toBe("approach");
    expect(player.state.vars["chose.inner.0"]).toBe(true);
    player.dispose();
  });
});
