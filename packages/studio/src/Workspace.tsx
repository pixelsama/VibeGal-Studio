/**
 * Workspace —— 打开项目后的工作台。
 *
 * 顶部：项目名 + 渲染层状态 + 返回
 * 内容区：渲染 / 脚本 / 资产 / 项目
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ChevronLeft, ChevronRight, Settings as SettingsIcon } from "lucide-react";
import type { GraphIssueFocusRequest, ProjectData, ProjectGraph } from "./lib/types";
import { Preview } from "./features/preview/Preview";
import { ScriptWorkspace } from "./features/script/ScriptWorkspace";
import { AssetsWorkspace } from "./features/assets/AssetsWorkspace";
import { ProjectSettings } from "./features/project/ProjectSettings";
import { StatusPanel } from "./features/common/StatusPanel";
import { CollapsibleSidebar } from "./features/common/CollapsibleSidebar";
import { IconButton } from "./features/common/Button";
import { AlertDialog, ConfirmDialog, PromptDialog } from "./features/common/Dialogs";
import { RendererSidebar } from "./features/renderers/RendererSidebar";
import type { RendererDiagnostic } from "./features/renderers/diagnostics";
import {
  createRenderer,
  deleteRenderer,
  duplicateRenderer,
  openProject,
  renameRenderer,
  saveProjectMeta,
  unwatchProject,
  watchProject,
} from "./lib/tauri";
import { clearRendererCache } from "./features/renderers/rendererLoader";
import { clearRendererTrust } from "./features/renderers/rendererTrust";
import { sameLocation, workspaceFromLocation, type NavigationLocation } from "./lib/navigation";
import { loadSidebarPrefs, saveSidebarPrefs, type SidebarPrefKey, type SidebarPrefs } from "./lib/sidebarPrefs";
import { RevisionedProjectMutationQueue } from "./lib/projectMutation";
import { getDesktopPlatform } from "./lib/platform";

interface Props {
  project: ProjectData;
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

interface RendererPromptConfig {
  title: string;
  label: string;
  initialValue: string;
  confirmLabel?: string;
  allowUnchanged?: boolean;
  onConfirm: (value: string) => void;
}

interface ProjectChangedPayload {
  projectPath: string;
  rendererChanged: boolean;
}

export function graphFocusTargetFromIssue(
  issue: { source?: string; nodeId?: string; edgeId?: string; file?: string; jsonPath?: string },
  requestId: number,
  graph?: Pick<ProjectGraph, "nodes"> | null,
): GraphIssueFocusRequest | null {
  if (issue.source === "node") {
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

export function projectIssueSourceLabel(source: string): string {
  if (source === "graph") return "图结构";
  if (source === "node") return "节点内容";
  if (source === "asset") return "资产";
  if (source === "meta") return "项目设置";
  if (source === "manifest") return "manifest";
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
  const [rendererId, setRendererId] = useState(project.meta.activeRendererId);
  const [refreshKey, setRefreshKey] = useState(0);
  const [syncState, setSyncState] = useState<SyncState>("synced");
  const [sidebarPrefs, setSidebarPrefs] = useState(loadSidebarPrefs);
  const [graphIssueFocus, setGraphIssueFocus] = useState<GraphIssueFocusRequest | null>(null);
  const [rendererPrompt, setRendererPrompt] = useState<RendererPromptConfig | null>(null);
  const [rendererConfirm, setRendererConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [rendererAlert, setRendererAlert] = useState<string | null>(null);
  const [rendererDiagnostics, setRendererDiagnostics] = useState<RendererDiagnostic[]>([]);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [unsavedNavigation, setUnsavedNavigation] = useState<{ action: () => void } | null>(null);
  const graphIssueFocusRequestIdRef = useRef(0);
  const projectMetaMutationQueue = useMemo(
    () => new RevisionedProjectMutationQueue(project.projectRevision),
    [project.path],
  );
  const rendererIdsKey = useMemo(() => project.rendererIds.join("\0"), [project.rendererIds]);
  const workspace = workspaceFromLocation(location) ?? "render";

  useEffect(() => {
    setHasUnsavedChanges(false);
    setUnsavedNavigation(null);
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
  const handleRenderSidebarCollapsedChange = useCallback((collapsed: boolean) => {
    handleSidebarCollapsedChange("renderSidebarCollapsed", collapsed);
  }, [handleSidebarCollapsedChange]);
  const handleAssetsSidebarCollapsedChange = useCallback((collapsed: boolean) => {
    handleSidebarCollapsedChange("assetsSidebarCollapsed", collapsed);
  }, [handleSidebarCollapsedChange]);
  const handleScriptOutlineCollapsedChange = useCallback((collapsed: boolean) => {
    handleSidebarCollapsedChange("scriptOutlineCollapsed", collapsed);
  }, [handleSidebarCollapsedChange]);

  // 切换渲染层：更新本地 + 持久化到 gal.project.json
  const handleRendererChange = useCallback(async (id: string) => {
    setRendererId(id);
    try {
      await saveProjectMetaQueued({ ...project.meta, activeRendererId: id });
    } catch (e) {
      console.warn("持久化渲染层失败:", e);
    }
  }, [project.meta, saveProjectMetaQueued]);

  const refreshProject = useCallback(async (rendererChanged = false) => {
    setSyncState("syncing");
    try {
      if (rendererChanged) {
        clearRendererCache();
        clearRendererTrust(project.path);
      }
      const fresh = await openProject(project.path);
      onProjectChanged(fresh);
      setRefreshKey((k) => k + 1);
      setSyncState("synced");
    } catch (e) {
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

  const handleCreateRenderer = useCallback(() => {
    setRendererPrompt({
      title: "新建渲染层",
      label: "渲染层 id",
      initialValue: "renderer",
      confirmLabel: "新建",
      allowUnchanged: true,
      onConfirm: async (id) => {
        try {
          await createRenderer(project.path, id, "default");
          await saveProjectMetaQueued({ ...project.meta, activeRendererId: id });
          setRendererId(id);
          await refreshProject(true);
        } catch (error) {
          setRendererAlert(error instanceof Error ? error.message : String(error));
        }
      },
    });
  }, [project.meta, project.path, refreshProject, saveProjectMetaQueued]);

  const handleDuplicateRenderer = useCallback((sourceId: string) => {
    if (!sourceId) return;
    setRendererPrompt({
      title: "复制渲染层",
      label: "新渲染层 id",
      initialValue: `${sourceId}_copy`,
      confirmLabel: "复制",
      allowUnchanged: true,
      onConfirm: async (newId) => {
        try {
          await duplicateRenderer(project.path, sourceId, newId);
          await saveProjectMetaQueued({ ...project.meta, activeRendererId: newId });
          setRendererId(newId);
          await refreshProject(true);
        } catch (error) {
          setRendererAlert(error instanceof Error ? error.message : String(error));
        }
      },
    });
  }, [project.meta, project.path, refreshProject, saveProjectMetaQueued]);

  const handleRenameRenderer = useCallback((sourceId: string) => {
    if (!sourceId) return;
    setRendererPrompt({
      title: "重命名渲染层",
      label: "新渲染层 id",
      initialValue: sourceId,
      confirmLabel: "重命名",
      onConfirm: async (newId) => {
        if (newId === sourceId) return;
        try {
          await renameRenderer(project.path, sourceId, newId);
          if (rendererId === sourceId) setRendererId(newId);
          await refreshProject(true);
        } catch (error) {
          setRendererAlert(error instanceof Error ? error.message : String(error));
        }
      },
    });
  }, [project.path, refreshProject, rendererId]);

  const handleDeleteRenderer = useCallback((sourceId: string) => {
    if (!sourceId) return;
    setRendererConfirm({
      message: `确定删除渲染层 ${sourceId}？`,
      onConfirm: async () => {
        try {
          await deleteRenderer(project.path, sourceId);
          await refreshProject(true);
        } catch (error) {
          setRendererAlert(error instanceof Error ? error.message : String(error));
        }
      },
    });
  }, [project.path, refreshProject]);

  const handleTitleBarMouseDown = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (!shouldStartWindowDrag(event)) return;

    void getCurrentWindow().startDragging().catch((e) => {
      console.warn("启动窗口拖拽失败:", e);
    });
  }, []);

  const report = project.projectReport ?? { projectIssues: [] };
  const rendererStatusText = rendererId || "无渲染层";

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

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", width: "100%", height: "100%" }}>
      {/* 标题栏（自定义拖拽区，整行可拖动窗口） */}
      <header data-tauri-drag-region onMouseDown={handleTitleBarMouseDown} style={titleBarStyle}>
        {/* 左侧：返回 / 前进（紧邻红绿灯右侧，padding-left 已为红绿灯留出避让） */}
        <div style={{ display: "flex", gap: "var(--space-1)", flexShrink: 0 }}>
          <IconButton onClick={() => runWithUnsavedChangesGuard(onBack)} disabled={!canGoBack} title="后退" aria-label="后退">
            <ChevronLeft size={18} />
          </IconButton>
          <IconButton onClick={() => runWithUnsavedChangesGuard(onForward)} disabled={!canGoForward} title="前进" aria-label="前进">
            <ChevronRight size={18} />
          </IconButton>
        </div>

        {/* 居中：工作台切换，窗口水平绝对居中 */}
        <div data-tauri-drag-region style={centerGroupStyle}>
          <TabBtn active={workspace === "render"} onClick={() => navigateWithGuard({ type: "workspace", workspace: "render" })}>渲染</TabBtn>
          <TabBtn active={workspace === "script"} onClick={() => navigateWithGuard({ type: "script-graph" })}>脚本</TabBtn>
          <TabBtn active={workspace === "assets"} onClick={() => navigateWithGuard({ type: "workspace", workspace: "assets" })}>资产</TabBtn>
          <TabBtn active={workspace === "project"} onClick={() => navigateWithGuard({ type: "workspace", workspace: "project" })}>项目</TabBtn>
        </div>

        {/* 右侧：项目名 + 同步指示器 + 渲染层 */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "var(--space-3)", flexShrink: 0 }}>
          <span style={projectNameStyle}>{project.meta.name}</span>
          <SyncIndicator state={syncState} onRetry={() => void refreshProject(false)} />
          <span style={rendererLabelStyle}>当前渲染层</span>
          <span style={rendererStatusStyle} title={rendererStatusText}>{rendererStatusText}</span>
          <IconButton onClick={() => runWithUnsavedChangesGuard(onOpenSettings)} title="设置" aria-label="设置">
            <SettingsIcon size={15} />
          </IconButton>
        </div>
      </header>

      {/* 内容区 */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        {workspace === "render" && (
          <div style={renderWorkspaceStyle}>
            <CollapsibleSidebar
              title="渲染层"
              collapsed={sidebarPrefs.renderSidebarCollapsed}
              onCollapsedChange={handleRenderSidebarCollapsedChange}
              expandedWidth={180}
              collapsedLabel="渲染层"
            >
              <RendererSidebar
                rendererIds={project.rendererIds}
                activeRendererId={rendererId}
                diagnostics={rendererDiagnostics}
                onSelect={handleRendererChange}
                onCreate={handleCreateRenderer}
                onDuplicate={handleDuplicateRenderer}
                onRename={handleRenameRenderer}
                onDelete={handleDeleteRenderer}
              />
            </CollapsibleSidebar>
            <div style={previewPaneStyle}>
              <Preview
                key={`${rendererId}-${refreshKey}`}
                project={project}
                rendererId={rendererId}
                onRendererDiagnosticsChange={setRendererDiagnostics}
              />
            </div>
          </div>
        )}
        {workspace === "script" && (
          <ScriptWorkspace
            key={project.path}
            project={project}
            rendererId={rendererId}
            refreshKey={refreshKey}
            outlineCollapsed={sidebarPrefs.scriptOutlineCollapsed}
            onOutlineCollapsedChange={handleScriptOutlineCollapsedChange}
            location={location.type === "script-node" ? { view: "node", nodeId: location.nodeId } : { view: "graph" }}
            focusRequest={graphIssueFocus}
            onOpenGraph={() => navigateWithGuard({ type: "script-graph" })}
            onOpenNode={(nodeId) => navigateWithGuard({ type: "script-node", nodeId })}
            onReplaceWithGraph={() => replaceLocationWithGuard({ type: "script-graph" })}
            onSaved={handleSaved}
            onDirtyChange={setHasUnsavedChanges}
          />
        )}
        {workspace === "assets" && (
          <AssetsWorkspace
            key={project.path}
            project={project}
            refreshKey={refreshKey}
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
      </div>

      {/* 全局状态指示器：汇总图结构 + 资产 + manifest 三类问题。
          绿勾=全项目无问题，红图标=有某处问题，点开按来源分组。 */}
      <StatusPanel
        issues={report.projectIssues}
        okLabel="项目正常"
        notOkLabel={(n) => `项目有 ${n} 个问题`}
        dialogTitle="Project Issues"
        dialogAriaLabel="Project Issues"
        emptyDescription="项目正常"
        sourceLabel={projectIssueSourceLabel}
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

      {/* 渲染层操作弹窗（替换 window.prompt / confirm / alert） */}
      {rendererPrompt && (
        <PromptDialog
          title={rendererPrompt.title}
          label={rendererPrompt.label}
          initialValue={rendererPrompt.initialValue}
          confirmLabel={rendererPrompt.confirmLabel}
          allowUnchanged={rendererPrompt.allowUnchanged}
          onConfirm={rendererPrompt.onConfirm}
          onClose={() => setRendererPrompt(null)}
        />
      )}
      {rendererConfirm && (
        <ConfirmDialog
          message={rendererConfirm.message}
          danger
          confirmLabel="删除"
          onConfirm={rendererConfirm.onConfirm}
          onClose={() => setRendererConfirm(null)}
        />
      )}
      {rendererAlert && <AlertDialog danger message={rendererAlert} onClose={() => setRendererAlert(null)} />}
      {unsavedNavigation && (
        <ConfirmDialog
          message="当前工作区有未保存的草稿。离开后草稿会保留，并在本次会话中返回时自动恢复。"
          confirmLabel="离开并保留草稿"
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
  const config = {
    synced: { label: "已同步", dot: "var(--status-ok)", cursor: "default" },
    syncing: { label: "同步中...", dot: "var(--status-warn)", cursor: "default" },
    error: { label: "刷新失败（点击重试）", dot: "var(--status-error)", cursor: "pointer" },
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
      title={state === "error" ? "重新打开项目并保留当前工作台" : undefined}
    >
      <span
        style={{
          ...syncDotStyle,
          background: config.dot,
          boxShadow: state === "syncing" ? "0 0 0 3px var(--status-warn-ring)" : undefined,
        }}
      />
      {config.label}
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
  position: "absolute",
  left: "50%",
  top: "50%",
  transform: "translate(-50%, -50%)",
  display: "flex",
  gap: "var(--space-1)",
};
const projectNameStyle: React.CSSProperties = {
  fontSize: "var(--text-sm)",
  fontWeight: 600,
  color: "var(--text-muted)",
  maxWidth: 200,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const rendererLabelStyle: React.CSSProperties = {
  fontSize: "var(--text-sm)",
  color: "var(--text-muted)",
};
const rendererStatusStyle: React.CSSProperties = {
  maxWidth: 140,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  padding: "var(--space-1) var(--space-2)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-strong)",
  background: "var(--bg-panel)",
  color: "var(--text-primary)",
  fontSize: "var(--text-base)",
};
const renderWorkspaceStyle: React.CSSProperties = {
  display: "flex",
  width: "100%",
  height: "100%",
  minWidth: 0,
  overflow: "hidden",
  background: "var(--bg-inset)",
};
const previewPaneStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
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
};
const syncDotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: "var(--radius-pill)",
  flexShrink: 0,
};
