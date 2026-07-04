/**
 * Workspace —— 打开项目后的工作台。
 *
 * 顶部：项目名 + 渲染层状态 + 返回
 * 内容区：渲染 / 脚本 / 资产 / 设置
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { GraphIssueFocusRequest, ProjectData, ProjectGraph } from "./lib/types";
import { Preview } from "./features/preview/Preview";
import { ScriptWorkspace } from "./features/script/ScriptWorkspace";
import { AssetsWorkspace } from "./features/assets/AssetsWorkspace";
import { Settings } from "./features/settings/Settings";
import { StatusPanel } from "./features/common/StatusPanel";
import { CollapsibleSidebar } from "./features/common/CollapsibleSidebar";
import { RendererSidebar } from "./features/renderers/RendererSidebar";
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
import type { AppSettings } from "./lib/theme";
import { workspaceFromLocation, type NavigationLocation } from "./lib/navigation";
import { t } from "./lib/i18n";

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
  settings: AppSettings;
  onUpdateSettings: (next: Partial<AppSettings>) => void | Promise<void>;
}

type SyncState = "synced" | "syncing" | "error";
type WindowDragMouseEvent = Pick<React.MouseEvent<HTMLElement>, "button" | "target">;

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
  settings,
  onUpdateSettings,
}: Props) {
  const [rendererId, setRendererId] = useState(project.meta.activeRendererId);
  const [refreshKey, setRefreshKey] = useState(0);
  const [syncState, setSyncState] = useState<SyncState>("synced");
  const [renderSidebarCollapsed, setRenderSidebarCollapsed] = useState(false);
  const [assetsSidebarCollapsed, setAssetsSidebarCollapsed] = useState(false);
  const [scriptOutlineCollapsed, setScriptOutlineCollapsed] = useState(false);
  const [graphIssueFocus, setGraphIssueFocus] = useState<GraphIssueFocusRequest | null>(null);
  const graphIssueFocusRequestIdRef = useRef(0);
  const rendererIdsKey = useMemo(() => project.rendererIds.join("\0"), [project.rendererIds]);
  const workspace = workspaceFromLocation(location) ?? "render";

  // 切换渲染层：更新本地 + 持久化到 gal.project.json
  const handleRendererChange = useCallback(async (id: string) => {
    setRendererId(id);
    try {
      await saveProjectMeta(project.path, { ...project.meta, activeRendererId: id }, project.projectRevision);
    } catch (e) {
      console.warn("持久化渲染层失败:", e);
    }
  }, [project]);

  const refreshProject = useCallback(async (rendererChanged = false) => {
    setSyncState("syncing");
    try {
      if (rendererChanged) clearRendererCache();
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

  const handleCreateRenderer = useCallback(async () => {
    const rendererId = window.prompt("新建渲染层 id", "renderer");
    if (!rendererId) return;
    try {
      await createRenderer(project.path, rendererId, "default");
      await saveProjectMeta(project.path, { ...project.meta, activeRendererId: rendererId }, project.projectRevision);
      setRendererId(rendererId);
      await refreshProject(true);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }, [project.meta, project.path, refreshProject]);

  const handleDuplicateRenderer = useCallback(async (sourceId: string) => {
    if (!sourceId) return;
    const newId = window.prompt("复制为新的渲染层 id", `${sourceId}_copy`);
    if (!newId) return;
    try {
      await duplicateRenderer(project.path, sourceId, newId);
      await saveProjectMeta(project.path, { ...project.meta, activeRendererId: newId }, project.projectRevision);
      setRendererId(newId);
      await refreshProject(true);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }, [project.meta, project.path, refreshProject]);

  const handleRenameRenderer = useCallback(async (sourceId: string) => {
    if (!sourceId) return;
    const newId = window.prompt("新的渲染层 id", sourceId);
    if (!newId || newId === sourceId) return;
    try {
      await renameRenderer(project.path, sourceId, newId);
      if (rendererId === sourceId) setRendererId(newId);
      await refreshProject(true);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }, [project.path, refreshProject, rendererId]);

  const handleDeleteRenderer = useCallback(async (sourceId: string) => {
    if (!sourceId) return;
    const confirmed = window.confirm(`确定删除渲染层 ${sourceId}？`);
    if (!confirmed) return;
    try {
      await deleteRenderer(project.path, sourceId);
      await refreshProject(true);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }, [project.path, refreshProject]);

  const handleTitleBarMouseDown = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (!shouldStartWindowDrag(event)) return;

    void getCurrentWindow().startDragging().catch((e) => {
      console.warn("启动窗口拖拽失败:", e);
    });
  }, []);

  const report = project.projectReport ?? { projectIssues: [] };
  const rendererStatusText = rendererId || t("workspace.noRenderer");

  const handleProjectIssueClick = useCallback((issue: { source?: string; nodeId?: string; edgeId?: string; file?: string; jsonPath?: string }) => {
    const next = graphFocusTargetFromIssue(issue, graphIssueFocusRequestIdRef.current + 1, project.graph);
    if (!next) return;
    graphIssueFocusRequestIdRef.current = next.requestId;
    setGraphIssueFocus(next);
    if (issue.source === "node" && next.nodeId) {
      onNavigate({ type: "script-node", nodeId: next.nodeId });
    } else {
      onNavigate({ type: "script-graph" });
    }
  }, [onNavigate, project.graph]);

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", width: "100%", height: "100%" }}>
      {/* 标题栏（自定义拖拽区，整行可拖动窗口） */}
      <header data-tauri-drag-region onMouseDown={handleTitleBarMouseDown} style={titleBarStyle}>
        {/* 左侧：返回 / 前进（紧邻红绿灯右侧，padding-left 已为红绿灯留出避让） */}
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          <NavBtn onClick={onBack} disabled={!canGoBack} label="后退" ariaLabel="后退">‹</NavBtn>
          <NavBtn onClick={onForward} disabled={!canGoForward} label="前进" ariaLabel="前进">›</NavBtn>
        </div>

        {/* 居中：工作台切换，窗口水平绝对居中 */}
        <div data-tauri-drag-region style={centerGroupStyle}>
          <TabBtn active={workspace === "render"} onClick={() => onNavigate({ type: "workspace", workspace: "render" })}>{t("workspace.tab.render")}</TabBtn>
          <TabBtn active={workspace === "script"} onClick={() => onNavigate({ type: "script-graph" })}>{t("workspace.tab.script")}</TabBtn>
          <TabBtn active={workspace === "assets"} onClick={() => onNavigate({ type: "workspace", workspace: "assets" })}>{t("workspace.tab.assets")}</TabBtn>
          <TabBtn active={workspace === "settings"} onClick={() => onNavigate({ type: "workspace", workspace: "settings" })}>{t("workspace.tab.settings")}</TabBtn>
        </div>

        {/* 右侧：项目名 + 同步指示器 + 渲染层 */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span style={projectNameStyle}>{project.meta.name}</span>
          <SyncIndicator state={syncState} onRetry={() => void refreshProject(false)} />
          <span style={rendererLabelStyle}>{t("workspace.currentRenderer")}</span>
          <span style={rendererStatusStyle} title={rendererStatusText}>{rendererStatusText}</span>
        </div>
      </header>

      {/* 内容区 */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        {workspace === "render" && (
          <div style={renderWorkspaceStyle}>
            <CollapsibleSidebar
              title="渲染层"
              collapsed={renderSidebarCollapsed}
              onCollapsedChange={setRenderSidebarCollapsed}
              expandedWidth={180}
              collapsedLabel="渲染层"
            >
              <RendererSidebar
                rendererIds={project.rendererIds}
                activeRendererId={rendererId}
                onSelect={handleRendererChange}
                onCreate={handleCreateRenderer}
                onDuplicate={handleDuplicateRenderer}
                onRename={handleRenameRenderer}
                onDelete={handleDeleteRenderer}
              />
            </CollapsibleSidebar>
            <div style={previewPaneStyle}>
              <Preview key={`${rendererId}-${refreshKey}`} project={project} rendererId={rendererId} />
            </div>
          </div>
        )}
        {workspace === "script" && (
          <ScriptWorkspace
            project={project}
            rendererId={rendererId}
            refreshKey={refreshKey}
            outlineCollapsed={scriptOutlineCollapsed}
            onOutlineCollapsedChange={setScriptOutlineCollapsed}
            location={location.type === "script-node" ? { view: "node", nodeId: location.nodeId } : { view: "graph" }}
            focusRequest={graphIssueFocus}
            onOpenGraph={() => onNavigate({ type: "script-graph" })}
            onOpenNode={(nodeId) => onNavigate({ type: "script-node", nodeId })}
            onReplaceWithGraph={() => onReplaceLocation({ type: "script-graph" })}
            onSaved={handleSaved}
          />
        )}
        {workspace === "assets" && (
          <AssetsWorkspace
            project={project}
            refreshKey={refreshKey}
            sidebarCollapsed={assetsSidebarCollapsed}
            onSidebarCollapsedChange={setAssetsSidebarCollapsed}
            onSaved={handleSaved}
          />
        )}
        {workspace === "settings" && (
          <Settings
            settings={settings}
            onUpdate={onUpdateSettings}
            presentation="embedded"
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
    </div>
  );
}

export function shouldStartWindowDrag(event: WindowDragMouseEvent): boolean {
  if (event.button !== 0) return false;

  const target = event.target;
  if (!target || !hasClosest(target)) return true;
  return target.closest(windowDragIgnoreSelector) === null;
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
    <button onClick={onClick} style={{
      padding: "0 14px", height: 30, background: active ? "var(--bg-hover)" : "transparent",
      border: "none", borderRadius: 6, color: active ? "var(--accent-bright)" : "var(--text-muted)",
      cursor: "pointer", fontSize: 13,
    }}>
      {children}
    </button>
  );
}

function NavBtn({ onClick, disabled, children, label, ariaLabel }: {
  onClick?: () => void; disabled?: boolean; children: React.ReactNode; label: string; ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={label}
      style={disabled ? { ...navBtnStyle, opacity: 0.35, cursor: "not-allowed" } : navBtnStyle}
    >
      {children}
    </button>
  );
}

const titleBarStyle: React.CSSProperties = {
  position: "relative",
  display: "flex",
  alignItems: "center",
  gap: 12,
  height: 38,
  // 左侧 88px 为 macOS 红绿灯避让（约 70px）+ 一点间距；右 12px
  padding: "0 12px 0 88px",
  borderBottom: "1px solid var(--border)",
  background: "var(--bg-app)",
};
const centerGroupStyle: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "50%",
  transform: "translate(-50%, -50%)",
  display: "flex",
  gap: 2,
};
const navBtnStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  border: "1px solid var(--border-strong)",
  borderRadius: 6,
  color: "var(--text-secondary)",
  fontSize: 18,
  lineHeight: 1,
  cursor: "pointer",
};
const projectNameStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "var(--text-muted)",
  maxWidth: 200,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const rendererLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-muted)",
};
const rendererStatusStyle: React.CSSProperties = {
  maxWidth: 140,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  padding: "5px 9px",
  borderRadius: 6,
  border: "1px solid var(--border-strong)",
  background: "var(--bg-panel)",
  color: "var(--text-primary)",
  fontSize: 13,
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
  gap: 7,
  padding: "5px 9px",
  borderRadius: 999,
  border: "1px solid var(--border-strong)",
  background: "var(--bg-panel)",
  fontSize: 12,
};
const syncDotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 999,
  flexShrink: 0,
};
