/**
 * 项目入口页 —— 打开项目目录，或在父目录下新建项目。
 */
import { useCallback, useState } from "react";
import { createProject, initializeProject, openProject, pickDirectory } from "../../lib/tauri";
import type { ProjectData } from "../../lib/types";

interface Props {
  onOpen: (project: ProjectData) => void;
  canGoForward?: boolean;
  onForward?: () => void;
  onOpenSettings?: () => void;
}

export function ProjectList({ onOpen, canGoForward = false, onForward, onOpenSettings }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newProjectParent, setNewProjectParent] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState("");

  const openDirectory = useCallback(async (dir: string) => {
    const target = dir.trim();
    if (!target) {
      setError("先选择一个项目目录");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      onOpen(await openProject(target));
    } catch (e) {
      const message = String(e);
      if (!message.includes("缺少 gal.project.json")) {
        setError(message);
        return;
      }

      const confirmed = window.confirm(
        [
          "这个目录还不是 GalStudio 项目。",
          "",
          "是否在此目录中添加 GalStudio 工程文件？",
          "将创建 gal.project.json、content/ 和 renderers/default/。",
          "现有文件不会被删除或覆盖。",
        ].join("\n"),
      );
      if (!confirmed) return;

      try {
        onOpen(await initializeProject(target));
      } catch (initError) {
        setError(String(initError));
      }
    } finally {
      setLoading(false);
    }
  }, [onOpen]);

  const handlePickProject = async () => {
    const dir = await pickDirectory();
    if (!dir) return;
    await openDirectory(dir);
  };

  const handleNew = async () => {
    const parentDir = await pickDirectory();
    if (!parentDir) return;
    setError(null);
    setNewProjectParent(parentDir);
    setNewProjectName("");
  };

  const handleCreateProject = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newProjectParent) return;
    const projectName = newProjectName.trim();
    if (!projectName) return;
    setLoading(true);
    setError(null);
    try {
      onOpen(await createProject(newProjectParent, projectName));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={pageStyle}>
      <div style={navOverlayStyle}>
        <NavButton disabled label="后退" ariaLabel="后退">‹</NavButton>
        <NavButton onClick={onForward} disabled={!canGoForward} label="前进到上一个项目工作台" ariaLabel="前进">›</NavButton>
        {onOpenSettings && (
          <NavButton onClick={onOpenSettings} label="设置" ariaLabel="设置">⚙</NavButton>
        )}
      </div>

      <header style={headerStyle}>
        <h1 style={titleStyle}>GalStudio</h1>
        <p style={subtitleStyle}>galgame 开发工具</p>
      </header>

      <section style={sectionStyle}>
        <div style={workspaceRow}>
          <button onClick={handlePickProject} style={btnStyle} disabled={loading}>打开项目…</button>
          <button onClick={handleNew} style={primaryBtn} disabled={loading}>+ 新建项目</button>
        </div>

        {error && !newProjectParent && <div style={errorStyle}>{error}</div>}

        <div style={emptyStyle}>
          {loading ? "加载中…" : "选择一个项目目录打开；如果目录还不是 GalStudio 项目，会先询问是否添加工程文件。"}
        </div>
      </section>

      {newProjectParent && (
        <div style={modalOverlayStyle}>
          <form onSubmit={handleCreateProject} style={modalStyle}>
            <div style={modalHeaderStyle}>新建项目</div>
            <div style={parentPathStyle}>{newProjectParent}</div>
            <input
              autoFocus
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="项目名称"
              style={inputStyle}
              disabled={loading}
            />
            {error && <div style={modalErrorStyle}>{error}</div>}
            <div style={modalActionsStyle}>
              <button
                type="button"
                style={btnStyle}
                disabled={loading}
                onClick={() => {
                  setNewProjectParent(null);
                  setNewProjectName("");
                  setError(null);
                }}
              >
                取消
              </button>
              <button type="submit" style={primaryBtn} disabled={!newProjectName.trim() || loading}>创建</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function NavButton({ onClick, disabled, children, label, ariaLabel }: {
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  label: string;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={label}
      style={disabled ? { ...navButtonStyle, opacity: 0.35, cursor: "not-allowed" } : navButtonStyle}
    >
      {children}
    </button>
  );
}

const pageStyle: React.CSSProperties = {
  padding: "48px 64px",
  maxWidth: 900,
  margin: "0 auto",
};
const headerStyle: React.CSSProperties = { marginBottom: 32 };
const titleStyle: React.CSSProperties = { fontSize: 32, margin: "0 0 4px", fontWeight: 600 };
const subtitleStyle: React.CSSProperties = { margin: 0, color: "var(--text-muted)", fontSize: 14 };
const sectionStyle: React.CSSProperties = {};
const workspaceRow: React.CSSProperties = { display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" };
const navOverlayStyle: React.CSSProperties = {
  position: "fixed",
  top: 10,
  left: 88,
  display: "flex",
  gap: 4,
  zIndex: 10,
};
const navButtonStyle: React.CSSProperties = {
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
const modalOverlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "grid",
  placeItems: "center",
  padding: 24,
  background: "var(--overlay)",
  zIndex: 20,
};
const modalStyle: React.CSSProperties = {
  width: "min(480px, 100%)",
  padding: 20,
  background: "var(--bg-panel)",
  border: "1px solid var(--border-strong)",
  borderRadius: 8,
  boxShadow: "0 24px 80px var(--overlay)",
};
const modalHeaderStyle: React.CSSProperties = { fontSize: 16, fontWeight: 600, marginBottom: 8 };
const parentPathStyle: React.CSSProperties = { fontSize: 12, color: "var(--text-muted)", marginBottom: 12, wordBreak: "break-all" };
const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 12px",
  background: "var(--bg-hover)",
  border: "1px solid var(--border-strong)",
  borderRadius: 6,
  color: "var(--text-primary)",
  fontFamily: "inherit",
  fontSize: 14,
};
const modalActionsStyle: React.CSSProperties = { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 };
const btnStyle: React.CSSProperties = {
  padding: "8px 14px", background: "var(--bg-hover)", border: "1px solid var(--border-strong)",
  borderRadius: 6, color: "var(--text-primary)", cursor: "pointer", fontSize: 14,
};
const primaryBtn: React.CSSProperties = {
  ...btnStyle, background: "var(--accent)", borderColor: "var(--accent)", color: "var(--text-on-accent)",
};
const errorStyle: React.CSSProperties = {
  padding: "10px 14px", background: "var(--bg-error-soft)", border: "1px solid var(--border-error)",
  borderRadius: 6, color: "var(--status-error-text)", fontSize: 13, marginBottom: 16, whiteSpace: "pre-wrap",
};
const modalErrorStyle: React.CSSProperties = { ...errorStyle, marginTop: 12, marginBottom: 0 };
const emptyStyle: React.CSSProperties = { color: "var(--text-dim)", fontSize: 14, padding: 24, textAlign: "center" };
