/**
 * 预览面板 —— 用引擎跑项目，挂载当前选中的渲染层。
 *
 * 顶部工具条提供两种模式（Spec 17 步骤 1；Spec 19 §4.3 定稿文案）：
 * - 剧情播放：player 驱动，行为与此前一致；
 * - 场景快照：把渲染层挂载到 fixture 场景（内置 + 项目自定义），设计视角的
 *   只读巡检，与 CLI renderer-snapshot 看的是同一组场景。
 */
import { useMemo, useState } from "react";
import { FastForward, Play, RotateCcw, StepBack, StepForward } from "lucide-react";
import type { ProjectData } from "../../lib/types";
import { RuntimeStateInspector } from "./RuntimeStateInspector";
import { useProjectPlayer } from "./useProjectPlayer";
import { useRendererComponent } from "./useRendererComponent";
import { StageFrame } from "./StageFrame";
import { SceneFixtureView, fixtureScenesForPreview, setFixtureUiHintGlobal } from "./SceneFixtureView";
import { formatRendererDiagnostics } from "../renderers/diagnostics";
import { CenteredMessage } from "../common/CenteredMessage";
import { RendererTrustPrompt } from "../renderers/RendererTrustPrompt";
import { RuntimeMediaOverlay } from "./RuntimeMediaOverlay";
import { StateTrial } from "../script/StateTrial";
import { StoryInspection } from "./StoryInspection";
import { Button } from "../common/Button";
import { collectStateSources, stateSourceDefaults } from "../script/storyState";
import { useStudioI18n } from "../../lib/i18n";

type PreviewMode = "story" | "fixtures";

export function nextStudioFastForwardMode(skipMode: "off" | "read" | "all"): "off" | "all" {
  return skipMode === "all" ? "off" : "all";
}

interface Props {
  project: ProjectData;
  rendererId: string;
  loadingContent?: boolean;
  /** 初始模式，默认剧情播放；场景快照初始模式给测试与外观面板嵌入用。 */
  initialPreviewMode?: PreviewMode;
  /** 从剧情检查跳到改变状态的那条指令。 */
  onOpenNode?: (nodeId: string, instructionIndex?: number) => void;
  onSelectEdge?: (edgeId: string) => void;
}

export function Preview(props: Props) {
  const { t } = useStudioI18n();
  if (props.loadingContent && !props.project.nodes) {
    return <Centered>{t("preview.loadingContent")}</Centered>;
  }
  return <LoadedPreview {...props} />;
}

function LoadedPreview({ project, rendererId, initialPreviewMode = "story", onOpenNode, onSelectEdge }: Props) {
  const { t } = useStudioI18n();
  const player = useProjectPlayer(project);
  const { renderer, loadError, loadDiagnostics, trustRequired, trustRenderer } = useRendererComponent(project.path, rendererId);

  const [previewMode, setPreviewMode] = useState<PreviewMode>(initialPreviewMode);
  const fixtureScenes = useMemo(() => fixtureScenesForPreview(project), [project]);
  const [fixtureSceneId, setFixtureSceneId] = useState<string | null>(null);
  const [debugNodeId, setDebugNodeId] = useState(project.graph?.entryNodeId ?? "");
  const [debugInstructionId, setDebugInstructionId] = useState("");
  const [trialOpen, setTrialOpen] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  // 试算值与脚本工作台共用同一套模型：此前预览页和 Inspector 各有一份互不相通的
  // 「注入值 / 模拟变量」，作者在一边调好的值到另一边就消失。
  const [debugVariables, setDebugVariables] = useState<Record<string, string | number | boolean | null>>({});
  const trialSources = useMemo(
    () => collectStateSources({
      registry: project.content.variables,
      graph: project.graph ?? undefined,
      manifest: project.content.manifest,
      t,
    }),
    [project.content.variables, project.graph, project.content.manifest, t],
  );
  const trialDefaults = useMemo(() => stateSourceDefaults(trialSources), [trialSources]);
  const activeFixtureScene = fixtureScenes.find((scene) => scene.id === fixtureSceneId) ?? fixtureScenes[0] ?? null;
  const debugNode = project.graph?.nodes.find((node) => node.id === debugNodeId);
  const debugInstructions = project.nodes?.find((entry) => entry.relPath === debugNode?.file)?.data;
  const stableInstructions = Array.isArray(debugInstructions) ? debugInstructions.filter((instruction) => {
    const item = instruction as { t?: string; id?: string };
    return typeof item.id === "string" && ["say", "narrate", "wait", "pause", "completeEnding"].includes(item.t ?? "");
  }) as Array<{ t: string; id: string }> : [];

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
    return <Centered mono>{t("preview.engineError", { detail: player.error })}</Centered>;
  }
  if (trustRequired) {
    return <RendererTrustPrompt projectPath={project.path} onTrust={trustRenderer} />;
  }
  if (loadError) {
    const detail = loadDiagnostics.length > 0 ? formatRendererDiagnostics(loadDiagnostics) : loadError;
    return <Centered mono>{t("preview.rendererLoadError", { rendererId, detail })}</Centered>;
  }
  if (!renderer) {
    // 渲染层加载期间用 16:9 骨架舞台占位，比一行字更接近真实布局
    return (
      <div style={loadingShellStyle}>
        <div className="gs-skeleton" style={loadingStageStyle} />
        <div style={loadingHintStyle}>{t("preview.loadingRenderer")}</div>
      </div>
    );
  }

  const fixtureMode = previewMode === "fixtures" && activeFixtureScene != null;
  const Renderer = renderer.Component;
  return (
    <div style={inspecting ? inspectingLayoutStyle : layoutStyle}>
      <div style={stagePaneStyle}>
        <div style={toolbarStyle}>
          <button
            type="button"
            className={fixtureMode ? "gs-tab" : "gs-tab gs-tab--active"}
            onClick={showStoryMode}
          >
            {t("preview.storyMode")}
          </button>
          <button
            type="button"
            className={fixtureMode ? "gs-tab gs-tab--active" : "gs-tab"}
            onClick={showFixtureMode}
          >
            {t("preview.fixtureMode")}
          </button>
          {fixtureMode && (
            <select
              aria-label={t("preview.scene")}
              style={sceneSelectStyle}
              value={activeFixtureScene.id}
              onChange={(event) => selectFixtureScene(event.target.value)}
            >
              {fixtureScenes.map((scene) => (
                <option key={scene.id} value={scene.id}>{scene.title}</option>
              ))}
            </select>
          )}
          {!fixtureMode && (
            <>
              <select aria-label={t("preview.debugStart")} style={sceneSelectStyle} value={debugNodeId} onChange={(event) => { setDebugNodeId(event.target.value); setDebugInstructionId(""); }}>
                {project.graph?.nodes.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}
              </select>
              <select aria-label={t("preview.debugInstruction")} style={sceneSelectStyle} value={debugInstructionId} onChange={(event) => setDebugInstructionId(event.target.value)}>
                <option value="">{t("preview.nodeStart")}</option>
                {stableInstructions.map((instruction) => <option key={instruction.id} value={instruction.id}>{instruction.id}</option>)}
              </select>
              <Button
                onClick={() => setTrialOpen((open) => !open)}
                aria-expanded={trialOpen}
              >
                {t("preview.assumeContext")}
              </Button>
              <Button
                variant="primary"
                onClick={() => debugNodeId && player.startDebugSession(debugNodeId, { ...trialDefaults, ...debugVariables }, debugInstructionId || undefined)}
              >
                {t("preview.rehearseHere")}
              </Button>
            </>
          )}
          <div style={{ flex: 1 }} />
          {!fixtureMode && (
            <div style={playbackControlsStyle} role="group" aria-label={t("preview.controls")}>
              <Button onClick={player.restart} title={t("preview.restartTitle")}>
                <RotateCcw size={14} />
                {t("preview.restart")}
              </Button>
              <Button onClick={() => player.seekBy(-1)} title={t("preview.previousTitle")}>
                <StepBack size={14} />
                {t("preview.previous")}
              </Button>
              <Button onClick={player.stepOnce} title={t("preview.nextTitle")}>
                <StepForward size={14} />
                {t("preview.next")}
              </Button>
              <Button
                aria-pressed={player.state.flags.isAutoPlay}
                variant={player.state.flags.isAutoPlay ? "primary" : "secondary"}
                onClick={player.toggleAuto}
              >
                <Play size={14} />
                {t("preview.auto")}
              </Button>
              <Button
                aria-pressed={player.state.flags.skipMode === "all"}
                variant={player.state.flags.skipMode === "all" ? "primary" : "secondary"}
                onClick={() => player.setSkipMode(nextStudioFastForwardMode(player.state.flags.skipMode))}
              >
                <FastForward size={14} />
                {t("preview.fastForward")}
              </Button>
            </div>
          )}
          <Button onClick={() => setInspecting((open) => !open)} aria-expanded={inspecting}>
            {t("preview.inspect")}
          </Button>
        </div>
        {!fixtureMode && trialOpen && (
          <div className="gs-trial-pane">
            <StateTrial sources={trialSources} values={{ ...trialDefaults, ...debugVariables }} onChange={setDebugVariables} />
            <p className="gs-trial-pane__note">{t("preview.trialNote")}</p>
          </div>
        )}
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
      {/* 舞台是主角：检查面板默认不出现，由工具条按需打开。
          场景快照是渲染层作者的只读巡检面，仍然给出 fixture 的原始状态检视器。 */}
      {fixtureMode
        ? inspecting && (
          <RuntimeStateInspector state={activeFixtureScene.state} registry={project.content.variables} />
        )
        : inspecting && (
          <StoryInspection
            state={player.state}
            graph={project.graph}
            registry={project.content.variables}
            manifest={project.content.manifest}
            stateWrites={player.stateWrites}
            currentNodeId={player.currentNodeId}
            onClose={() => setInspecting(false)}
            onOpenNode={onOpenNode}
            onSelectEdge={onSelectEdge}
            onReplayWithCurrentValues={() => {
              // 逃生口：把当前实际值搬进试演假设，一步回到「从这里试演」。
              setDebugVariables(Object.fromEntries(
                Object.entries(player.state.vars).filter(([name]) => !name.startsWith("system.")),
              ));
              setTrialOpen(true);
            }}
          />
        )}
    </div>
  );
}

function Centered({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return <CenteredMessage mono={mono}>{children}</CenteredMessage>;
}

/** 检查面板关掉时不留空列，舞台独占宽度。 */
const layoutStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr)",
  width: "100%",
  height: "100%",
};

const inspectingLayoutStyle: React.CSSProperties = {
  ...layoutStyle,
  gridTemplateColumns: "minmax(0, 1fr) minmax(260px, 320px)",
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

const playbackControlsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-1)",
  paddingLeft: "var(--space-2)",
  borderLeft: "1px solid var(--border)",
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
