/**
 * AppearanceWorkspace —— 外观工作台（Spec 17 步骤 3：面板 + 宫格预览；步骤 4
 * 的舞台拖拽在单场景视图里，见 StageDesignView）。
 *
 * 数据流（spec §6：修改 → save_manifest → 刷新链路更新预览）：
 *   编辑 token / 拖拽松手 → 纯函数不可变变换出新 manifest（appearanceTokens.ts）
 *   → 本地 draft 立即驱动右侧预览（跟手）→ 300ms 防抖后经
 *   RevisionedProjectMutationQueue 调 save_manifest（带 expectedRevision 串行落盘）
 *   → 成功后 onSaved 触发项目刷新（watcher 命中 content/ 也会走同一条路）
 *   → 新 project 到达后丢弃 draft，预览由真实数据接管。
 *   save_manifest 返回 null = revision 冲突（磁盘已被外部改写）：保留 draft 并
 *   锁死编辑，banner 提供「重新加载」。
 *
 * 布局：左侧 token 属性分组（TokenEditorPanel + 贴图分组），右侧场景快照预览
 * （宫格同屏 / 单场景设计面）。渲染层加载与信任流程复用 Preview 的接法。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Palette } from "lucide-react";
import { ManifestSchema } from "@vibegal/engine";
import { EMPTY_MANIFEST, type Manifest, type ProjectData } from "../../lib/types";
import { saveManifest } from "../../lib/tauri";
import { readStageResolution } from "../../lib/projectMeta";
import { RevisionedProjectMutationQueue } from "../../lib/projectMutation";
import { useRendererComponent } from "../preview/useRendererComponent";
import { RendererTrustPrompt } from "../renderers/RendererTrustPrompt";
import { formatRendererDiagnostics } from "../renderers/diagnostics";
import { CenteredMessage } from "../common/CenteredMessage";
import { EmptyState } from "../common/EmptyState";
import { Button } from "../common/Button";
import { Toast, type ToastInput, type ToastMessage } from "../common/Toast";
import { SceneFixtureView, fixtureScenesForPreview, setFixtureUiHintGlobal } from "../preview/SceneFixtureView";
import type { FixtureScene } from "../../export/snapshotScenes";
import {
  mergeTokenOverrides,
  readSkinTokens,
  saveAppearanceManifest,
  selectEditableSkinId,
  tokenGroupsForPart,
  withDefaultUiSkin,
  withUiSkinToken,
} from "./appearanceTokens";
import { TokenEditorPanel } from "./TokenEditorPanel";
import { SkinAssetsSection } from "./SkinAssetsSection";
import { StageDesignView } from "./StageDesignView";

type AppearanceViewMode = "grid" | "single";

interface AppearanceWorkspaceProps {
  project: ProjectData;
  rendererId: string;
  onSaved: () => void | Promise<void>;
  /** 初始视图，默认宫格；单场景入口主要给测试与未来的嵌入方用 */
  initialViewMode?: AppearanceViewMode;
}

/** token 编辑的落盘防抖：颜色拖拽/连续击键时合并成一次写盘。 */
const PERSIST_DEBOUNCE_MS = 300;

export function AppearanceWorkspace({ project, rendererId, onSaved, initialViewMode = "grid" }: AppearanceWorkspaceProps) {
  const { renderer, loadError, loadDiagnostics, trustRequired, trustRenderer } = useRendererComponent(project.path, rendererId);

  const [draft, setDraft] = useState<Manifest | null>(null);
  const [conflict, setConflict] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [viewMode, setViewMode] = useState<AppearanceViewMode>(initialViewMode);
  const [sceneId, setSceneId] = useState<string | null>(null);
  // 舞台拖拽 overlay 外发的选中部件：属性面板按它过滤分组（inspector 模式）
  const [selectedPart, setSelectedPart] = useState<string | null>(null);

  const mutationQueue = useMemo(
    () => new RevisionedProjectMutationQueue(project.manifestRevision),
    [project.path],
  );
  const persistTimerRef = useRef<number | null>(null);
  const pendingManifestRef = useRef<Manifest | null>(null);

  useEffect(() => {
    mutationQueue.synchronizeRevision(project.manifestRevision);
  }, [mutationQueue, project.manifestRevision]);

  // 防崩（与资产页同一取舍）：manifest 运行时可能是坏数据，safeParse 兜底，
  // 结构错误由全局 projectReport 呈现，这里禁用编辑即可。
  const parsedManifest = useMemo(() => ManifestSchema.safeParse(project.content.manifest), [project.content.manifest]);
  const baseManifest: Manifest = parsedManifest.success ? parsedManifest.data : EMPTY_MANIFEST;
  const manifestInvalid = !parsedManifest.success;
  const readOnly = manifestInvalid || conflict;

  const displayManifest = draft ?? baseManifest;
  const skinId = useMemo(() => selectEditableSkinId(displayManifest), [displayManifest]);
  const skinTokens = useMemo(
    () => (skinId ? readSkinTokens(displayManifest, skinId) : {}),
    [displayManifest, skinId],
  );
  // 生效 skin 的贴图槽位（Spec 19 §4.5「贴图」分组，只读展示）
  const skinAssets = useMemo<Record<string, string>>(
    () => ({ ...(skinId ? (displayManifest.uiSkins?.[skinId]?.assets ?? {}) : {}) }),
    [displayManifest, skinId],
  );
  const fontFamilies = useMemo(
    () => [...new Set(Object.values(displayManifest.fonts ?? {}).map((font) => font.family))],
    [displayManifest],
  );

  // 预览链路吃 display manifest：draft（编辑中/落盘中）与真实数据走同一条通路
  const displayProject = useMemo<ProjectData>(
    () => ({ ...project, content: { ...project.content, manifest: displayManifest } }),
    [project, displayManifest],
  );
  const stage = useMemo(() => readStageResolution(project.content.meta), [project.content.meta]);
  const scenes = useMemo(() => fixtureScenesForPreview(displayProject), [displayProject]);
  const activeScene = scenes.find((scene) => scene.id === sceneId) ?? scenes[0] ?? null;

  function notify(input: ToastInput) {
    setToast({ id: Date.now(), ...input });
  }

  // ── 持久化 ──

  const flushPersist = useCallback(async () => {
    const next = pendingManifestRef.current;
    if (!next) return;
    pendingManifestRef.current = null;
    try {
      // 队列串行携带 revision（enqueue 只吃 FileRevision|null），冲突判定经
      // saveAppearanceManifest 的 outcome 带出
      let conflictDetected = false;
      await mutationQueue.enqueue(async (expectedRevision) => {
        const outcome = await saveAppearanceManifest(saveManifest, project.path, next, expectedRevision);
        conflictDetected = outcome.status === "conflict";
        return outcome.revision;
      });
      if (conflictDetected) {
        // 磁盘已被外部改写：保留 draft 并锁死，由 banner 引导重新加载
        setConflict(true);
        return;
      }
      // 队列清空后主动刷新一次（watcher 通常也会触发，双保险且幂等）
      if (mutationQueue.pending === 0) await onSaved();
    } catch (error) {
      notify({
        kind: "error",
        message: "保存 manifest 失败",
        detail: `${error instanceof Error ? error.message : String(error)}。改动仍保留在面板里。`,
      });
    }
  }, [mutationQueue, project.path, onSaved]);

  const schedulePersist = useCallback(
    (next: Manifest) => {
      pendingManifestRef.current = next;
      if (persistTimerRef.current !== null) window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = window.setTimeout(() => {
        persistTimerRef.current = null;
        void flushPersist();
      }, PERSIST_DEBOUNCE_MS);
    },
    [flushPersist],
  );

  // 卸载（切 tab/关项目）时把防抖窗口内的最后一笔改动补落盘（best effort）
  useEffect(() => () => {
    if (persistTimerRef.current !== null) window.clearTimeout(persistTimerRef.current);
    const next = pendingManifestRef.current;
    if (next) {
      pendingManifestRef.current = null;
      void mutationQueue.enqueue(async (expectedRevision) => {
        const outcome = await saveAppearanceManifest(saveManifest, project.path, next, expectedRevision);
        return outcome.revision;
      });
    }
  }, [mutationQueue, project.path]);

  // 刷新链路把保存后的 manifest 带回来了：丢弃 draft，预览由真实数据接管。
  // 若用户又开了新一笔（pending/队列中），保留 draft 等下一轮。
  useEffect(() => {
    if (!conflict && pendingManifestRef.current === null && mutationQueue.pending === 0) {
      setDraft(null);
    }
  }, [project.content.manifest, project.manifestRevision, conflict, mutationQueue]);

  // ── 编辑入口 ──

  const handleEditToken = useCallback(
    (key: string, value: string | number | undefined) => {
      if (!skinId || readOnly) return;
      const next = withUiSkinToken(displayManifest, skinId, key, value);
      setDraft(next);
      schedulePersist(next);
    },
    [skinId, readOnly, displayManifest, schedulePersist],
  );

  const handleEnableAppearance = useCallback(() => {
    const next = withDefaultUiSkin(displayManifest);
    setDraft(next);
    schedulePersist(next);
  }, [displayManifest, schedulePersist]);

  // 舞台拖拽松手：几何 token（x/y 或含 width/height）整体落盘
  const handlePersistGeometry = useCallback(
    (entries: Record<string, number>) => {
      if (!skinId || readOnly) return;
      const next = mergeTokenOverrides(displayManifest, skinId, entries);
      setDraft(next);
      schedulePersist(next);
    },
    [skinId, readOnly, displayManifest, schedulePersist],
  );

  const handleReloadAfterConflict = useCallback(() => {
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    pendingManifestRef.current = null;
    setConflict(false);
    setDraft(null);
    void onSaved();
  }, [onSaved]);

  // ── 视图切换（uiHint 必须先于挂载写入全局，与 Preview 同一时序约定） ──

  const showGrid = () => {
    setFixtureUiHintGlobal(undefined);
    setSelectedPart(null);
    setViewMode("grid");
  };
  const showSingle = () => {
    setFixtureUiHintGlobal(activeScene?.uiHint);
    setViewMode("single");
  };
  // 宫格卡片点击直达对应场景的单场景设计面。uiHint 必须先于挂载写入目标
  // 场景的 hint（与 Preview 同一时序约定）——不能复用 showSingle，它写的
  // 是旧 activeScene 的 hint（setSceneId 尚未生效）。
  const openSceneInDesign = (scene: FixtureScene) => {
    setFixtureUiHintGlobal(scene.uiHint);
    setSceneId(scene.id);
    setSelectedPart(null);
    setViewMode("single");
  };
  const selectScene = (id: string) => {
    setFixtureUiHintGlobal(scenes.find((scene) => scene.id === id)?.uiHint);
    setSelectedPart(null);
    setSceneId(id);
  };

  // ── 渲染层加载/信任门禁（与 Preview 同一接法） ──

  if (trustRequired) {
    return <RendererTrustPrompt projectPath={project.path} onTrust={trustRenderer} />;
  }
  if (loadError) {
    const detail = loadDiagnostics.length > 0 ? formatRendererDiagnostics(loadDiagnostics) : loadError;
    return (
      <CenteredMessage mono>{`渲染层加载失败（${rendererId}）：\n\n${detail}\n\n外观面板需要一个可加载的渲染层来预览 token 效果。`}</CenteredMessage>
    );
  }
  if (!renderer) {
    return (
      <div style={loadingShellStyle}>
        <div className="gs-skeleton" style={loadingStageStyle} />
        <div style={loadingHintStyle}>加载渲染层中…</div>
      </div>
    );
  }

  return (
    <div style={rootStyle}>
      {/* 右侧：token 属性编辑（检查器） */}
      <div style={panelColumnStyle}>
        {conflict && (
          <div style={conflictBannerStyle} role="alert">
            <span style={conflictTextStyle}>
              manifest 已在磁盘上被修改（revision 冲突），最近的外观改动未保存。重新加载后可继续编辑。
            </span>
            <Button variant="primary" onClick={handleReloadAfterConflict}>重新加载</Button>
          </div>
        )}
        {manifestInvalid ? (
          <div style={conflictBannerStyle} role="alert">
            <span style={conflictTextStyle}>manifest 结构异常（可能是旧格式），外观编辑已禁用。详见右下角问题面板。</span>
          </div>
        ) : skinId === null ? (
          <EmptyState
            icon={Palette}
            title="尚未启用外观编辑"
            description={"启用后会在 manifest 写入一个空的 uiSkins.default（name 为「默认外观」），\n之后即可用左侧属性与舞台拖拽调整外观；不改动任何其它文件。"}
            action={<Button variant="primary" onClick={handleEnableAppearance}>启用外观编辑</Button>}
          />
        ) : (
          <>
            <div style={skinHeaderStyle}>
              {/* Spec 19 §4.5：把外观依附于界面风格的层级关系说破 */}
              <div style={hierarchyNoteStyle}>调整当前界面风格（{rendererId}）暴露的外观参数</div>
              {/* Spec 19 §3：「编辑皮肤：<id>」→「编辑外观」，单 skin 后 skin id 无展示价值 */}
              <div style={skinTitleStyle}>编辑外观</div>
            </div>
            {selectedPart !== null && viewMode === "single" && (
              <div style={selectionBarStyle} data-selected-part={selectedPart}>
                <span style={selectionLabelStyle}>
                  已选中部件：<span style={selectionPartStyle}>{selectedPart}</span>
                </span>
                <button
                  type="button"
                  style={selectionClearStyle}
                  title="取消选中，显示全部属性"
                  onClick={() => setSelectedPart(null)}
                >
                  全部属性
                </button>
              </div>
            )}
            <TokenEditorPanel
              tokens={skinTokens}
              fontFamilies={fontFamilies}
              disabled={readOnly}
              groups={selectedPart !== null && viewMode === "single" ? tokenGroupsForPart(selectedPart) : undefined}
              onEdit={handleEditToken}
            />
            {/* Spec 19 §4.5：生效 skin 的贴图槽位（折叠高级区，V1 只读） */}
            <SkinAssetsSection projectPath={project.path} assets={skinAssets} />
          </>
        )}
      </div>

      {/* 左侧：场景快照预览（宫格 / 单场景） */}
      <div style={previewColumnStyle}>
        <div style={toolbarStyle}>
          <button
            type="button"
            className={viewMode === "grid" ? "gs-tab gs-tab--active" : "gs-tab"}
            onClick={showGrid}
          >
            宫格
          </button>
          <button
            type="button"
            className={viewMode === "single" ? "gs-tab gs-tab--active" : "gs-tab"}
            onClick={showSingle}
          >
            单场景
          </button>
          {viewMode === "single" && activeScene && (
            <select
              aria-label="场景"
              style={sceneSelectStyle}
              value={activeScene.id}
              onChange={(event) => selectScene(event.target.value)}
            >
              {scenes.map((scene) => (
                <option key={scene.id} value={scene.id}>{scene.title}</option>
              ))}
            </select>
          )}
        </div>
        <div style={previewMountStyle}>
          {viewMode === "grid" ? (
            <div style={gridScrollStyle}>
              {/* 性能注记：宫格把全场景（11 个内置 + 自定义）各挂一棵渲染层树。
                  渲染层通常是轻量静态组件，V1 全量挂载换取实现简单；实测卡顿再
                  做视口内懒挂载（IntersectionObserver）。 */}
              <div style={gridStyle}>
                {scenes.map((scene) => (
                  <figure key={scene.id} style={gridCellStyle}>
                    {/* 整卡可点（缩略图 + 标题），button 保证键盘可达；
                        hover/focus 高亮见 index.css 的 .gs-scene-card */}
                    <button
                      type="button"
                      className="gs-scene-card"
                      data-scene-id={scene.id}
                      title={`在单场景中设计「${scene.title}」`}
                      onClick={() => openSceneInDesign(scene)}
                    >
                      <div style={{ ...gridStageBoxStyle, aspectRatio: `${stage.width} / ${stage.height}` }}>
                        <SceneFixtureView project={displayProject} renderer={renderer} scene={scene} />
                      </div>
                      <span style={gridCaptionStyle}>{scene.title}</span>
                    </button>
                  </figure>
                ))}
              </div>
            </div>
          ) : activeScene ? (
            <StageDesignView
              key={activeScene.id}
              project={displayProject}
              renderer={renderer}
              scene={activeScene}
              stage={stage}
              skinId={skinId}
              onPersistGeometry={handlePersistGeometry}
              onSelectionChange={setSelectedPart}
            />
          ) : null}
        </div>
      </div>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}

const rootStyle: React.CSSProperties = {
  position: "relative",
  display: "grid",
  // 检查器模式：画布（预览）为主居左，属性面板居右（设计工具惯例）
  gridTemplateColumns: "minmax(0, 1fr) minmax(260px, 320px)",
  // 行轨道必须封顶在容器高度：隐式 auto 行会被宫格内容撑得比视口高，
  // 再被下面的 overflow:hidden 裁掉，导致宫格永远滚不动（底部场景被切掉）。
  gridTemplateRows: "minmax(0, 1fr)",
  width: "100%",
  height: "100%",
  minWidth: 0,
  overflow: "hidden",
  background: "var(--bg-inset)",
};

const panelColumnStyle: React.CSSProperties = {
  // 显式行位：DOM 顺序是面板（列 2）在前、预览（列 1）在后，只靠 gridColumn
  // 时自动放置光标「列回退则行 +1」，预览会被挤到第二行（grid 规范行为）
  gridColumn: 2,
  gridRow: 1,
  minHeight: 0,
  overflowY: "auto",
  borderLeft: "1px solid var(--border)",
  background: "var(--bg-panel)",
};

const previewColumnStyle: React.CSSProperties = {
  gridColumn: 1,
  gridRow: 1,
  minWidth: 0,
  // grid item 默认 min-height:auto 会按宫格内容撑开自身，必须显式归零，
  // 下面的 flex:1（previewMount）→ height:100% + overflow:auto（gridScroll）
  // 高度链才有界，长场景列表才能在列内滚动。
  minHeight: 0,
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

const previewMountStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
};

const gridScrollStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  overflow: "auto",
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
  gap: "var(--space-3)",
  padding: "var(--space-3)",
};

const gridCellStyle: React.CSSProperties = {
  margin: 0,
  minWidth: 0,
};

const gridStageBoxStyle: React.CSSProperties = {
  width: "100%",
  borderRadius: "var(--radius-md)",
  overflow: "hidden",
  border: "1px solid var(--border)",
};

const gridCaptionStyle: React.CSSProperties = {
  // 卡片标题渲染为 button 内的 span（figcaption 不能嵌在交互元素里），需显式块级
  display: "block",
  marginTop: "var(--space-1)",
  fontSize: "var(--text-sm)",
  color: "var(--text-secondary)",
  textAlign: "center",
};

const skinHeaderStyle: React.CSSProperties = {
  padding: "var(--space-2) var(--space-3)",
  borderBottom: "1px solid var(--border)",
  fontSize: "var(--text-sm)",
  color: "var(--text-secondary)",
};

const selectionBarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--space-2)",
  padding: "var(--space-2) var(--space-3)",
  borderBottom: "1px solid var(--border)",
  background: "var(--bg-tag-accent, rgba(120, 160, 255, 0.08))",
  fontSize: "var(--text-sm)",
  color: "var(--text-secondary)",
};

const selectionLabelStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const selectionPartStyle: React.CSSProperties = {
  color: "var(--accent-bright)",
  fontWeight: 600,
  fontFamily: "ui-monospace, monospace",
};

const selectionClearStyle: React.CSSProperties = {
  flex: "0 0 auto",
  padding: "2px var(--space-2)",
  borderRadius: "var(--radius-pill)",
  border: "1px solid var(--border-strong)",
  background: "transparent",
  color: "var(--text-secondary)",
  fontSize: "var(--text-xs)",
  cursor: "pointer",
};

const hierarchyNoteStyle: React.CSSProperties = {
  marginBottom: "var(--space-1)",
  fontSize: "var(--text-xs)",
  color: "var(--text-muted)",
  lineHeight: 1.5,
};

const skinTitleStyle: React.CSSProperties = {
  color: "var(--text-primary)",
  fontWeight: 600,
};

const conflictBannerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  margin: "var(--space-3)",
  padding: "var(--space-2) var(--space-3)",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border-warn)",
  background: "var(--bg-tag-warn)",
};

const conflictTextStyle: React.CSSProperties = {
  flex: 1,
  fontSize: "var(--text-sm)",
  color: "var(--status-warn-text)",
  lineHeight: 1.5,
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
