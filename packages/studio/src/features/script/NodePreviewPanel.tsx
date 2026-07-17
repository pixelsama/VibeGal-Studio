import { useMemo, type ReactNode } from "react";
import { Play, StepBack, StepForward } from "lucide-react";
import type { GraphNode, ProjectData } from "../../lib/types";
import { RuntimeStateInspector } from "../preview/RuntimeStateInspector";
import { StageFrame } from "../preview/StageFrame";
import { useRendererComponent } from "../preview/useRendererComponent";
import { formatRendererDiagnostics } from "../renderers/diagnostics";
import { CenteredMessage } from "../common/CenteredMessage";
import { BottomSheet } from "../common/BottomSheet";
import { RendererTrustPrompt } from "../renderers/RendererTrustPrompt";
import { RuntimeMediaOverlay } from "../preview/RuntimeMediaOverlay";
import { collectNodeStoryPoints, sliceNodeDataFromIndex } from "./nodePreviewStart";
import { useNodePreview } from "./useNodePreview";

export function NodePreviewPanel({ project, rendererId, node, nodeData, previewStartIndex, currentLineStartIndex, onPreviewStartChange }: {
  project: ProjectData;
  rendererId: string;
  node: GraphNode;
  nodeData: unknown | null;
  /** 当前生效的预览起跑指令下标；null = 从节点开始。 */
  previewStartIndex: number | null;
  /** 光标所在剧本行对应的起跑下标；null = 该行不可起跑（有诊断或越界）。 */
  currentLineStartIndex: number | null;
  onPreviewStartChange: (index: number | null) => void;
}) {
  const storyPoints = useMemo(() => collectNodeStoryPoints(nodeData), [nodeData]);
  const previewData = useMemo(
    () => sliceNodeDataFromIndex(nodeData, previewStartIndex),
    [nodeData, previewStartIndex],
  );
  const player = useNodePreview(project, node, previewData);
  const { renderer, loadError, loadDiagnostics, trustRequired, trustRenderer } = useRendererComponent(project.path, rendererId);

  if (player.error) return <PreviewMessage mono>{`引擎错误：\n\n${player.error}`}</PreviewMessage>;
  if (trustRequired) return <RendererTrustPrompt projectPath={project.path} onTrust={trustRenderer} />;
  if (loadError) {
    const detail = loadDiagnostics.length > 0 ? formatRendererDiagnostics(loadDiagnostics) : loadError;
    return <PreviewMessage mono>{`渲染层加载失败（${rendererId}）：\n\n${detail}`}</PreviewMessage>;
  }
  if (!renderer) {
    // 与 Preview 一致的加载骨架：16:9 舞台占位 + 说明文字
    return (
      <div style={loadingShellStyle}>
        <div className="gs-skeleton" style={loadingStageStyle} />
        <div style={loadingHintStyle}>加载渲染层中…</div>
      </div>
    );
  }
  if (nodeData == null) return <PreviewMessage>节点无内容。保存后会在这里预览。</PreviewMessage>;

  const startSelectValue = previewStartIndex == null ? "" : String(previewStartIndex);
  const startInStoryPoints = previewStartIndex != null && storyPoints.some((point) => point.index === previewStartIndex);

  const Renderer = renderer.Component;
  return (
    <div style={layoutStyle}>
      <div style={stagePaneStyle}>
        <div style={previewToolbarStyle}>
          <button
            type="button"
            disabled={currentLineStartIndex == null}
            onClick={() => {
              if (currentLineStartIndex != null) onPreviewStartChange(currentLineStartIndex);
            }}
            style={previewButtonStyle}
            title="从光标所在行开始预览"
          >
            <Play size={12} />
            从当前行
          </button>
          <select
            value={startSelectValue}
            onChange={(event) => onPreviewStartChange(event.target.value === "" ? null : Number(event.target.value))}
            style={previewSelectStyle}
            aria-label="预览起点"
          >
            <option value="">从节点开始</option>
            {storyPoints.map((point) => (
              <option key={point.id} value={String(point.index)}>{point.label}</option>
            ))}
            {previewStartIndex != null && !startInStoryPoints && (
              <option value={String(previewStartIndex)}>第 {previewStartIndex + 1} 条指令</option>
            )}
          </select>
          <button
            type="button"
            onClick={() => player.seekBy(-1)}
            style={previewButtonStyle}
            title="上一条指令"
            aria-label="上一条指令"
          >
            <StepBack size={12} />
          </button>
          <button
            type="button"
            onClick={() => player.stepOnce()}
            style={previewButtonStyle}
            title="下一条指令"
            aria-label="下一条指令"
          >
            <StepForward size={12} />
          </button>
        </div>
        <StageFrame stage={player.rendererProps.stage}>
          <Renderer {...player.rendererProps} />
          <RuntimeMediaOverlay media={player.media} onClose={player.closeMedia} onSkip={player.skipVideo} />
        </StageFrame>
      </div>
      <BottomSheet title="Runtime" expandedHeight="min(300px, 60%)" defaultExpanded={false}>
        <RuntimeStateInspector state={player.state} currentNodeLabel={`${node.title} (${node.id})`} dock="bottom" />
      </BottomSheet>
    </div>
  );
}

function PreviewMessage({ children, mono = false }: { children: ReactNode; mono?: boolean }) {
  return <CenteredMessage mono={mono}>{children}</CenteredMessage>;
}

const layoutStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  width: "100%",
  height: "100%",
};

const stagePaneStyle: React.CSSProperties = {
  position: "relative",
  flex: "1 1 0",
  minWidth: 0,
  minHeight: 0,
};

const loadingShellStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "var(--space-3)",
  height: "100%",
};

const loadingStageStyle: React.CSSProperties = {
  width: "min(640px, 80%)",
  aspectRatio: "16 / 9",
  borderRadius: "var(--radius-md)",
};

const loadingHintStyle: React.CSSProperties = {
  color: "var(--text-muted)",
  fontSize: "var(--text-sm)",
};

const previewToolbarStyle: React.CSSProperties = {
  position: "absolute",
  top: 10,
  right: 10,
  zIndex: 2,
  display: "flex",
  alignItems: "center",
  gap: "var(--space-1)",
};

const previewButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "5px var(--space-2)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-input)",
  background: "var(--bg-app)",
  color: "var(--text-primary)",
  fontSize: "var(--text-sm)",
  cursor: "pointer",
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
