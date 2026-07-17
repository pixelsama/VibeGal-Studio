/**
 * 预览面板 —— 用引擎跑项目，挂载当前选中的渲染层。
 */
import { useEffect } from "react";
import type { ProjectData } from "../../lib/types";
import { RuntimeStateInspector } from "./RuntimeStateInspector";
import { useProjectPlayer } from "./useProjectPlayer";
import { useRendererComponent } from "./useRendererComponent";
import { StageFrame } from "./StageFrame";
import { formatRendererDiagnostics, type RendererDiagnostic } from "../renderers/diagnostics";
import { CenteredMessage } from "../common/CenteredMessage";
import { RendererTrustPrompt } from "../renderers/RendererTrustPrompt";
import { RuntimeMediaOverlay } from "./RuntimeMediaOverlay";

interface Props {
  project: ProjectData;
  rendererId: string;
  onRendererDiagnosticsChange?: (diagnostics: RendererDiagnostic[]) => void;
}

export function Preview({ project, rendererId, onRendererDiagnosticsChange }: Props) {
  const player = useProjectPlayer(project);
  const { renderer, loadError, loadDiagnostics, trustRequired, trustRenderer } = useRendererComponent(project.path, rendererId);

  useEffect(() => {
    onRendererDiagnosticsChange?.(loadDiagnostics);
  }, [loadDiagnostics, onRendererDiagnosticsChange]);

  if (player.error) {
    return <Centered mono>{`引擎错误：\n\n${player.error}`}</Centered>;
  }
  if (trustRequired) {
    return <RendererTrustPrompt projectPath={project.path} onTrust={trustRenderer} />;
  }
  if (loadError) {
    const detail = loadDiagnostics.length > 0 ? formatRendererDiagnostics(loadDiagnostics) : loadError;
    return <Centered mono>{`渲染层加载失败（${rendererId}）：\n\n${detail}\n\n请确认项目 renderers/${rendererId}/index.tsx 存在，且渲染层源码没有未支持的 import。`}</Centered>;
  }
  if (!renderer) {
    // 渲染层加载期间用 16:9 骨架舞台占位，比一行字更接近真实布局
    return (
      <div style={loadingShellStyle}>
        <div className="gs-skeleton" style={loadingStageStyle} />
        <div style={loadingHintStyle}>加载渲染层中…</div>
      </div>
    );
  }

  const Renderer = renderer.Component;
  return (
    <div style={layoutStyle}>
      <div style={stagePaneStyle}>
        <StageFrame stage={player.rendererProps.stage}>
          <Renderer {...player.rendererProps} />
          <RuntimeMediaOverlay media={player.media} onClose={player.closeMedia} onSkip={player.skipVideo} />
        </StageFrame>
      </div>
      <RuntimeStateInspector state={player.state} />
    </div>
  );
}

function Centered({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return <CenteredMessage mono={mono}>{children}</CenteredMessage>;
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
