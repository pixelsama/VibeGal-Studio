import { describe, expect, it } from "vitest";
import { normalizeManifest } from "./normalizeManifest";
import { EMPTY_MANIFEST, type Manifest } from "./types";
import { endingsForNode, registerEnding } from "../features/script/endingRegistry";
import { referencesAffectedByNodeDeletion } from "../features/script/nodeReferences";
import { analyzeEndingRouteMatrix, collectUnregisteredTerminals } from "../features/script/routeAnalysis";

/** 模拟后端原样返回的 manifest.json：缺省 unlocks/audio 等注册表字段 */
function rawManifestWithoutRegistries(): Manifest {
  return {
    characters: { hero: { name: "主角", color: "#fff", sprites: { default: "a.svg" } } },
    backgrounds: { dawn: "bg.svg" },
  } as unknown as Manifest;
}

const emptyGraph = {
  version: 1, entryNodeId: "start",
  nodes: [{ id: "start", title: "Start", file: "nodes/start.json", position: { x: 0, y: 0 } }],
  edges: [],
};

describe("normalizeManifest", () => {
  it("补齐缺失的全部注册表（含 unlocks 四张子表与 audio 三张子表）", () => {
    const normalized = normalizeManifest(rawManifestWithoutRegistries());
    expect(normalized.unlocks).toEqual({ cg: {}, music: {}, replay: {}, endings: {} });
    expect(normalized.audio).toEqual({ bgm: {}, sfx: {}, voice: {} });
    expect(normalized.cg).toEqual({});
    expect(normalized.videos).toEqual({});
    expect(normalized.fonts).toEqual({});
    expect(normalized.uiSkins).toEqual({});
    expect(normalized.animationAtlases).toEqual({});
    // 已有字段与未知额外字段原样保留
    expect(normalized.characters.hero.name).toBe("主角");
    expect((normalized as Record<string, unknown>).customField).toBeUndefined();
  });

  it("保留已存在的注册表内容，只补缺失的子表", () => {
    const raw = {
      ...rawManifestWithoutRegistries(),
      unlocks: { endings: { true_end: { title: "真结局", nodeId: "start" } } },
      audio: { bgm: { main: "bgm.mp3" } },
      customField: "keep-me",
    } as unknown as Manifest;
    const normalized = normalizeManifest(raw);
    expect(normalized.unlocks.endings.true_end).toEqual({ title: "真结局", nodeId: "start" });
    expect(normalized.unlocks.cg).toEqual({});
    expect(normalized.audio.bgm.main).toBe("bgm.mp3");
    expect(normalized.audio.voice).toEqual({});
    expect((normalized as Record<string, unknown>).customField).toBe("keep-me");
  });

  it("对完整 manifest 是恒等操作", () => {
    expect(normalizeManifest(EMPTY_MANIFEST)).toEqual(EMPTY_MANIFEST);
  });

  it("归一化后，此前裸访问 unlocks 的分析/登记/删除路径都不再抛错", () => {
    const normalized = normalizeManifest(rawManifestWithoutRegistries());
    // 分析面板渲染路径（此前白屏根因）
    expect(analyzeEndingRouteMatrix({ graph: emptyGraph, manifest: normalized }).rows).toEqual([]);
    expect(collectUnregisteredTerminals(emptyGraph, normalized)).toEqual([{ nodeId: "start", title: "Start" }]);
    // 结局登记 / 节点删除等交互路径
    expect(endingsForNode(normalized, "start")).toEqual([]);
    expect(referencesAffectedByNodeDeletion(normalized, ["start"])).toEqual([]);
    const next = registerEnding(normalized, { id: "true_end", title: "真结局", nodeId: "start" });
    expect(next.unlocks.endings.true_end).toEqual({ title: "真结局", nodeId: "start" });
  });
});
