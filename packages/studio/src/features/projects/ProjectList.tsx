/**
 * 项目入口页 —— 打开项目目录，或在父目录下新建项目。
 */
import { useCallback, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Settings as SettingsIcon } from "lucide-react";
import { createProject, initializeProject, openProject, pickDirectory } from "../../lib/tauri";
import type { ProjectData } from "../../lib/types";
import { Button, IconButton } from "../common/Button";
import { ConfirmDialog } from "../common/Dialogs";

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
  const [initTarget, setInitTarget] = useState<string | null>(null);

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
      if (message.includes("缺少 gal.project.json")) {
        setInitTarget(target);
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }, [onOpen]);

  const confirmInitialize = useCallback(async () => {
    if (!initTarget) return;
    setLoading(true);
    setError(null);
    try {
      onOpen(await initializeProject(initTarget));
    } catch (initError) {
      setError(String(initError));
    } finally {
      setLoading(false);
      setInitTarget(null);
    }
  }, [initTarget, onOpen]);

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
        <IconButton disabled title="后退" aria-label="后退">
          <ChevronLeft size={18} />
        </IconButton>
        <IconButton onClick={onForward} disabled={!canGoForward} title="前进到上一个项目工作台" aria-label="前进">
          <ChevronRight size={18} />
        </IconButton>
        {onOpenSettings && (
          <IconButton onClick={onOpenSettings} title="设置" aria-label="设置">
            <SettingsIcon size={15} />
          </IconButton>
        )}
      </div>

      <header style={headerStyle}>
        <h1 style={titleStyle}>GalStudio</h1>
        <p style={subtitleStyle}>galgame 开发工具</p>
      </header>

      <section style={sectionStyle}>
        <div style={workspaceRow}>
          <Button variant="secondary" onClick={handlePickProject} disabled={loading}>打开项目…</Button>
          <Button variant="primary" onClick={handleNew} disabled={loading}>
            <Plus size={15} />
            新建项目
          </Button>
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
              <Button
                type="button"
                variant="secondary"
                disabled={loading}
                onClick={() => {
                  setNewProjectParent(null);
                  setNewProjectName("");
                  setError(null);
                }}
              >
                取消
              </Button>
              <Button type="submit" variant="primary" disabled={!newProjectName.trim() || loading}>创建</Button>
            </div>
          </form>
        </div>
      )}

      {initTarget && (
        <ConfirmDialog
          message={
            <>
              <div>这个目录还不是 GalStudio 项目。</div>
              <div style={{ marginTop: 10 }}>
                是否在此目录中添加 GalStudio 工程文件？将创建 gal.project.json、content/ 和 renderers/default/。现有文件不会被删除或覆盖。
              </div>
            </>
          }
          confirmLabel="添加工程文件"
          onConfirm={() => void confirmInitialize()}
          onClose={() => setInitTarget(null)}
        />
      )}
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  padding: "var(--space-12) var(--space-16)",
  maxWidth: 900,
  margin: "0 auto",
};
const headerStyle: React.CSSProperties = { marginBottom: "var(--space-8)" };
const titleStyle: React.CSSProperties = { fontSize: "var(--text-display)", margin: "0 0 var(--space-1)", fontWeight: 600 };
const subtitleStyle: React.CSSProperties = { margin: 0, color: "var(--text-muted)", fontSize: "var(--text-md)" };
const sectionStyle: React.CSSProperties = {};
const workspaceRow: React.CSSProperties = { display: "flex", gap: "var(--space-2)", marginBottom: 20, flexWrap: "wrap" };
const navOverlayStyle: React.CSSProperties = {
  position: "fixed",
  top: 10,
  left: 88,
  display: "flex",
  gap: "var(--space-1)",
  zIndex: 10,
};
const modalOverlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "grid",
  placeItems: "center",
  padding: "var(--space-6)",
  background: "var(--overlay)",
  zIndex: 20,
};
const modalStyle: React.CSSProperties = {
  width: "min(480px, 100%)",
  padding: "var(--space-5)",
  background: "var(--bg-panel)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-md)",
  boxShadow: "0 24px 80px var(--overlay)",
};
const modalHeaderStyle: React.CSSProperties = { fontSize: "var(--text-lg)", fontWeight: 600, marginBottom: "var(--space-2)" };
const parentPathStyle: React.CSSProperties = { fontSize: "var(--text-sm)", color: "var(--text-muted)", marginBottom: "var(--space-3)", wordBreak: "break-all" };
const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "var(--space-2) var(--space-3)",
  background: "var(--bg-hover)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-sm)",
  color: "var(--text-primary)",
  fontFamily: "inherit",
  fontSize: "var(--text-md)",
};
const modalActionsStyle: React.CSSProperties = { display: "flex", justifyContent: "flex-end", gap: "var(--space-2)", marginTop: "var(--space-4)" };
const errorStyle: React.CSSProperties = {
  padding: "var(--space-2) var(--space-3)", background: "var(--bg-error-soft)", border: "1px solid var(--border-error)",
  borderRadius: "var(--radius-sm)", color: "var(--status-error-text)", fontSize: "var(--text-base)", marginBottom: "var(--space-4)", whiteSpace: "pre-wrap",
};
const modalErrorStyle: React.CSSProperties = { ...errorStyle, marginTop: "var(--space-3)", marginBottom: 0 };
const emptyStyle: React.CSSProperties = { color: "var(--text-dim)", fontSize: "var(--text-md)", padding: "var(--space-6)", textAlign: "center" };
