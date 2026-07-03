/**
 * Workspace —— 打开项目后的工作台。
 *
 * 顶部：项目名 + 渲染层切换 + 返回
 * 内容区：Render / Script / Assets 三工作台
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { GraphIssueFocusRequest, ProjectData } from "./lib/types";
import { Preview } from "./features/preview/Preview";
import { ScriptWorkspace } from "./features/script/ScriptWorkspace";
import { AssetsWorkspace } from "./features/assets/AssetsWorkspace";
import { StatusPanel } from "./features/common/StatusPanel";
import { openProject, saveProjectMeta, unwatchProject, watchProject } from "./lib/tauri";
import { clearRendererCache } from "./features/renderers/rendererLoader";
import { workspaceFromLocation, type NavigationLocation } from "./lib/navigation";

interface Props {
  project: ProjectData;
  location: Exclude<NavigationLocation, { type: "project-list" }>;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onNavigate: (next: NavigationLocation) => void;
  onReplaceLocation: (next: NavigationLocation) => void;
  /** 项目被刷新后（编辑保存触发）通知上层更新 */
  onProjectChanged: (p: ProjectData) => void;
}

type SyncState = "synced" | "syncing" | "error";
type WindowDragMouseEvent = Pick<React.MouseEvent<HTMLElement>, "button" | "target">;

interface ProjectChangedPayload {
  projectPath: string;
  rendererChanged: boolean;
}

export function graphFocusTargetFromIssue(
  issue: { source?: string; nodeId?: string; edgeId?: string },
  requestId: number,
): GraphIssueFocusRequest | null {
  if (issue.source !== "graph") return null;
  if (issue.nodeId) return { requestId, nodeId: issue.nodeId };
  if (issue.edgeId) return { requestId, edgeId: issue.edgeId };
  return null;
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
}: Props) {
  const [rendererId, setRendererId] = useState(project.meta.activeRendererId);
  const [refreshKey, setRefreshKey] = useState(0);
  const [syncState, setSyncState] = useState<SyncState>("synced");
  const [graphIssueFocus, setGraphIssueFocus] = useState<GraphIssueFocusRequest | null>(null);
  const graphIssueFocusRequestIdRef = useRef(0);
  const rendererIdsKey = useMemo(() => project.rendererIds.join("\0"), [project.rendererIds]);
  const workspace = workspaceFromLocation(location) ?? "render";

  // 切换渲染层：更新本地 + 持久化到 gal.project.json
  const handleRendererChange = useCallback(async (id: string) => {
    setRendererId(id);
    try {
      await saveProjectMeta(project.path, { ...project.meta, activeRendererId: id });
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

  const handleTitleBarMouseDown = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (!shouldStartWindowDrag(event)) return;

    void getCurrentWindow().startDragging().catch((e) => {
      console.warn("启动窗口拖拽失败:", e);
    });
  }, []);

  const report = project.projectReport ?? { projectIssues: [] };

  const handleProjectIssueClick = useCallback((issue: { source?: string; nodeId?: string; edgeId?: string }) => {
    const next = graphFocusTargetFromIssue(issue, graphIssueFocusRequestIdRef.current + 1);
    if (!next) return;
    graphIssueFocusRequestIdRef.current = next.requestId;
    setGraphIssueFocus(next);
    onNavigate({ type: "script-graph" });
  }, [onNavigate]);

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
          <TabBtn active={workspace === "render"} onClick={() => onNavigate({ type: "workspace", workspace: "render" })}>Render</TabBtn>
          <TabBtn active={workspace === "script"} onClick={() => onNavigate({ type: "script-graph" })}>Script</TabBtn>
          <TabBtn active={workspace === "assets"} onClick={() => onNavigate({ type: "workspace", workspace: "assets" })}>Assets</TabBtn>
        </div>

        {/* 右侧：项目名 + 同步指示器 + 渲染层 */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span style={projectNameStyle}>{project.meta.name}</span>
          <SyncIndicator state={syncState} onRetry={() => void refreshProject(false)} />
          <label style={{ fontSize: 12, color: "#7a8290" }}>渲染层</label>
          <select
            value={rendererId}
            onChange={(e) => handleRendererChange(e.target.value)}
            style={selectStyle}
          >
            {project.rendererIds.length === 0 && <option value="">（无）</option>}
            {project.rendererIds.map((id) => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
        </div>
      </header>

      {/* 内容区 */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        {workspace === "render" && (
          <Preview key={`${rendererId}-${refreshKey}`} project={project} rendererId={rendererId} />
        )}
        {workspace === "script" && (
          <ScriptWorkspace
            project={project}
            rendererId={rendererId}
            refreshKey={refreshKey}
            location={location.type === "script-node" ? { view: "node", nodeId: location.nodeId } : { view: "graph" }}
            focusRequest={graphIssueFocus}
            onOpenGraph={() => onNavigate({ type: "script-graph" })}
            onOpenNode={(nodeId) => onNavigate({ type: "script-node", nodeId })}
            onReplaceWithGraph={() => onReplaceLocation({ type: "script-graph" })}
            onSaved={handleSaved}
          />
        )}
        {workspace === "assets" && (
          <AssetsWorkspace project={project} refreshKey={refreshKey} onSaved={handleSaved} />
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
        sourceLabel={(s) => (s === "graph" ? "图结构" : s === "asset" ? "资产" : s === "manifest" ? "manifest" : s)}
        issueExtra={(issue) =>
          issue.source === "graph"
            ? issue.nodeId
              ? `node ${issue.nodeId}`
              : issue.edgeId
                ? `edge ${issue.edgeId}`
                : null
            : null
        }
        isIssueClickable={(issue) => issue.source === "graph" && Boolean(issue.nodeId || issue.edgeId)}
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
    synced: { label: "已同步", dot: "#4caf7a", cursor: "default" },
    syncing: { label: "同步中...", dot: "#d49b4d", cursor: "default" },
    error: { label: "刷新失败（点击重试）", dot: "#d66a6a", cursor: "pointer" },
  }[state];

  return (
    <button
      type="button"
      onClick={state === "error" ? onRetry : undefined}
      disabled={state !== "error"}
      style={{
        ...syncButtonStyle,
        cursor: config.cursor,
        color: state === "error" ? "#e0a0a0" : "#a0a8b4",
      }}
      title={state === "error" ? "重新打开项目并保留当前工作台" : undefined}
    >
      <span
        style={{
          ...syncDotStyle,
          background: config.dot,
          boxShadow: state === "syncing" ? "0 0 0 3px rgba(212, 155, 77, 0.14)" : undefined,
        }}
      />
      {config.label}
    </button>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      padding: "0 14px", height: 30, background: active ? "#1a1f29" : "transparent",
      border: "none", borderRadius: 6, color: active ? "#9fc8e3" : "#7a8290",
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
  borderBottom: "1px solid #232a38",
  background: "#0e1116",
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
  border: "1px solid #2a3242",
  borderRadius: 6,
  color: "#a0a8b4",
  fontSize: 18,
  lineHeight: 1,
  cursor: "pointer",
};
const projectNameStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "#7a8290",
  maxWidth: 200,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const selectStyle: React.CSSProperties = {
  padding: "6px 10px", background: "#1a1f29", border: "1px solid #2a3242",
  borderRadius: 6, color: "#d4dae2", fontSize: 13,
};
const syncButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  padding: "5px 9px",
  borderRadius: 999,
  border: "1px solid #2a3242",
  background: "#141922",
  fontSize: 12,
};
const syncDotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 999,
  flexShrink: 0,
};
