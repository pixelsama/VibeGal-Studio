/**
 * 预览面板 —— 用引擎跑项目，挂载当前选中的渲染层。
 *
 * 顶部工具条提供两种模式（Spec 17 步骤 1）：
 * - 剧情播放：player 驱动，行为与此前一致；
 * - 场景刷：把渲染层挂载到 fixture 场景（内置 + 项目自定义），设计视角的
 *   即时预览，与 CLI renderer-snapshot 看的是同一组场景。
 */
import { useEffect, useMemo, useState } from "react";
import type { ProjectData } from "../../lib/types";
import { RuntimeStateInspector } from "./RuntimeStateInspector";
import { useProjectPlayer } from "./useProjectPlayer";
import { useRendererComponent } from "./useRendererComponent";
import { StageFrame } from "./StageFrame";
import { SceneFixtureView, fixtureScenesForPreview, setFixtureUiHintGlobal } from "./SceneFixtureView";
import { formatRendererDiagnostics, type RendererDiagnostic } from "../renderers/diagnostics";
import { CenteredMessage } from "../common/CenteredMessage";
import { RendererTrustPrompt } from "../renderers/RendererTrustPrompt";
import { RuntimeMediaOverlay } from "./RuntimeMediaOverlay";

type PreviewMode = "story" | "fixtures";

interface Props {
  project: ProjectData;
  rendererId: string;
  onRendererDiagnosticsChange?: (diagnostics: RendererDiagnostic[]) => void;
  /** 初始模式，默认剧情播放；场景刷初始模式给测试与外观面板嵌入用。 */
  initialPreviewMode?: PreviewMode;
}

export function Preview({ project, rendererId, onRendererDiagnosticsChange, initialPreviewMode = "story" }: Props) {
  const player = useProjectPlayer(project);
  const { renderer, loadError, loadDiagnostics, trustRequired, trustRenderer } = useRendererComponent(project.path, rendererId);

  const [previewMode, setPreviewMode] = useState<PreviewMode>(initialPreviewMode);
  const fixtureScenes = useMemo(() => fixtureScenesForPreview(project), [project]);
  const [fixtureSceneId, setFixtureSceneId] = useState<string | null>(null);
  const activeFixtureScene = fixtureScenes.find((scene) => scene.id === fixtureSceneId) ?? fixtureScenes[0] ?? null;

  useEffect(() => {
    onRendererDiagnosticsChange?.(loadDiagnostics);
  }, [loadDiagnostics, onRendererDiagnosticsChange]);

  // uiHint 必须在渲染层重挂载之前写入全局（渲染层只在挂载初始化期读一次），
  // 因此所有模式/场景切换入口都先 setFixtureUiHintGlobal 再 setState。
  const showStoryMode = () => {
    setFixtureUiHintGlobal(undefined);
    setPreviewMode("story");
  };
  const showFixtureMode = () => {
    setFixtureUiHintGlobal(activeFixtureScene?.uiHint);
    setPreviewMode("fixtures");
  };
  const selectFixtureScene = (sceneId: string) => {
    setFixtureUiHintGlobal(fixtureScenes.find((scene) => scene.id === sceneId)?.uiHint);
    setFixtureSceneId(sceneId);
  };

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

  const fixtureMode = previewMode === "fixtures" && activeFixtureScene != null;
  const Renderer = renderer.Component;
  return (
    <div style={layoutStyle}>
      <div style={stagePaneStyle}>
        <div style={toolbarStyle}>
          <button
            type="button"
            className={fixtureMode ? "gs-tab" : "gs-tab gs-tab--active"}
            onClick={showStoryMode}
          >
            剧情播放
          </button>
          <button
            type="button"
            className={fixtureMode ? "gs-tab gs-tab--active" : "gs-tab"}
            onClick={showFixtureMode}
          >
            场景刷
          </button>
          {fixtureMode && (
            <select
              aria-label="场景"
              style={sceneSelectStyle}
              value={activeFixtureScene.id}
              onChange={(event) => selectFixtureScene(event.target.value)}
            >
              {fixtureScenes.map((scene) => (
                <option key={scene.id} value={scene.id}>{scene.title}</option>
              ))}
            </select>
          )}
        </div>
        <div style={stageMountStyle}>
          {fixtureMode ? (
            <SceneFixtureView project={project} renderer={renderer} scene={activeFixtureScene} />
          ) : (
            <StageFrame stage={player.rendererProps.stage}>
              <Renderer {...player.rendererProps} />
              <RuntimeMediaOverlay media={player.media} onClose={player.closeMedia} onSkip={player.skipVideo} />
            </StageFrame>
          )}
        </div>
      </div>
      {/* 场景刷模式下检视器显示 fixture state：场景刷是设计视角，侧栏本来
          就是 state 检视器，隐藏反而丢掉对 fixture state 的核对面。 */}
      <RuntimeStateInspector state={fixtureMode ? activeFixtureScene.state : player.state} />
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
  display: "flex",
  flexDirection: "column",
};

const toolbarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  flexShrink: 0,
  padding: "var(--space-1) var(--space-2)",
  borderBottom: "1px solid var(--border)",
};

const sceneSelectStyle: React.CSSProperties = {
  maxWidth: 220,
  padding: "5px var(--space-2)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-input)",
  background: "var(--bg-app)",
  color: "var(--text-primary)",
  fontSize: "var(--text-sm)",
};

const stageMountStyle: React.CSSProperties = {
  flex: 1,
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
