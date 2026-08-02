/**
 * Workspace —— 打开项目后的工作台。
 *
 * 顶部：项目名 + 界面风格选择器 + 返回
 * 内容区：预览 / 剧情 / 资产 / 项目 / 外观 / 导出
 *
 * Spec 19（创作者词汇与预览/外观信息架构）：
 * - tab「渲染」→「预览」（workspace id `render` 不变）；
 * - 预览左栏的渲染层侧栏整体移除，顶栏「界面风格」选择器是唯一切换入口；
 *   新建/复制/重命名/删除不再由 Studio UI 暴露（后端 Tauri command 保留，
 *   界面风格由外部 AI 在 renderers/ 下生成、watcher 自动发现）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Bot, ChevronLeft, ChevronRight, Settings as SettingsIcon } from "lucide-react";
import type {
  GraphIssueFocusRequest,
  ProjectChangedPayload,
  ProjectData,
  ProjectGraph,
} from "./lib/types";
import { Preview } from "./features/preview/Preview";
import { ScriptWorkspace } from "./features/script/ScriptWorkspace";
import { AssetsWorkspace } from "./features/assets/AssetsWorkspace";
import { AppearanceWorkspace } from "./features/appearance/AppearanceWorkspace";
import { ExportWorkspace } from "./features/export/ExportWorkspace";
import { ProjectSettings } from "./features/project/ProjectSettings";
import { StatusPanel } from "./features/common/StatusPanel";
import { IconButton } from "./features/common/Button";
import { CommandPalette, type CommandItem } from "./features/common/CommandPalette";
import { ShortcutsHelpDialog, isShortcutsHelpToggle } from "./features/common/ShortcutsHelpDialog";
import { isEditableEventTarget } from "./features/script/graphShortcuts";
import { collectDanglingExperienceIssues, collectStoryStateIssues } from "./features/script/storyStateIssues";
import { ConfirmDialog } from "./features/common/Dialogs";
import {
  analyzeProject,
  openProject,
  saveProjectMeta,
  unwatchProject,
  watchProject,
} from "./lib/tauri";
import { clearRendererCache } from "./features/renderers/rendererLoader";
import { sameLocation, workspaceFromLocation, type NavigationLocation } from "./lib/navigation";
import { loadSidebarPrefs, saveSidebarPrefs, type SidebarPrefKey, type SidebarPrefs } from "./lib/sidebarPrefs";
import { RevisionedProjectMutationQueue } from "./lib/projectMutation";
import { getDesktopPlatform } from "./lib/platform";
import { BlankProjectGuide } from "./features/onboarding/BlankProjectGuide";
import { clearProjectNodeCache, loadAllProjectNodes, useAllProjectNodes, useNodeDetail } from "./lib/projectNodeData";
import { clearAssetThumbnailCache } from "./features/assets/AssetImagePreview";
import { useStudioI18n, type StudioTranslator } from "./lib/i18n";
import {
  INITIAL_BLANK_PROJECT_ONBOARDING,
  hasImportedBackground,
  hasWrittenBlankProjectEntry,
  loadBlankProjectOnboarding,
  saveBlankProjectOnboarding,
  type BlankProjectOnboardingRecord,
} from "./lib/blankProjectOnboarding";

interface Props {
  project: ProjectData;
  blankProjectGuideActive?: boolean;
  onBlankProjectGuideDismissed?: () => void;
  location: Exclude<NavigationLocation, { type: "project-list" } | { type: "settings" }>;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onNavigate: (next: NavigationLocation) => void;
  onReplaceLocation: (next: NavigationLocation) => void;
  /** 项目被刷新后（编辑保存触发）通知上层更新 */
  onProjectChanged: (p: ProjectData) => void;
  onOpenSettings: () => void;
}

type SyncState = "synced" | "syncing" | "error";
type WindowDragMouseEvent = Pick<React.MouseEvent<HTMLElement>, "button" | "target">;

export function graphFocusTargetFromIssue(
  issue: { source?: string; nodeId?: string; edgeId?: string; file?: string; jsonPath?: string },
  requestId: number,
  graph?: Pick<ProjectGraph, "nodes"> | null,
): GraphIssueFocusRequest | null {
  if (issue.source === "node") {
    const nodeId = issue.nodeId ?? nodeIdFromIssueFile(issue.file, graph);
    return nodeId ? { requestId, nodeId, jsonPath: issue.jsonPath } : null;
  }
  // 故事状态问题既可能落在某条分流（边）上，也可能落在改变它的指令上。
  if (issue.source === "variables") {
    if (issue.edgeId) return { requestId, edgeId: issue.edgeId };
    const nodeId = issue.nodeId ?? nodeIdFromIssueFile(issue.file, graph);
    return nodeId ? { requestId, nodeId, jsonPath: issue.jsonPath } : null;
  }
  if (issue.source !== "graph") return null;
  if (issue.nodeId) return { requestId, nodeId: issue.nodeId };
  if (issue.edgeId) return { requestId, edgeId: issue.edgeId };
  return null;
}

function nodeIdFromIssueFile(file: string | undefined, graph?: Pick<ProjectGraph, "nodes"> | null): string | null {
  if (!file || !graph) return null;
  const normalized = file.replace(/\\/g, "/").replace(/^content\//, "");
  return graph.nodes.find((node) => node.file.replace(/\\/g, "/") === normalized)?.id ?? null;
}

/**
 * 顶栏显示的名字 —— 作品名的唯一来源是 content/meta.json 的 title。
 * 未填标题时才回退到项目文件夹标识，避免同一个项目在三个地方显示三个名字。
 */
export function workspaceTitle(project: Pick<ProjectData, "meta" | "content">): string {
  const title = (project.content?.meta as { title?: unknown } | undefined)?.title;
  return typeof title === "string" && title.trim() !== "" ? title : project.meta.name;
}

export function workTitleTooltip(
  project: Pick<ProjectData, "meta" | "content">,
  t?: StudioTranslator,
): string {
  const title = workspaceTitle(project);
  if (t) {
    return title === project.meta.name
      ? t("workspace.title.missing", { title })
      : t("workspace.title.folder", { title, folder: project.meta.name });
  }
  return title === project.meta.name
    ? `${title}（还没填作品标题，先用项目文件夹名；在「项目」里填写）`
    : `${title}（项目文件夹：${project.meta.name}）`;
}

export function projectIssueSourceLabel(source: string, t?: StudioTranslator): string {
  if (t) {
    if (source === "graph") return t("workspace.issue.graph");
    if (source === "node") return t("workspace.issue.node");
    if (source === "asset") return t("workspace.issue.asset");
    if (source === "variables") return t("workspace.issue.variables");
    if (source === "meta") return t("workspace.issue.meta");
    if (source === "manifest") return t("workspace.issue.manifest");
    return source;
  }
  if (source === "graph") return "图结构";
  if (source === "node") return "节点内容";
  if (source === "asset") return "资产";
  if (source === "variables") return "故事状态";
  if (source === "meta") return "项目设置";
  if (source === "manifest") return "资源登记表";
  return source;
}

const windowDragIgnoreSelector = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "[role='button']",
  "[data-window-drag='ignore']",
].join(",");

export function Workspace({
  project,
  blankProjectGuideActive = false,
  onBlankProjectGuideDismissed,
  location,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onNavigate,
  onReplaceLocation,
  onProjectChanged,
  onOpenSettings,
}: Props) {
  const { t } = useStudioI18n();
  const [rendererId, setRendererId] = useState(project.meta.activeRendererId);
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastProjectChange, setLastProjectChange] = useState<ProjectChangedPayload | null>(null);
  const refreshRequestRef = useRef(0);
  const [projectGeneration, setProjectGeneration] = useState(0);
  const [fullReport, setFullReport] = useState(project.analysisComplete ? project.projectReport ?? null : null);
  const [analysisEntries, setAnalysisEntries] = useState<NonNullable<ProjectData["nodes"]>>(
    project.analysisComplete ? project.nodes ?? [] : [],
  );
  const [analysisState, setAnalysisState] = useState<"idle" | "loading" | "ready" | "error">(
    project.analysisComplete ? "ready" : "idle",
  );
  const [syncState, setSyncState] = useState<SyncState>("synced");
  const [sidebarPrefs, setSidebarPrefs] = useState(loadSidebarPrefs);
  const [graphIssueFocus, setGraphIssueFocus] = useState<GraphIssueFocusRequest | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [unsavedNavigation, setUnsavedNavigation] = useState<{ action: () => void } | null>(null);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [blankProjectGuide, setBlankProjectGuide] = useState<BlankProjectOnboardingRecord>(() => (
    loadBlankProjectOnboarding(project.path) ?? INITIAL_BLANK_PROJECT_ONBOARDING
  ));
  const graphIssueFocusRequestIdRef = useRef(0);
  const projectDataEpochRef = useRef(0);
  const projectMetaMutationQueue = useMemo(
    () => new RevisionedProjectMutationQueue(project.projectRevision),
    [project.path],
  );
  const rendererIdsKey = useMemo(() => project.rendererIds.join("\x00"), [project.rendererIds]);
  const workspace = workspaceFromLocation(location) ?? "render";
  const needsFullNodeData = workspace === "render" || workspace === "assets";
  const allNodeData = useAllProjectNodes(project, projectGeneration, needsFullNodeData);
  const projectWithFullNodes = useMemo(
    () => needsFullNodeData && !allNodeData.loading && !allNodeData.error
      ? { ...project, nodes: allNodeData.entries }
      : project,
    [allNodeData.entries, allNodeData.error, allNodeData.loading, needsFullNodeData, project],
  );
  const blankEntryPath = blankProjectGuideActive
    ? project.graph?.nodes.find((node) => node.id === project.graph?.entryNodeId)?.file ?? null
    : null;
  const blankEntryDetail = useNodeDetail(project, blankEntryPath, projectGeneration);
  const projectForBlankGuide = useMemo(
    () => blankEntryDetail.detail
      ? { ...project, nodes: [{ relPath: blankEntryDetail.detail.relPath, data: blankEntryDetail.detail.data }] }
      : project,
    [blankEntryDetail.detail, project],
  );

  useEffect(() => {
    refreshRequestRef.current += 1;
    setHasUnsavedChanges(false);
    setUnsavedNavigation(null);
    setBlankProjectGuide(loadBlankProjectOnboarding(project.path) ?? INITIAL_BLANK_PROJECT_ONBOARDING);
    setFullReport(project.analysisComplete ? project.projectReport ?? null : null);
    setAnalysisEntries(project.analysisComplete ? project.nodes ?? [] : []);
    setAnalysisState(project.analysisComplete ? "ready" : "idle");
    projectDataEpochRef.current += 1;
    setProjectGeneration((generation) => generation + 1);
  }, [project.path]);

  useEffect(() => {
    projectMetaMutationQueue.synchronizeRevision(project.projectRevision);
  }, [project.projectRevision, projectMetaMutationQueue]);

  const saveProjectMetaQueued = useCallback((meta: ProjectData["meta"]) => (
    projectMetaMutationQueue.enqueue((expectedRevision) => (
      saveProjectMeta(project.path, meta, expectedRevision)
    ))
  ), [project.path, projectMetaMutationQueue]);

  const runWithUnsavedChangesGuard = useCallback((action: () => void) => {
    if (!shouldConfirmUnsavedNavigation(hasUnsavedChanges)) {
      action();
      return;
    }
    setUnsavedNavigation({ action });
  }, [hasUnsavedChanges]);

  const navigateWithGuard = useCallback((next: NavigationLocation) => {
    if (sameLocation(location, next)) return;
    runWithUnsavedChangesGuard(() => onNavigate(next));
  }, [location, onNavigate, runWithUnsavedChangesGuard]);

  const replaceLocationWithGuard = useCallback((next: NavigationLocation) => {
    runWithUnsavedChangesGuard(() => onReplaceLocation(next));
  }, [onReplaceLocation, runWithUnsavedChangesGuard]);

  const handleSidebarCollapsedChange = useCallback((key: SidebarPrefKey, collapsed: boolean) => {
    setSidebarPrefs((current) => {
      const next: SidebarPrefs = { ...current, [key]: collapsed };
      return saveSidebarPrefs(next);
    });
  }, []);
  const handleAssetsSidebarCollapsedChange = useCallback((collapsed: boolean) => {
    handleSidebarCollapsedChange("assetsSidebarCollapsed", collapsed);
  }, [handleSidebarCollapsedChange]);
  const handleScriptOutlineCollapsedChange = useCallback((collapsed: boolean) => {
    handleSidebarCollapsedChange("scriptOutlineCollapsed", collapsed);
  }, [handleSidebarCollapsedChange]);

  // 切换界面风格（渲染层）：更新本地 + 持久化到 gal.project.json
  const handleRendererChange = useCallback(async (id: string) => {
    if (!id || id === rendererId) return;
    setRendererId(id);
    try {
      await saveProjectMetaQueued({ ...project.meta, activeRendererId: id });
    } catch (e) {
      console.warn("持久化界面风格失败:", e);
    }
  }, [project.meta, rendererId, saveProjectMetaQueued]);

  const refreshProject = useCallback(async (rendererChanged = false) => {
    const requestId = refreshRequestRef.current + 1;
    refreshRequestRef.current = requestId;
    const refreshingPath = project.path;
    setSyncState("syncing");
    projectDataEpochRef.current += 1;
    setProjectGeneration((generation) => generation + 1);
    clearProjectNodeCache(project.path);
    clearAssetThumbnailCache(project.path);
    setFullReport(null);
    setAnalysisEntries([]);
    setAnalysisState("idle");
    try {
      if (rendererChanged) {
        clearRendererCache();
      }
      const fresh = await openProject(refreshingPath);
      if (refreshRequestRef.current !== requestId || fresh.path !== refreshingPath) return;
      onProjectChanged(fresh);
      setRefreshKey((k) => k + 1);
      setSyncState("synced");
    } catch (e) {
      if (refreshRequestRef.current !== requestId) return;
      console.warn("刷新项目失败:", e);
      setSyncState("error");
    }
  }, [project.path, onProjectChanged]);

  useEffect(() => {
    const preferred = project.rendererIds.includes(project.meta.activeRendererId)
      ? project.meta.activeRendererId
      : project.rendererIds[0] ?? "";
    setRendererId(preferred);
  }, [project.meta.activeRendererId, rendererIdsKey, project.rendererIds]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    const setup = async () => {
      try {
        const stopListening = await listen<ProjectChangedPayload>("project_changed", (event) => {
          if (disposed || event.payload.projectPath !== project.path) return;
          setLastProjectChange(event.payload);
          setSyncState("syncing");
          void refreshProject(event.payload.rendererChanged);
        });
        if (disposed) {
          stopListening();
          return;
        }
        unlisten = stopListening;
        await watchProject(project.path);
      } catch (e) {
        console.warn("启动项目热重载失败:", e);
      }
    };

    void setup();
    return () => {
      disposed = true;
      unlisten?.();
      void unwatchProject(project.path);
    };
  }, [project.path, refreshProject]);

  // 编辑器保存后：重新打开项目拿最新数据，触发预览刷新
  const handleSaved = useCallback(async () => {
    await refreshProject(false);
  }, [refreshProject]);

  const guideWritten = hasWrittenBlankProjectEntry(projectForBlankGuide);
  const guideBackgroundImported = hasImportedBackground(project);
  const guideVisible = blankProjectGuideActive
    && !blankProjectGuide.skipped
    && !blankProjectGuide.completed;

  const updateBlankProjectGuide = useCallback((
    update: (current: BlankProjectOnboardingRecord) => BlankProjectOnboardingRecord,
  ) => {
    setBlankProjectGuide((current) => {
      const next = update(current);
      saveBlankProjectOnboarding(project.path, next);
      return next;
    });
  }, [project.path]);

  useEffect(() => {
    if (!blankProjectGuideActive) return;
    if (!blankProjectGuide.skipped && !blankProjectGuide.completed) return;
    onBlankProjectGuideDismissed?.();
  }, [
    blankProjectGuide.completed,
    blankProjectGuide.skipped,
    blankProjectGuideActive,
    onBlankProjectGuideDismissed,
  ]);

  useEffect(() => {
    if (!blankProjectGuideActive || blankProjectGuide.completed || blankProjectGuide.skipped) return;
    if (!guideWritten || !guideBackgroundImported || !blankProjectGuide.previewConfirmed) return;
    updateBlankProjectGuide((current) => ({ ...current, completed: true }));
    onBlankProjectGuideDismissed?.();
  }, [
    blankProjectGuide.completed,
    blankProjectGuide.previewConfirmed,
    blankProjectGuide.skipped,
    blankProjectGuideActive,
    guideBackgroundImported,
    guideWritten,
    onBlankProjectGuideDismissed,
    updateBlankProjectGuide,
  ]);

  const skipBlankProjectGuide = useCallback(() => {
    updateBlankProjectGuide((current) => ({ ...current, skipped: true }));
    onBlankProjectGuideDismissed?.();
  }, [onBlankProjectGuideDismissed, updateBlankProjectGuide]);

  const confirmGuidePreview = useCallback(() => {
    updateBlankProjectGuide((current) => ({ ...current, previewConfirmed: true }));
    navigateWithGuard({ type: "workspace", workspace: "render" });
  }, [navigateWithGuard, updateBlankProjectGuide]);

  const handleTitleBarMouseDown = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (!shouldStartWindowDrag(event)) return;

    void getCurrentWindow().startDragging().catch((e) => {
      console.warn("启动窗口拖拽失败:", e);
    });
  }, []);

  const backendReport = fullReport ?? project.projectReport ?? { projectIssues: [] };
  const report = useMemo(() => ({
    ...backendReport,
    projectIssues: fullReport
      ? [
          ...backendReport.projectIssues,
          ...collectStoryStateIssues({
            graph: project.graph,
            nodes: analysisEntries,
            registry: project.content.variables,
            manifest: project.content.manifest,
            t,
          }),
          ...collectDanglingExperienceIssues(project.graph, analysisEntries, t),
        ]
      : backendReport.projectIssues,
  }), [analysisEntries, backendReport, fullReport, project.graph, project.content.variables, project.content.manifest, t]);

  const ensureFullAnalysis = useCallback(async () => {
    if (analysisState === "loading" || fullReport) return;
    const generation = projectGeneration;
    const epoch = projectDataEpochRef.current;
    setAnalysisState("loading");
    try {
      const [analysis, entries] = await Promise.all([
        analyzeProject(project.path),
        loadAllProjectNodes(project, generation),
      ]);
      if (epoch !== projectDataEpochRef.current) return;
      setFullReport(analysis.projectReport);
      setAnalysisEntries(entries);
      setAnalysisState("ready");
      if (entries.length === 0 && (project.graph?.nodes.length ?? 0) > 0) {
        console.warn("完整分析没有返回节点正文");
      }
    } catch (error) {
      if (epoch !== projectDataEpochRef.current) return;
      console.warn("完整项目分析失败:", error);
      setAnalysisState("error");
    }
  }, [analysisState, fullReport, project, projectGeneration]);

  const handleProjectIssueClick = useCallback((issue: { source?: string; nodeId?: string; edgeId?: string; file?: string; jsonPath?: string }) => {
    const next = graphFocusTargetFromIssue(issue, graphIssueFocusRequestIdRef.current + 1, project.graph);
    if (!next) return;
    graphIssueFocusRequestIdRef.current = next.requestId;
    setGraphIssueFocus(next);
    if (issue.source === "node" && next.nodeId) {
      navigateWithGuard({ type: "script-node", nodeId: next.nodeId });
    } else {
      navigateWithGuard({ type: "script-graph" });
    }
  }, [navigateWithGuard, project.graph]);

  // 命令面板内容：工作台切换 + 节点跳转，都复用带未保存守卫的导航
  const commandItems = useMemo<CommandItem[]>(() => {
    const workspaceItems: CommandItem[] = [
      { id: "ws-render", label: t("workspace.command.render"), hint: t("workspace.switch"), keywords: "render preview", onSelect: () => navigateWithGuard({ type: "workspace", workspace: "render" }) },
      { id: "ws-script", label: t("workspace.command.script"), hint: t("workspace.switch"), keywords: "script graph", onSelect: () => navigateWithGuard({ type: "script-graph" }) },
      { id: "ws-assets", label: t("workspace.command.assets"), hint: t("workspace.switch"), keywords: "assets", onSelect: () => navigateWithGuard({ type: "workspace", workspace: "assets" }) },
      { id: "ws-project", label: t("workspace.command.project"), hint: t("workspace.switch"), keywords: "project settings", onSelect: () => navigateWithGuard({ type: "workspace", workspace: "project" }) },
      { id: "ws-appearance", label: t("workspace.command.appearance"), hint: t("workspace.switch"), keywords: "appearance design ui skin", onSelect: () => navigateWithGuard({ type: "workspace", workspace: "appearance" }) },
      { id: "ws-export", label: t("workspace.command.export"), hint: t("workspace.switch"), keywords: "export build desktop electron tauri release", onSelect: () => navigateWithGuard({ type: "workspace", workspace: "export" }) },
    ];
    const nodeItems: CommandItem[] = (project.graph?.nodes ?? []).map((node) => ({
      id: `node-${node.id}`,
      label: t("workspace.command.node", { title: node.title || node.id }),
      hint: node.id,
      keywords: `${node.id} ${node.title}`,
      onSelect: () => navigateWithGuard({ type: "script-node", nodeId: node.id }),
    }));
    return [...workspaceItems, ...nodeItems];
  }, [project.graph, navigateWithGuard, t]);

  // 全局快捷键：Ctrl/Cmd+K 命令面板，? 快捷键帮助。
  // 其他弹窗打开时不响应 ? 以免层叠；面板打开时焦点在其输入框（editable），? 天然不触发。
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setShortcutsHelpOpen(false);
        setPaletteOpen((open) => !open);
        return;
      }
      if (
        isShortcutsHelpToggle({
          key: event.key,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
          targetIsEditable: isEditableEventTarget(event.target),
        })
      ) {
        if (unsavedNavigation || paletteOpen) return;
        setShortcutsHelpOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [unsavedNavigation, paletteOpen]);

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", width: "100%", height: "100%" }}>
      {/* 标题栏（自定义拖拽区，整行可拖动窗口） */}
      <header data-tauri-drag-region onMouseDown={handleTitleBarMouseDown} style={titleBarStyle}>
        {/* 左侧：返回 / 前进（紧邻红绿灯右侧，padding-left 已为红绿灯留出避让） */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", flexShrink: 0 }}>
          <IconButton onClick={() => runWithUnsavedChangesGuard(onBack)} disabled={!canGoBack} title={t("nav.back")} aria-label={t("nav.back")}>
            <ChevronLeft size={18} />
          </IconButton>
          <IconButton onClick={() => runWithUnsavedChangesGuard(onForward)} disabled={!canGoForward} title={t("nav.forward")} aria-label={t("nav.forward")}>
            <ChevronRight size={18} />
          </IconButton>
          <span className="gs-workspace-title" style={projectNameStyle} title={workTitleTooltip(project, t)}>{workspaceTitle(project)}</span>
        </div>

        {/* 中间：工作台切换；参与同一行布局，避免与右侧项目控件重叠 */}
        <div data-tauri-drag-region style={centerGroupStyle}>
          <TabBtn active={workspace === "render"} onClick={() => navigateWithGuard({ type: "workspace", workspace: "render" })}>{t("workspace.render")}</TabBtn>
          <TabBtn active={workspace === "script"} onClick={() => navigateWithGuard({ type: "script-graph" })}>{t("workspace.script")}</TabBtn>
          <TabBtn active={workspace === "assets"} onClick={() => navigateWithGuard({ type: "workspace", workspace: "assets" })}>{t("workspace.assets")}</TabBtn>
          <TabBtn active={workspace === "project"} onClick={() => navigateWithGuard({ type: "workspace", workspace: "project" })}>{t("workspace.project")}</TabBtn>
          <TabBtn active={workspace === "appearance"} onClick={() => navigateWithGuard({ type: "workspace", workspace: "appearance" })}>{t("workspace.appearance")}</TabBtn>
          <TabBtn active={workspace === "export"} onClick={() => navigateWithGuard({ type: "workspace", workspace: "export" })}>{t("workspace.export")}</TabBtn>
        </div>

        {/* 右侧：同步指示器 + 界面风格选择器（渲染层唯一切换入口，Spec 19 §4.2） */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "var(--space-2)", flexShrink: 0 }}>
          <SyncIndicator state={syncState} onRetry={() => void refreshProject(false)} />
          <span className="gs-workspace-style-label" style={rendererLabelStyle} title={t("workspace.renderer.guidance")}>{t("workspace.renderer.label")}</span>
          {project.rendererIds.length > 0 ? (
            <select
              aria-label={t("workspace.renderer.label")}
              title={t("workspace.renderer.guidance")}
              style={rendererSelectStyle}
              value={rendererId}
              onChange={(event) => void handleRendererChange(event.target.value)}
            >
              {project.rendererIds.map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
          ) : (
            <span style={rendererEmptyStyle}>{t("workspace.renderer.empty", { guidance: t("workspace.renderer.guidance") })}</span>
          )}
          <IconButton onClick={() => navigateWithGuard({ type: "agent" })} title={t("agent.title")} aria-label={t("agent.title")}>
            <Bot size={15} />
          </IconButton>
          <IconButton onClick={() => runWithUnsavedChangesGuard(onOpenSettings)} title={t("nav.settings")} aria-label={t("nav.settings")}>
            <SettingsIcon size={15} />
          </IconButton>
        </div>
      </header>

      {/* 内容区：key 绑定工作台标识，切换标签时整体重挂载并淡入 */}
      <div key={workspace} className="gs-anim-fade" style={{ flex: 1, overflow: "hidden" }}>
        {workspace === "render" && (
          <div style={renderWorkspaceStyle}>
            <Preview
              key={`${rendererId}-${refreshKey}`}
              project={projectWithFullNodes}
              loadingContent={allNodeData.loading}
              rendererId={rendererId}
              onOpenNode={(nodeId, instructionIndex) => {
                // 剧情检查里点「在某节点改变了它」→ 切到剧情并聚焦那一条指令。
                if (instructionIndex != null) {
                  graphIssueFocusRequestIdRef.current += 1;
                  setGraphIssueFocus({
                    requestId: graphIssueFocusRequestIdRef.current,
                    nodeId,
                    jsonPath: `$[${instructionIndex}]`,
                  });
                }
                navigateWithGuard({ type: "script-node", nodeId });
              }}
              onSelectEdge={(edgeId) => {
                graphIssueFocusRequestIdRef.current += 1;
                setGraphIssueFocus({ requestId: graphIssueFocusRequestIdRef.current, edgeId });
                navigateWithGuard({ type: "script-graph" });
              }}
            />
          </div>
        )}
        {workspace === "script" && (
          <ScriptWorkspace
            key={project.path}
            project={project}
            rendererId={rendererId}
            refreshKey={refreshKey}
            lastProjectChange={lastProjectChange}
            outlineCollapsed={sidebarPrefs.scriptOutlineCollapsed}
            onOutlineCollapsedChange={handleScriptOutlineCollapsedChange}
            location={location.type === "script-node" ? { view: "node", nodeId: location.nodeId } : { view: "graph" }}
            focusRequest={graphIssueFocus}
            onOpenGraph={() => navigateWithGuard({ type: "script-graph" })}
            onOpenNode={(nodeId) => navigateWithGuard({ type: "script-node", nodeId })}
            onReplaceWithGraph={() => replaceLocationWithGuard({ type: "script-graph" })}
            onSaved={handleSaved}
            onDirtyChange={setHasUnsavedChanges}
            onOpenShortcutsHelp={() => setShortcutsHelpOpen(true)}
          />
        )}
        {workspace === "assets" && (
          <AssetsWorkspace
            key={`${project.path}-${guideVisible && !guideBackgroundImported ? "guide-background" : "default"}`}
            project={projectWithFullNodes}
            refreshKey={refreshKey}
            initialSection={guideVisible && !guideBackgroundImported ? "background" : "overview"}
            sidebarCollapsed={sidebarPrefs.assetsSidebarCollapsed}
            onSidebarCollapsedChange={handleAssetsSidebarCollapsedChange}
            onSaved={handleSaved}
            onDirtyChange={setHasUnsavedChanges}
          />
        )}
        {workspace === "project" && (
          <ProjectSettings
            key={project.path}
            project={project}
            onSaved={handleSaved}
            onDirtyChange={setHasUnsavedChanges}
          />
        )}
        {workspace === "appearance" && (
          <AppearanceWorkspace
            key={project.path}
            project={project}
            rendererId={rendererId}
            onSaved={handleSaved}
          />
        )}
        {workspace === "export" && (
          <ExportWorkspace
            key={project.path}
            project={project}
            hasUnsavedChanges={hasUnsavedChanges}
          />
        )}
      </div>

      {guideVisible && (
        <BlankProjectGuide
          written={guideWritten}
          backgroundImported={guideBackgroundImported}
          previewConfirmed={blankProjectGuide.previewConfirmed}
          onWrite={() => {
            const entryNodeId = project.graph?.entryNodeId;
            navigateWithGuard(entryNodeId
              ? { type: "script-node", nodeId: entryNodeId }
              : { type: "script-graph" });
          }}
          onImportBackground={() => navigateWithGuard({ type: "workspace", workspace: "assets" })}
          onPreview={confirmGuidePreview}
          onSkip={skipBlankProjectGuide}
        />
      )}

      {/* 全局状态指示器：汇总图结构 + 资产 + manifest 三类问题。
          未分析=中性灰（不亮绿灯），绿勾=全项目无问题，红图标=有某处问题，点开按来源分组。 */}
      <StatusPanel
        issues={report.projectIssues}
        loading={analysisState === "loading"}
        error={analysisState === "error"}
        onOpen={() => void ensureFullAnalysis()}
        okLabel={t("workspace.normal")}
        neutralLabel={analysisState === "idle" && fullReport === null ? t("status.notAnalyzed") : undefined}
        notOkLabel={(n) => t("workspace.issueCount", { count: n })}
        dialogTitle={t("workspace.projectIssues")}
        dialogAriaLabel={t("workspace.projectIssues")}
        emptyDescription={t("workspace.normal")}
        sourceLabel={(source) => projectIssueSourceLabel(source, t)}
        issueExtra={(issue) =>
          issue.source === "graph" || issue.source === "node"
            ? issue.nodeId
              ? `node ${issue.nodeId}`
              : issue.edgeId
                ? `edge ${issue.edgeId}`
                : null
            : null
        }
        isIssueClickable={(issue) => Boolean(graphFocusTargetFromIssue(issue, 0, project.graph))}
        onIssueClick={handleProjectIssueClick}
      />

      {paletteOpen && <CommandPalette items={commandItems} onClose={() => setPaletteOpen(false)} />}
      {shortcutsHelpOpen && <ShortcutsHelpDialog onClose={() => setShortcutsHelpOpen(false)} />}
      {unsavedNavigation && (
        <ConfirmDialog
          message={t("workspace.unsaved.message")}
          confirmLabel={t("workspace.unsaved.leave")}
          onConfirm={() => {
            const action = unsavedNavigation.action;
            setHasUnsavedChanges(false);
            setUnsavedNavigation(null);
            action();
          }}
          onClose={() => setUnsavedNavigation(null)}
        />
      )}
    </div>
  );
}

export function shouldStartWindowDrag(event: WindowDragMouseEvent): boolean {
  if (event.button !== 0) return false;

  const target = event.target;
  if (!target || !hasClosest(target)) return true;
  return target.closest(windowDragIgnoreSelector) === null;
}

export function shouldConfirmUnsavedNavigation(hasUnsavedChanges: boolean): boolean {
  return hasUnsavedChanges;
}

function hasClosest(target: EventTarget): target is EventTarget & { closest: (selector: string) => Element | null } {
  return typeof (target as { closest?: unknown }).closest === "function";
}

function SyncIndicator({ state, onRetry }: { state: SyncState; onRetry: () => void }) {
  const { t } = useStudioI18n();
  const config = {
    synced: { label: t("workspace.sync.synced"), dot: "var(--status-ok)", cursor: "default" },
    syncing: { label: t("workspace.sync.syncing"), dot: "var(--status-warn)", cursor: "default" },
    error: { label: t("workspace.sync.error"), dot: "var(--status-error)", cursor: "pointer" },
  }[state];

  return (
    <button
      type="button"
      onClick={state === "error" ? onRetry : undefined}
      disabled={state !== "error"}
      style={{
        ...syncButtonStyle,
        cursor: config.cursor,
        color: state === "error" ? "var(--status-error-text)" : "var(--text-secondary)",
      }}
      title={state === "error" ? t("workspace.sync.retry") : undefined}
    >
      <span
        style={{
          ...syncDotStyle,
          background: config.dot,
          boxShadow: state === "syncing" ? "0 0 0 3px var(--status-warn-ring)" : undefined,
        }}
      />
      <span className="gs-workspace-sync-label">{config.label}</span>
    </button>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={active ? "gs-tab gs-tab--active" : "gs-tab"}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

const titleBarStyle: React.CSSProperties = {
  position: "relative",
  display: "flex",
  alignItems: "center",
  gap: "var(--space-3)",
  height: 38,
  // 左侧 88px 为 macOS 红绿灯避让（约 70px）+ 一点间距；
  // Windows/Linux 上 titleBarStyle 不生效（原生标题栏），无需避让
  padding: getDesktopPlatform() === "macos" ? "0 var(--space-3) 0 88px" : "0 var(--space-3)",
  borderBottom: "1px solid var(--border)",
  background: "var(--bg-app)",
};
const centerGroupStyle: React.CSSProperties = {
  display: "flex",
  gap: "var(--space-1)",
  marginLeft: "auto",
  flexShrink: 0,
};
const projectNameStyle: React.CSSProperties = {
  marginLeft: "var(--space-2)",
  fontSize: "var(--text-sm)",
  fontWeight: 600,
  color: "var(--text-muted)",
  maxWidth: 200,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const rendererLabelStyle: React.CSSProperties = {
  fontSize: "var(--text-sm)",
  color: "var(--text-muted)",
  whiteSpace: "nowrap",
  flexShrink: 0,
};
const rendererSelectStyle: React.CSSProperties = {
  maxWidth: 140,
  padding: "var(--space-1) var(--space-2)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-strong)",
  background: "var(--bg-panel)",
  color: "var(--text-primary)",
  fontSize: "var(--text-base)",
  flexShrink: 0,
};
const rendererEmptyStyle: React.CSSProperties = {
  maxWidth: 320,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: "var(--text-sm)",
  color: "var(--text-muted)",
};
const renderWorkspaceStyle: React.CSSProperties = {
  display: "flex",
  width: "100%",
  height: "100%",
  minWidth: 0,
  overflow: "hidden",
  background: "var(--bg-inset)",
};
const syncButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-1)",
  padding: "var(--space-1) var(--space-2)",
  borderRadius: "var(--radius-pill)",
  border: "1px solid var(--border-strong)",
  background: "var(--bg-panel)",
  fontSize: "var(--text-sm)",
  whiteSpace: "nowrap",
  flexShrink: 0,
};
const syncDotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: "var(--radius-pill)",
  flexShrink: 0,
};
