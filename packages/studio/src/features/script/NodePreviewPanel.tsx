import { useMemo, useState, type ReactNode } from "react";
import type { GraphNode, ProjectData } from "../../lib/types";
import { RuntimeStateInspector } from "../preview/RuntimeStateInspector";
import { StageFrame } from "../preview/StageFrame";
import { useRendererComponent } from "../preview/useRendererComponent";
import { formatRendererDiagnostics } from "../renderers/diagnostics";
import { CenteredMessage } from "../common/CenteredMessage";
import { collectNodeStoryPoints, sliceNodeDataFromStoryPoint } from "./nodePreviewStart";
import { useNodePreview } from "./useNodePreview";

export function NodePreviewPanel({ project, rendererId, node, nodeData }: {
  project: ProjectData;
  rendererId: string;
  node: GraphNode;
  nodeData: unknown | null;
}) {
  const storyPoints = useMemo(() => collectNodeStoryPoints(nodeData), [nodeData]);
  const [startInstructionId, setStartInstructionId] = useState("");
  const previewData = useMemo(
    () => sliceNodeDataFromStoryPoint(nodeData, startInstructionId || null),
    [nodeData, startInstructionId],
  );
  const player = useNodePreview(project, node, previewData);
  const { renderer, loadError, loadDiagnostics } = useRendererComponent(project.path, rendererId);

  if (player.error) return <PreviewMessage mono>{`引擎错误：\n\n${player.error}`}</PreviewMessage>;
  if (loadError) {
    const detail = loadDiagnostics.length > 0 ? formatRendererDiagnostics(loadDiagnostics) : loadError;
    return <PreviewMessage mono>{`渲染层加载失败（${rendererId}）：\n\n${detail}`}</PreviewMessage>;
  }
  if (!renderer) return <PreviewMessage>加载渲染层中…</PreviewMessage>;
  if (nodeData == null) return <PreviewMessage>节点无内容。保存后会在这里预览。</PreviewMessage>;

  const Renderer = renderer.Component;
  return (
    <div style={layoutStyle}>
      <div style={stagePaneStyle}>
        {storyPoints.length > 0 && (
          <div style={previewToolbarStyle}>
            <select
              value={startInstructionId}
              onChange={(event) => setStartInstructionId(event.target.value)}
              style={previewSelectStyle}
              aria-label="预览起点"
            >
              <option value="">从节点开始</option>
              {storyPoints.map((point) => (
                <option key={point.id} value={point.id}>{point.label}</option>
              ))}
            </select>
          </div>
        )}
        <StageFrame stage={player.rendererProps.stage}>
          <Renderer {...player.rendererProps} />
        </StageFrame>
      </div>
      <RuntimeStateInspector state={player.state} currentNodeLabel={`${node.title} (${node.id})`} />
    </div>
  );
}

function PreviewMessage({ children, mono = false }: { children: ReactNode; mono?: boolean }) {
  return <CenteredMessage mono={mono}>{children}</CenteredMessage>;
}

const layoutStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(260px, 320px)",
  width: "100%",
  height: "100%",
};

const stagePaneStyle: React.CSSProperties = {
  position: "relative",
  minWidth: 0,
  height: "100%",
};

const previewToolbarStyle: React.CSSProperties = {
  position: "absolute",
  top: 10,
  right: 10,
  zIndex: 2,
};

const previewSelectStyle: React.CSSProperties = {
  maxWidth: 220,
  padding: "5px var(--space-2)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-input)",
  background: "var(--bg-app)",
  color: "var(--text-primary)",
  fontSize: "var(--text-sm)",
};
