/**
 * Workspace —— 打开项目后的工作台。
 *
 * 顶部：项目名 + 渲染层切换 + 返回
 * 内容区：Render / Script / Assets 三工作台
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { ProjectData } from "./lib/types";
import { Preview } from "./features/preview/Preview";
import { ScriptWorkspace } from "./features/script/ScriptWorkspace";
import { AssetsPlaceholder } from "./features/assets/AssetsPlaceholder";
import { openProject, saveProjectMeta, unwatchProject, watchProject } from "./lib/tauri";
import { clearRendererCache } from "./features/renderers/rendererLoader";

interface Props {
  project: ProjectData;
  onBack: () => void;
  /** 项目被刷新后（编辑保存触发）通知上层更新 */
  onProjectChanged: (p: ProjectData) => void;
}

type WorkspaceId = "render" | "script" | "assets";
type SyncState = "synced" | "syncing" | "error";

interface ProjectChangedPayload {
  projectPath: string;
  rendererChanged: boolean;
}

export function Workspace({ project, onBack, onProjectChanged }: Props) {
  const [workspace, setWorkspace] = useState<WorkspaceId>("render");
  const [rendererId, setRendererId] = useState(project.meta.activeRendererId);
  const [refreshKey, setRefreshKey] = useState(0);
  const [syncState, setSyncState] = useState<SyncState>("synced");
  const rendererIdsKey = useMemo(() => project.rendererIds.join("\0"), [project.rendererIds]);

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

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%" }}>
      {/* 顶栏 */}
      <header style={topBarStyle}>
        <button onClick={onBack} style={backBtnStyle}>← 项目列表</button>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#d4dae2" }}>{project.meta.name}</div>
        <div style={{ flex: 1 }} />
        <SyncIndicator state={syncState} onRetry={() => void refreshProject(false)} />
        <label style={{ fontSize: 12, color: "#7a8290", marginRight: 6 }}>渲染层</label>
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
      </header>

      {/* 工作台标签栏 */}
      <div style={tabBarStyle}>
        <TabBtn active={workspace === "render"} onClick={() => setWorkspace("render")}>Render</TabBtn>
        <TabBtn active={workspace === "script"} onClick={() => setWorkspace("script")}>Script</TabBtn>
        <TabBtn active={workspace === "assets"} onClick={() => setWorkspace("assets")}>Assets</TabBtn>
      </div>

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
            onSaved={handleSaved}
          />
        )}
        {workspace === "assets" && <AssetsPlaceholder />}
      </div>
    </div>
  );
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
      padding: "8px 20px", background: active ? "#1a1f29" : "transparent",
      border: "none", borderBottom: active ? "2px solid #3a6ea5" : "2px solid transparent",
      color: active ? "#9fc8e3" : "#7a8290", cursor: "pointer", fontSize: 13,
    }}>
      {children}
    </button>
  );
}

const topBarStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 12,
  padding: "10px 16px", borderBottom: "1px solid #232a38", background: "#0e1116",
};
const backBtnStyle: React.CSSProperties = {
  padding: "6px 12px", background: "transparent", border: "1px solid #2a3242",
  borderRadius: 6, color: "#a0a8b4", cursor: "pointer", fontSize: 13,
};
const selectStyle: React.CSSProperties = {
  padding: "6px 10px", background: "#1a1f29", border: "1px solid #2a3242",
  borderRadius: 6, color: "#d4dae2", fontSize: 13,
};
const tabBarStyle: React.CSSProperties = {
  display: "flex", borderBottom: "1px solid #232a38", background: "#0b0e14",
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
