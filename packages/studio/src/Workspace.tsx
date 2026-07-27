/**
 * Workspace —— 打开项目后的工作台。
 *
 * 顶部：项目名 + 界面风格选择器 + 返回
 * 内容区：预览 / 脚本 / 资产 / 项目 / 外观 / 导出
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
import { ChevronLeft, ChevronRight, Settings as SettingsIcon } from "lucide-react";
import type { GraphIssueFocusRequest, ProjectData, ProjectGraph } from "./lib/types";
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

interface ProjectChangedPayload {
  projectPath: string;
  rendererChanged: boolean;
}

/**
 * 界面风格获取路径的文档级引导（Spec 19 §4.2）：选择器 title 与空态共用。
 * 只做文案引导，不引入任何 in-app AI 入口。
 */
const RENDERER_GUIDANCE_HINT = "新界面风格可由 AI 在 renderers/ 目录下生成，出现后自动可选择";

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

export function workTitleTooltip(project: Pick<ProjectData, "meta" | "content">): string {
  const title = workspaceTitle(project);
  return title === project.meta.name
    ? `${title}（还没填作品标题，先用项目文件夹名；在「项目」里填写）`
    : `${title}（项目文件夹：${project.meta.name}）`;
}

export function projectIssueSourceLabel(source: string): string {
  if (source === "graph") return "图结构";
  if (source === "node") return "节点内容";
  if (source === "asset") return "资产";
  if (source === "variables") return "故事状态";
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
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [unsavedNavigation, setUnsavedNavigation] = useState<{ action: () => void } | null>(null);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const graphIssueFocusRequestIdRef = useRef(0);
  const projectMetaMutationQueue = useMemo(
    () => new RevisionedProjectMutationQueue(project.projectRevision),
    [project.path],
  );
  const rendererIdsKey = useMemo(() => project.rendererIds.join("\x00"), [project.rendererIds]);
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
      console.warn("持久化渲染层失败:", e);
    }
  }, [project.meta, rendererId, saveProjectMetaQueued]);

  const refreshProject = useCallback(async (rendererChanged = false) => {
    setSyncState("syncing");
    try {
      if (rendererChanged) {
        clearRendererCache();
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

  const handleTitleBarMouseDown = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (!shouldStartWindowDrag(event)) return;

    void getCurrentWindow().startDragging().catch((e) => {
      console.warn("启动窗口拖拽失败:", e);
    });
  }, []);

  const backendReport = project.projectReport ?? { projectIssues: [] };
  // 故事状态的诊断由前端静态分析产出（后端不执行剧情），在这里并入唯一的问题收件箱。
  const report = useMemo(() => ({
    ...backendReport,
    projectIssues: [
      ...backendReport.projectIssues,
      ...collectStoryStateIssues({
        graph: project.graph,
        nodes: project.nodes,
        registry: project.content.variables,
        manifest: project.content.manifest,
      }),
      ...collectDanglingExperienceIssues(project.graph, project.nodes),
    ],
  }), [backendReport, project.graph, project.nodes, project.content.variables, project.content.manifest]);

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
      { id: "ws-render", label: "预览工作台", hint: "切换", keywords: "render preview", onSelect: () => navigateWithGuard({ type: "workspace", workspace: "render" }) },
      { id: "ws-script", label: "脚本工作台", hint: "切换", keywords: "script graph", onSelect: () => navigateWithGuard({ type: "script-graph" }) },
      { id: "ws-assets", label: "资产工作台", hint: "切换", keywords: "assets", onSelect: () => navigateWithGuard({ type: "workspace", workspace: "assets" }) },
      { id: "ws-project", label: "项目工作台", hint: "切换", keywords: "project settings", onSelect: () => navigateWithGuard({ type: "workspace", workspace: "project" }) },
      { id: "ws-appearance", label: "外观工作台", hint: "切换", keywords: "appearance design ui skin", onSelect: () => navigateWithGuard({ type: "workspace", workspace: "appearance" }) },
      { id: "ws-export", label: "导出工作台", hint: "切换", keywords: "export build desktop electron tauri release", onSelect: () => navigateWithGuard({ type: "workspace", workspace: "export" }) },
    ];
    const nodeItems: CommandItem[] = (project.graph?.nodes ?? []).map((node) => ({
      id: `node-${node.id}`,
      label: `跳转节点：${node.title || node.id}`,
      hint: node.id,
      keywords: `${node.id} ${node.title}`,
      onSelect: () => navigateWithGuard({ type: "script-node", nodeId: node.id }),
    }));
    return [...workspaceItems, ...nodeItems];
  }, [project.graph, navigateWithGuard]);

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
          <TabBtn active={workspace === "render"} onClick={() => navigateWithGuard({ type: "workspace", workspace: "render" })}>预览</TabBtn>
          <TabBtn active={workspace === "script"} onClick={() => navigateWithGuard({ type: "script-graph" })}>脚本</TabBtn>
          <TabBtn active={workspace === "assets"} onClick={() => navigateWithGuard({ type: "workspace", workspace: "assets" })}>资产</TabBtn>
          <TabBtn active={workspace === "project"} onClick={() => navigateWithGuard({ type: "workspace", workspace: "project" })}>项目</TabBtn>
          <TabBtn active={workspace === "appearance"} onClick={() => navigateWithGuard({ type: "workspace", workspace: "appearance" })}>外观</TabBtn>
          <TabBtn active={workspace === "export"} onClick={() => navigateWithGuard({ type: "workspace", workspace: "export" })}>导出</TabBtn>
        </div>

        {/* 右侧：项目名 + 同步指示器 + 界面风格选择器（渲染层唯一切换入口，Spec 19 §4.2） */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "var(--space-3)", flexShrink: 0 }}>
          <span style={projectNameStyle} title={workTitleTooltip(project)}>{workspaceTitle(project)}</span>
          <SyncIndicator state={syncState} onRetry={() => void refreshProject(false)} />
          <span style={rendererLabelStyle} title={RENDERER_GUIDANCE_HINT}>界面风格</span>
          {project.rendererIds.length > 0 ? (
            <select
              aria-label="界面风格"
              title={RENDERER_GUIDANCE_HINT}
              style={rendererSelectStyle}
              value={rendererId}
              onChange={(event) => void handleRendererChange(event.target.value)}
            >
              {project.rendererIds.map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
          ) : (
            <span style={rendererEmptyStyle}>{`无界面风格 — ${RENDERER_GUIDANCE_HINT}`}</span>
          )}
          <IconButton onClick={() => runWithUnsavedChangesGuard(onOpenSettings)} title="设置" aria-label="设置">
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
              project={project}
              rendererId={rendererId}
              onOpenNode={(nodeId, instructionIndex) => {
                // 剧情检查里点「在某节点改变了它」→ 切到脚本并聚焦那一条指令。
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

      {paletteOpen && <CommandPalette items={commandItems} onClose={() => setPaletteOpen(false)} />}
      {shortcutsHelpOpen && <ShortcutsHelpDialog onClose={() => setShortcutsHelpOpen(false)} />}
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
const rendererSelectStyle: React.CSSProperties = {
  maxWidth: 160,
  padding: "var(--space-1) var(--space-2)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-strong)",
  background: "var(--bg-panel)",
  color: "var(--text-primary)",
  fontSize: "var(--text-base)",
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
};
const syncDotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: "var(--radius-pill)",
  flexShrink: 0,
};
