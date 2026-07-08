import { describe, expect, it } from "vitest";
import type { ProjectData } from "../../lib/types";
import {
  buildProjectPreviewContent,
  resolveAutoRoutePreview,
  type PreviewStartPoint,
} from "./useProjectPlayer";

const project: ProjectData = {
  path: "/tmp/sample-project",
  meta: { name: "Sample", activeRendererId: "default", createdAt: "2026-07-02T00:00:00.000Z" },
  content: {
    manifest: {
      characters: {},
      backgrounds: {},
      audio: { bgm: {}, sfx: {}, voice: {} },
      cg: {},
      videos: {},
      fonts: {},
      uiSkins: {},
      animationAtlases: {},
      unlocks: { cg: {}, music: {}, replay: {}, endings: {} },
    },
    meta: {},
  },
  rendererIds: ["default"],
  graph: {
    version: 1,
    entryNodeId: "start",
    nodes: [
      { id: "start", title: "Start", file: "nodes/start.json", position: { x: 120, y: 120 } },
      { id: "locked", title: "Locked", file: "nodes/locked.json", position: { x: 360, y: 80 } },
      { id: "fallback", title: "Fallback", file: "nodes/fallback.json", position: { x: 360, y: 180 } },
    ],
    edges: [
      { id: "start__locked", from: "start", to: "locked", mode: "auto", label: null, condition: "has_key == true" },
      { id: "start__fallback", from: "start", to: "fallback", mode: "auto", label: null, condition: null },
    ],
  },
  nodes: [
    {
      relPath: "nodes/start.json",
      data: [
        { t: "narrate", id: "line_01", text: "before" },
        { t: "narrate", id: "line_02", text: "target" },
      ],
    },
    { relPath: "nodes/locked.json", data: [{ t: "narrate", id: "locked_01", text: "locked" }] },
    { relPath: "nodes/fallback.json", data: [{ t: "narrate", id: "fallback_01", text: "fallback" }] },
  ],
};

describe("preview start helpers", () => {
  it("previewFromStoryPointStartsAtInstruction", () => {
    const start: PreviewStartPoint = { nodeId: "start", instructionId: "line_02" };

    expect(buildProjectPreviewContent(project, { start })).toEqual(expect.objectContaining({
      nodeIds: ["start", "locked", "fallback"],
      entryNodeId: "start",
      chapters: [
        { file: "nodes/start.json", data: [{ t: "narrate", id: "line_02", text: "target" }] },
        { file: "nodes/locked.json", data: [{ t: "narrate", id: "locked_01", text: "locked" }] },
        { file: "nodes/fallback.json", data: [{ t: "narrate", id: "fallback_01", text: "fallback" }] },
      ],
    }));
  });

  it("previewWithInitialVarsAffectsAutoRoute", () => {
    expect(resolveAutoRoutePreview(project.graph!, "start", { has_key: true })).toEqual({
      kind: "target",
      edgeId: "start__locked",
      nodeId: "locked",
    });

    expect(resolveAutoRoutePreview(project.graph!, "start", { has_key: false })).toEqual({
      kind: "target",
      edgeId: "start__fallback",
      nodeId: "fallback",
    });
  });
});
