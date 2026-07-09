import { describe, expect, it } from "vitest";
import type { ProjectData } from "../../lib/types";
import { createProjectRendererProps, buildProjectPreviewContent } from "./useProjectPlayer";
import { createInitialState } from "@vibegal/engine";

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
        { file: "nodes/later.json", data: [{ t: "narrate", text: "later" }] },
        { file: "nodes/start.json", data: [{ t: "narrate", text: "start" }] },
      ],
      nodeIds: ["later", "start"],
      entryNodeId: "start",
      initialVars: {},
    });
  });

  it("rendererPropsRequiresControlsAdvance", () => {
    const advanceCalls: string[] = [];
    const props = createProjectRendererProps({
      state: createInitialState(),
      manifest: project.content.manifest,
      contentBase: `${project.path}/content`,
      stage: { width: 1280, height: 720 },
      controls: {
        advance: () => advanceCalls.push("advance"),
        choose: () => advanceCalls.push("choose"),
        setAutoPlay: () => advanceCalls.push("auto"),
        setSkipMode: () => advanceCalls.push("skip"),
        rollbackTo: () => advanceCalls.push("rollback"),
        restart: () => advanceCalls.push("restart"),
      },
      runtime: null,
    });

    props.controls.advance();

    expect(advanceCalls).toEqual(["advance"]);
    expect(props.runtime).toBeTruthy();
    expect("onAdvance" in props).toBe(false);
    expect("onChoose" in props).toBe(false);
  });
});
