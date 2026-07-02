/**
 * 项目列表页 —— 选工作区、列出项目、打开、新建。
 */
import { useCallback, useEffect, useState } from "react";
import { listProjects, createProject, pickDirectory, openProject } from "../../lib/tauri";
import type { ProjectData, ProjectListItem } from "../../lib/types";

interface Props {
  onOpen: (project: ProjectData) => void;
}

export function ProjectList({ onOpen }: Props) {
  const [workspace, setWorkspace] = useState<string>("");
  const [items, setItems] = useState<ProjectListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    setError(null);
    try {
      setItems(await listProjects(workspace));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handlePickWorkspace = async () => {
    const dir = await pickDirectory();
    if (dir) setWorkspace(dir);
  };

  const handleNew = async () => {
    if (!workspace) {
      setError("先选择一个工作区目录");
      return;
    }
    const name = window.prompt("项目名称（将作为文件夹名）");
    if (!name) return;
    setLoading(true);
    setError(null);
    try {
      const project = await createProject(workspace, name);
      await refresh();
      onOpen(project);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = async (path: string) => {
    try {
      onOpen(await openProject(path));
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <h1 style={titleStyle}>GalStudio</h1>
        <p style={subtitleStyle}>galgame 开发工具</p>
      </header>

      <section style={sectionStyle}>
        <div style={workspaceRow}>
          <input
            value={workspace}
            onChange={(e) => setWorkspace(e.target.value)}
            placeholder="工作区目录路径"
            style={inputStyle}
          />
          <button onClick={handlePickWorkspace} style={btnStyle}>选择…</button>
          <button onClick={refresh} style={btnStyle} disabled={!workspace || loading}>刷新</button>
          <button onClick={handleNew} style={primaryBtn} disabled={!workspace || loading}>+ 新建项目</button>
        </div>

        {error && <div style={errorStyle}>{error}</div>}

        <div style={listStyle}>
          {loading && <div style={emptyStyle}>加载中…</div>}
          {!loading && items.length === 0 && workspace && (
            <div style={emptyStyle}>工作区里还没有项目。点「+ 新建项目」创建第一个。</div>
          )}
          {!loading && items.length === 0 && !workspace && (
            <div style={emptyStyle}>先选择一个工作区目录。</div>
          )}
          {items.map((item) => (
            <div key={item.path} style={cardStyle} onClick={() => handleOpen(item.path)}>
              <div style={cardTitleStyle}>{item.meta.name}</div>
              <div style={cardMetaStyle}>{item.path}</div>
              <div style={cardTagStyle}>渲染层: {item.meta.activeRendererId}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  padding: "48px 64px",
  maxWidth: 900,
  margin: "0 auto",
};
const headerStyle: React.CSSProperties = { marginBottom: 32 };
const titleStyle: React.CSSProperties = { fontSize: 32, margin: "0 0 4px", fontWeight: 600 };
const subtitleStyle: React.CSSProperties = { margin: 0, color: "#7a8290", fontSize: 14 };
const sectionStyle: React.CSSProperties = {};
const workspaceRow: React.CSSProperties = { display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" };
const inputStyle: React.CSSProperties = {
  flex: 1, minWidth: 240, padding: "8px 12px",
  background: "#1a1f29", border: "1px solid #2a3242", borderRadius: 6,
  color: "#d4dae2", fontFamily: "inherit", fontSize: 14,
};
const btnStyle: React.CSSProperties = {
  padding: "8px 14px", background: "#1a1f29", border: "1px solid #2a3242",
  borderRadius: 6, color: "#d4dae2", cursor: "pointer", fontSize: 14,
};
const primaryBtn: React.CSSProperties = {
  ...btnStyle, background: "#3a6ea5", borderColor: "#3a6ea5", color: "#fff",
};
const errorStyle: React.CSSProperties = {
  padding: "10px 14px", background: "#3a1a1a", border: "1px solid #6a2a2a",
  borderRadius: 6, color: "#e0a0a0", fontSize: 13, marginBottom: 16, whiteSpace: "pre-wrap",
};
const listStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 10 };
const emptyStyle: React.CSSProperties = { color: "#6a7280", fontSize: 14, padding: 24, textAlign: "center" };
const cardStyle: React.CSSProperties = {
  padding: "16px 20px", background: "#161b24", border: "1px solid #232a38",
  borderRadius: 8, cursor: "pointer",
};
const cardTitleStyle: React.CSSProperties = { fontSize: 16, fontWeight: 600, marginBottom: 4 };
const cardMetaStyle: React.CSSProperties = { fontSize: 12, color: "#6a7280", marginBottom: 6, wordBreak: "break-all" };
const cardTagStyle: React.CSSProperties = { fontSize: 12, color: "#7a8290" };
