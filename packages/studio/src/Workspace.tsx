/**
 * Workspace —— 打开项目后的工作台。
 *
 * 顶部：项目名 + 渲染层切换 + 返回
 * 内容区：预览 / 编辑 两个标签
 */
import { useCallback, useState } from "react";
import type { ProjectData } from "./lib/types";
import { Preview } from "./features/preview/Preview";
import { ScriptEditor } from "./features/editor/ScriptEditor";
import { openProject, saveProjectMeta } from "./lib/tauri";

interface Props {
  project: ProjectData;
  onBack: () => void;
  /** 项目被刷新后（编辑保存触发）通知上层更新 */
  onProjectChanged: (p: ProjectData) => void;
}

type Tab = "preview" | "editor";

export function Workspace({ project, onBack, onProjectChanged }: Props) {
  const [tab, setTab] = useState<Tab>("preview");
  const [rendererId, setRendererId] = useState(project.meta.activeRendererId);
  const [refreshKey, setRefreshKey] = useState(0);

  // 切换渲染层：更新本地 + 持久化到 gal.project.json
  const handleRendererChange = useCallback(async (id: string) => {
    setRendererId(id);
    try {
      await saveProjectMeta(project.path, { ...project.meta, activeRendererId: id });
    } catch (e) {
      console.warn("持久化渲染层失败:", e);
    }
  }, [project]);

  // 编辑器保存后：重新打开项目拿最新数据，触发预览刷新
  const handleSaved = useCallback(async () => {
    try {
      const fresh = await openProject(project.path);
      onProjectChanged(fresh);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      console.warn("刷新项目失败:", e);
    }
  }, [project.path, onProjectChanged]);

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%" }}>
      {/* 顶栏 */}
      <header style={topBarStyle}>
        <button onClick={onBack} style={backBtnStyle}>← 项目列表</button>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#d4dae2" }}>{project.meta.name}</div>
        <div style={{ flex: 1 }} />
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

      {/* 标签栏 */}
      <div style={tabBarStyle}>
        <TabBtn active={tab === "preview"} onClick={() => setTab("preview")}>预览</TabBtn>
        <TabBtn active={tab === "editor"} onClick={() => setTab("editor")}>编辑</TabBtn>
      </div>

      {/* 内容区 */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        {tab === "preview" && (
          <Preview key={`${rendererId}-${refreshKey}`} project={project} rendererId={rendererId} />
        )}
        {tab === "editor" && (
          <ScriptEditor project={project} onSaved={handleSaved} />
        )}
      </div>
    </div>
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
