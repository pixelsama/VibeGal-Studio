import type { ReactNode } from "react";
import type { GraphNode, ProjectData } from "../../lib/types";
import { RuntimeStateInspector } from "../preview/RuntimeStateInspector";
import { StageFrame } from "../preview/StageFrame";
import { useRendererComponent } from "../preview/useRendererComponent";
import { useNodePreview } from "./useNodePreview";

export function NodePreviewPanel({ project, rendererId, node, nodeData }: {
  project: ProjectData;
  rendererId: string;
  node: GraphNode;
  nodeData: unknown | null;
}) {
  const player = useNodePreview(project, node, nodeData);
  const { renderer, loadError } = useRendererComponent(project.path, rendererId);

  if (player.error) return <PreviewMessage mono>{`引擎错误：\n\n${player.error}`}</PreviewMessage>;
  if (loadError) return <PreviewMessage mono>{`渲染层加载失败（${rendererId}）：\n\n${loadError}`}</PreviewMessage>;
  if (!renderer) return <PreviewMessage>加载渲染层中…</PreviewMessage>;
  if (nodeData == null) return <PreviewMessage>节点无内容。保存后会在这里预览。</PreviewMessage>;

  const Renderer = renderer.Component;
  return (
    <div style={layoutStyle}>
      <div style={stagePaneStyle}>
        <StageFrame stage={player.rendererProps.stage}>
          <Renderer {...player.rendererProps} />
        </StageFrame>
      </div>
      <RuntimeStateInspector state={player.state} currentNodeLabel={`${node.title} (${node.id})`} />
    </div>
  );
}

function PreviewMessage({ children, mono = false }: { children: ReactNode; mono?: boolean }) {
  return (
    <div style={{
      width: "100%",
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "var(--space-6)",
      color: "var(--text-primary)",
      textAlign: "center",
      whiteSpace: "pre-wrap",
      lineHeight: 1.8,
      fontSize: "var(--text-md)",
      fontFamily: mono ? "ui-monospace, monospace" : "inherit",
    }}>
      {children}
    </div>
  );
}

const layoutStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(260px, 320px)",
  width: "100%",
  height: "100%",
};

const stagePaneStyle: React.CSSProperties = {
  minWidth: 0,
  height: "100%",
};
