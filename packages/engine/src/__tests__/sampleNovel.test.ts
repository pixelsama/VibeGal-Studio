import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphNovelPlayer } from "../graphPlayer";
import { ProjectGraphSchema } from "../schema";
import type { Instruction, Manifest, Meta, VariableRegistry } from "../types";

/**
 * 示例项目是新功能的展示面，也是一份端到端回归：好感度式数值、旗标、枚举状态、
 * 出口效果与自动分流串起来必须真的能走通两条结局。
 */
const root = resolve(__dirname, "../../../../examples/sample-novel/content");
const read = (rel: string) => JSON.parse(readFileSync(resolve(root, rel), "utf8"));

const graph = ProjectGraphSchema.parse(read("graph.json"));
const manifest = read("manifest.json") as Manifest;
const meta = read("meta.json") as Meta;
const variables = read("variables.json") as VariableRegistry;

function play() {
  const player = new GraphNovelPlayer({
    manifest,
    meta: { ...meta, typingSpeedCps: 10_000, autoAdvanceMs: 0 },
    variables,
  });
  player.loadGraph(graph, graph.nodes.map((node) => ({
    id: node.id,
    instructions: read(node.file) as Instruction[],
  })));
  return player;
}

/**
 * 一直推进到出现选项或走到终点。
 *
 * 用假定时器跑掉 wait/打字机：示例剧本里有 `@wait`，只调用 advance() 会卡在
 * isWaiting 上（advance 在等待期间是空操作），看起来像「推不动了」。
 */
function advanceUntilChoiceOrEnd(player: GraphNovelPlayer, budget = 400) {
  for (let step = 0; step < budget; step += 1) {
    if (player.state.choice) return;
    if (player.state.nameInput) {
      player.submitName(player.state.nameInput.default ?? "旅人");
      continue;
    }
    const before = `${player.getCurrentNodeId()}:${player.getState().flags.progress.current}`;
    player.advance();
    if (player.state.flags.isWaiting) vi.advanceTimersByTime(5_000);
    const after = `${player.getCurrentNodeId()}:${player.getState().flags.progress.current}`;
    if (after === before && !player.state.choice) {
      // 真正停住了（终点），再多试一次仍不动就退出。
      player.advance();
      if (`${player.getCurrentNodeId()}:${player.getState().flags.progress.current}` === before) return;
    }
  }
}

describe("sample novel", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts with the declared P3 story state, not with nothing", () => {
    const player = play();
    expect(player.state.vars.playerName).toBe("旅人");
    expect(player.state.vars.resolve).toBe(0);
    expect(player.state.vars.knows_the_fire).toBe(false);
    expect(player.state.vars.route).toBe("drifting");
    expect(meta.locale).toEqual({ default: "zh-CN", available: ["zh-CN", "en"] });
    expect(manifest.animationAtlases.protagonist.clips?.signal.frames).toEqual([0, 1]);
    expect(manifest.unlocks.replay.guardian_memory.nodeId).toBe("protect");
    player.dispose();
  });

  it("collects a player name before offering the first route choice", () => {
    const player = play();
    for (let step = 0; step < 100 && !player.state.nameInput; step += 1) {
      player.advance();
      if (player.state.flags.isWaiting) vi.advanceTimersByTime(5_000);
    }
    expect(player.state.nameInput).toMatchObject({ key: "playerName", default: "旅人", maxLength: 12 });
    expect(player.submitName("灯塔守望者")).toBe(true);
    expect(player.state.vars.playerName).toBe("灯塔守望者");
    advanceUntilChoiceOrEnd(player);
    expect(player.state.choice).not.toBeNull();
    player.dispose();
  });

  it("offers a real choice at 苏醒", () => {
    const player = play();
    advanceUntilChoiceOrEnd(player);
    expect(player.state.choice?.choices.map((choice) => choice.text))
      .toEqual(["去看看那片火光", "留在原地"]);
    player.dispose();
  });

  it("reaches the guardian ending through the exit effects and the auto branch", () => {
    const player = play();
    advanceUntilChoiceOrEnd(player);
    player.choose("approach");
    // 出口效果：决心 +4，走向改为「护卫」。
    expect(player.state.vars.resolve).toBe(4);
    expect(player.state.vars.route).toBe("protector");
    advanceUntilChoiceOrEnd(player);
    // 节点内的 set 让 knows_the_fire 成立，auto 条件因此命中 protect。
    expect(player.state.vars.knows_the_fire).toBe(true);
    expect(player.getCurrentNodeId()).toBe("protect");
    player.dispose();
  });

  it("reaches the adrift ending when the player stays put", () => {
    const player = play();
    advanceUntilChoiceOrEnd(player);
    player.choose("shore");
    // 决心被钳制在下限 0，不会变成 -1。
    expect(player.state.vars.resolve).toBe(0);
    advanceUntilChoiceOrEnd(player);
    expect(player.getCurrentNodeId()).toBe("adrift");
    player.dispose();
  });

  it("attributes each change to the exit or instruction that made it", () => {
    const player = play();
    advanceUntilChoiceOrEnd(player);
    player.choose("approach");
    advanceUntilChoiceOrEnd(player);
    const writes = player.getStateWrites();
    expect(writes.find((w) => w.variable === "resolve")).toMatchObject({ edgeId: "awakening__approach", to: 4 });
    expect(writes.find((w) => w.variable === "knows_the_fire")).toMatchObject({ nodeId: "approach", to: true });
    player.dispose();
  });
});
