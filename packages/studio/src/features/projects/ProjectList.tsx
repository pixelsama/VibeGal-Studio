/**
 * 项目入口页 —— 打开项目目录，或在父目录下新建项目。
 *
 * 「工作区目录」= 包含多个项目的共同父目录。记住上次浏览的工作区目录，
 * 进入入口页就直接列出其中的项目，点一下即可打开。
 */
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, FolderOpen, Plus, Settings as SettingsIcon } from "lucide-react";
import { createProject, initializeProject, listProjects, openProject, pickDirectory } from "../../lib/tauri";
import type { ProjectData, ProjectListItem } from "../../lib/types";
import { loadWorkspaceDir, saveWorkspaceDir, sortProjectsByName } from "../../lib/workspaceProjects";
import { getDesktopPlatform } from "../../lib/platform";
import { Button, IconButton } from "../common/Button";
import { ConfirmDialog } from "../common/Dialogs";
import { EmptyState } from "../common/EmptyState";

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
  const [workspaceDir, setWorkspaceDir] = useState<string | null>(() => loadWorkspaceDir());
  const [workspaceProjects, setWorkspaceProjects] = useState<ProjectListItem[] | null>(null);

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

  // 工作区目录变化（含启动时读到的记忆值）→ 扫描其中的项目
  useEffect(() => {
    if (!workspaceDir) {
      setWorkspaceProjects(null);
      return;
    }
    let active = true;
    setWorkspaceProjects(null);
    listProjects(workspaceDir)
      .then((items) => {
        if (active) setWorkspaceProjects(items);
      })
      .catch((scanError) => {
        if (active) setError(String(scanError));
      });
    return () => {
      active = false;
    };
  }, [workspaceDir]);

  const handleBrowseWorkspace = async () => {
    const dir = await pickDirectory();
    if (!dir) return;
    setError(null);
    saveWorkspaceDir(dir);
    setWorkspaceDir(dir);
  };

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
        <h1 style={titleStyle}>VibeGal-Studio</h1>
        <p style={subtitleStyle}>galgame 开发工具</p>
      </header>

      <section style={sectionStyle}>
        <div style={workspaceRow}>
          <Button variant="secondary" onClick={handlePickProject} disabled={loading}>打开项目…</Button>
          <Button variant="primary" onClick={handleNew} disabled={loading}>
            <Plus size={15} />
            新建项目
          </Button>
          <Button variant="ghost" onClick={() => void handleBrowseWorkspace()} disabled={loading}>
            <FolderOpen size={15} />
            {workspaceDir ? "更换工作区…" : "浏览工作区…"}
          </Button>
        </div>

        {error && !newProjectParent && <div style={errorStyle}>{error}</div>}

        {workspaceDir ? (
          <section style={workspaceSectionStyle}>
            <div style={workspaceHeaderStyle}>
              <span style={workspaceLabelStyle}>工作区</span>
              <span style={workspaceDirStyle} title={workspaceDir}>{workspaceDir}</span>
            </div>
            {workspaceProjects == null ? (
              // 扫描未返回时先放两条骨架行，贴近真实列表行的占位
              <div style={workspaceSkeletonStyle}>
                <div className="gs-skeleton" style={{ height: 56 }} />
                <div className="gs-skeleton" style={{ height: 56 }} />
              </div>
            ) : workspaceProjects.length === 0 ? (
              <EmptyState
                icon={FolderOpen}
                title="这个目录下还没有项目"
                description="在别处新建项目，或把已有项目目录放进这个工作区。"
              />
            ) : (
              <WorkspaceProjectList
                items={workspaceProjects}
                disabled={loading}
                onOpen={(path) => void openDirectory(path)}
              />
            )}
          </section>
        ) : (
          <EmptyState
            icon={FolderOpen}
            title="还没有打开的项目"
            description="选择一个项目目录打开（目录还不是项目时会先询问是否初始化），或选择一个工作区目录自动列出其中的项目。"
            action={
              <>
                <Button variant="secondary" onClick={handlePickProject} disabled={loading}>打开项目…</Button>
                <Button variant="primary" onClick={handleNew} disabled={loading}>新建项目</Button>
              </>
            }
          />
        )}
      </section>

      {newProjectParent && (
        <div className="gs-anim-fade" style={modalOverlayStyle}>
          <form onSubmit={handleCreateProject} className="gs-anim-pop" style={modalStyle}>
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
              <div>这个目录还不是 VibeGal-Studio 项目。</div>
              <div style={{ marginTop: 10 }}>
                是否在此目录中添加 VibeGal-Studio 工程文件？将创建 gal.project.json、content/ 和 renderers/default/。现有文件不会被删除或覆盖。
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

/** 工作区目录下的项目列表：按名称排序，点击打开。 */
export function WorkspaceProjectList({
  items,
  disabled = false,
  onOpen,
}: {
  items: ProjectListItem[];
  disabled?: boolean;
  onOpen: (path: string) => void;
}) {
  return (
    <ul style={projectListStyle}>
      {sortProjectsByName(items).map((item) => (
        <li key={item.path} style={projectListItemStyle}>
          <button
            type="button"
            className="gs-list-row"
            disabled={disabled}
            onClick={() => onOpen(item.path)}
          >
            <span style={projectNameStyle}>{item.meta.name}</span>
            <span style={projectPathStyle}>{item.path}</span>
          </button>
        </li>
      ))}
    </ul>
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
  // macOS Overlay 标题栏需避让红绿灯；其他平台（原生标题栏）正常左边距
  left: getDesktopPlatform() === "macos" ? 88 : "var(--space-3)",
  display: "flex",
  gap: "var(--space-1)",
  zIndex: 10,
};
const workspaceSectionStyle: React.CSSProperties = {
  padding: "var(--space-4)",
  background: "var(--bg-inset)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
};
const workspaceHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "var(--space-2)",
  marginBottom: "var(--space-3)",
  minWidth: 0,
};
const workspaceLabelStyle: React.CSSProperties = {
  fontSize: "var(--text-sm)",
  fontWeight: 600,
  color: "var(--text-secondary)",
  flexShrink: 0,
};
const workspaceDirStyle: React.CSSProperties = {
  fontSize: "var(--text-sm)",
  color: "var(--text-muted)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const projectListStyle: React.CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
};
const projectListItemStyle: React.CSSProperties = { display: "block" };
const projectNameStyle: React.CSSProperties = { fontSize: "var(--text-md)", fontWeight: 600, color: "var(--text-bright)" };
const projectPathStyle: React.CSSProperties = { fontSize: "var(--text-sm)", color: "var(--text-muted)", wordBreak: "break-all" };
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
const workspaceSkeletonStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: "var(--space-2)" };
