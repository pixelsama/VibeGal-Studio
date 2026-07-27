import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createInitialState, type RendererProps } from "@vibegal/engine";
import type { GraphNode, ProjectData } from "../../lib/types";
import { NodePreviewPanel } from "./NodePreviewPanel";

vi.mock("./useNodePreview", () => ({
  useNodePreview: () => {
    const state = createInitialState();
    return {
      state,
      error: null,
      rendererProps: {
        state,
        manifest: {},
        contentBase: "/tmp/project/content",
        stage: { width: 1280, height: 720 },
        controls: {},
      },
      media: null,
      closeMedia: () => {},
      skipVideo: () => {},
      seekBy: () => {},
      stepOnce: () => {},
    };
  },
}));

vi.mock("../preview/useRendererComponent", () => ({
  useRendererComponent: () => ({
    renderer: {
      id: "probe",
      name: "Probe",
      contractVersion: 1,
      Component: (_props: RendererProps) => <div>renderer</div>,
    },
    loadError: null,
    loadDiagnostics: [],
    trustRequired: false,
    trustRenderer: () => {},
  }),
}));

const project: ProjectData = {
  path: "/tmp/project",
  meta: {
    name: "Project",
    activeRendererId: "default",
    createdAt: "2026-07-25T00:00:00.000Z",
  },
  content: {
    manifest: {},
    meta: {},
  },
  rendererIds: ["default"],
};

const node: GraphNode = {
  id: "start",
  title: "开始",
  file: "nodes/start.json",
  position: { x: 0, y: 0 },
};

describe("NodePreviewPanel", () => {
  it("uses a Chinese creator-facing title for the folded runtime panel", () => {
    const html = renderToStaticMarkup(
      <NodePreviewPanel
        project={project}
        rendererId="default"
        node={node}
        nodeData={[]}
        previewStartIndex={null}
        currentLineStartIndex={null}
        followCursor={false}
        followCursorAvailable
        onFollowCursorChange={() => {}}
        onPreviewStartChange={() => {}}
      />,
    );

    expect(html).toContain(">运行状态</span>");
    expect(html).toContain('aria-label="跟随光标"');
    expect(html).toContain('role="switch"');
    expect(html).toContain("从节点开始");
    expect(html).not.toContain(">Runtime</span>");
  });
});
