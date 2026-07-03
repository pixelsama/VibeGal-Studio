import { describe, expect, it } from "vitest";
import type { ProjectData } from "../../lib/types";
import { buildProjectPreviewContent } from "./useProjectPlayer";

const project: ProjectData = {
  path: "/tmp/sample-project",
  meta: {
    name: "Sample",
    activeRendererId: "default",
    createdAt: "2026-07-02T00:00:00.000Z",
  },
  content: {
    manifest: {},
    meta: {},
  },
  rendererIds: ["default"],
  graph: {
    version: 1,
    entryNodeId: "start",
    nodes: [
      { id: "later", title: "Later", file: "nodes/later.json", position: { x: 380, y: 120 } },
      { id: "start", title: "Start", file: "nodes/start.json", position: { x: 120, y: 120 } },
    ],
    edges: [{ id: "start__later", from: "start", to: "later", condition: null }],
  },
  nodes: [
    { relPath: "nodes/later.json", data: [{ t: "narrate", text: "later" }] },
    { relPath: "nodes/start.json", data: [{ t: "narrate", text: "start" }] },
  ],
};

describe("useProjectPlayer helpers", () => {
  it("builds project preview content from graph nodes", () => {
    expect(buildProjectPreviewContent(project)).toEqual({
      meta: project.content.meta,
      manifest: project.content.manifest,
      chapters: [
        { file: "nodes/start.json", data: [{ t: "narrate", text: "start" }] },
        { file: "nodes/later.json", data: [{ t: "narrate", text: "later" }] },
      ],
    });
  });
});
