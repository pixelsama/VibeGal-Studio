import { describe, expect, it } from "vitest";
import type { GraphNode, ProjectData } from "../../lib/types";
import { buildNodePreviewContent } from "./useNodePreview";

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
    chapters: [{ relPath: "chapters/ch01.json", data: [{ t: "say", text: "old" }] }],
  },
  rendererIds: ["default"],
};

const node: GraphNode = {
  id: "prologue",
  title: "序章",
  file: "nodes/prologue.json",
  position: { x: 120, y: 180 },
};

describe("useNodePreview helpers", () => {
  it("buildNodePreviewContent treats node as single chapter when data exists", () => {
    expect(buildNodePreviewContent(project, node, [{ t: "say", text: "hello" }])).toEqual({
      meta: project.content.meta,
      manifest: project.content.manifest,
      chapters: [
        {
          file: "nodes/prologue.json",
          data: [{ t: "say", text: "hello" }],
        },
      ],
    });
  });

  it("buildNodePreviewContent returns empty chapter list when node data is missing", () => {
    expect(buildNodePreviewContent(project, node, null).chapters).toEqual([]);
    expect(buildNodePreviewContent(project, null, [{ t: "say", text: "hello" }]).chapters).toEqual([]);
  });
});
