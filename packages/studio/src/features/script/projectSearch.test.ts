import { describe, expect, it } from "vitest";
import type { Manifest, NodeEntry, ProjectGraph } from "../../lib/types";
import { searchProject } from "./projectSearch";

const graph: ProjectGraph = {
  version: 1,
  entryNodeId: "start",
  nodes: [
    { id: "start", title: "Start", file: "nodes/start.json", position: { x: 0, y: 0 } },
    { id: "ending_true", title: "True Ending", file: "nodes/ending_true.json", position: { x: 240, y: 0 } },
  ],
  edges: [
    { id: "start__ending_true", from: "start", to: "ending_true", mode: "auto", label: null, condition: "affection >= 5" },
  ],
};

const nodeEntries: NodeEntry[] = [
  {
    relPath: "nodes/start.json",
    data: [
      { t: "say", id: "line_01", who: "hero", text: "The rooftop key is warm." },
      { t: "bg", id: "rooftop" },
      { t: "set", key: "affection", value: 6 },
      { t: "unlock", kind: "endings", id: "ending_true" },
    ],
  },
  { relPath: "nodes/ending_true.json", data: [{ t: "narrate", id: "end_01", text: "Dawn." }] },
];

const manifest: Manifest = {
  characters: {
    hero: { name: "Hero", color: "#fff", sprites: { default: "assets/characters/hero.png" } },
  },
  backgrounds: { rooftop: "assets/backgrounds/rooftop.png" },
  audio: { bgm: { theme: "assets/audio/bgm/theme.mp3" }, sfx: {}, voice: {} },
  cg: {
    rooftop_cg: {
      path: "assets/cg/rooftop.png",
      name: "Rooftop Promise",
      tags: ["memory"],
      unlockId: "cg_rooftop",
    },
  },
  videos: {},
  fonts: {},
  uiSkins: {},
  animationAtlases: {},
  unlocks: {
    cg: { cg_rooftop: { assetId: "rooftop_cg", title: "Rooftop CG" } },
    music: {},
    replay: { replay_start: { nodeId: "start", title: "Opening Replay" } },
    endings: { ending_true: { title: "True Ending", nodeId: "ending_true" } },
  },
};

describe("project search", () => {
  it("projectSearchFindsDialogueText", () => {
    const results = searchProject({ graph, nodeEntries, manifest }, "rooftop key");

    expect(results).toContainEqual(expect.objectContaining({
      kind: "instruction",
      nodeId: "start",
      instructionIndex: 0,
      instructionId: "line_01",
    }));
  });

  it("projectSearchFindsAssetReference", () => {
    const byId = searchProject({ graph, nodeEntries, manifest }, "rooftop");
    const byPath = searchProject({ graph, nodeEntries, manifest }, "assets/backgrounds/rooftop.png");

    expect(byId).toContainEqual(expect.objectContaining({
      kind: "instruction",
      nodeId: "start",
      instructionIndex: 1,
    }));
    expect(byPath).toContainEqual(expect.objectContaining({
      kind: "manifest",
      manifestPath: "backgrounds.rooftop",
    }));
  });

  it("finds variables, conditions, unlocks, replay and ending manifest entries", () => {
    const variableResults = searchProject({ graph, nodeEntries, manifest }, "affection");
    const replayResults = searchProject({ graph, nodeEntries, manifest }, "opening replay");
    const endingResults = searchProject({ graph, nodeEntries, manifest }, "ending_true");

    expect(variableResults).toContainEqual(expect.objectContaining({
      kind: "instruction",
      nodeId: "start",
      instructionIndex: 2,
    }));
    expect(variableResults).toContainEqual(expect.objectContaining({
      kind: "edge",
      edgeId: "start__ending_true",
    }));
    expect(replayResults).toContainEqual(expect.objectContaining({
      kind: "manifest",
      manifestPath: "unlocks.replay.replay_start",
      nodeId: "start",
    }));
    expect(endingResults).toContainEqual(expect.objectContaining({
      kind: "manifest",
      manifestPath: "unlocks.endings.ending_true",
      nodeId: "ending_true",
    }));
    expect(endingResults).toContainEqual(expect.objectContaining({
      kind: "instruction",
      instructionIndex: 3,
      instructionId: undefined,
    }));
  });
});
