/**
 * 项目入口页 —— 打开项目目录，或在父目录下新建项目。
 *
 * 「工作区目录」= 包含多个项目的共同父目录。记住上次浏览的工作区目录，
 * 进入入口页就直接列出其中的项目，点一下即可打开。
 */
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, FolderOpen, Plus, Settings as SettingsIcon, X } from "lucide-react";
import { createProject, initializeProject, listProjects, openProject, pickDirectory, type ProjectTemplate } from "../../lib/tauri";
import type { ProjectData, ProjectListItem } from "../../lib/types";
import {
  loadRecentProjects,
  loadWorkspaceDir,
  rememberRecentProject,
  removeRecentProject,
  saveWorkspaceDir,
  sortProjectsByName,
  type RecentProject,
} from "../../lib/workspaceProjects";
import { getDesktopPlatform } from "../../lib/platform";
import { Button, IconButton } from "../common/Button";
import { ConfirmDialog } from "../common/Dialogs";
import { EmptyState } from "../common/EmptyState";

export interface ProjectOpenOptions {
  startBlankProjectGuide?: boolean;
}

export function projectOpenOptionsForCreatedTemplate(
  template: ProjectTemplate,
): ProjectOpenOptions | undefined {
  return template === "blank" ? { startBlankProjectGuide: true } : undefined;
}

interface Props {
  onOpen: (project: ProjectData, options?: ProjectOpenOptions) => void;
  canGoForward?: boolean;
  onForward?: () => void;
  onOpenSettings?: () => void;
}

type ProjectDirectoryResolution =
  | { kind: "project"; project: ProjectData }
  | { kind: "contained"; path: string; projects: ProjectListItem[] }
  | { kind: "initialize"; path: string };

export async function resolveProjectDirectory(
  path: string,
  operations: {
    open: (path: string) => Promise<ProjectData>;
    scan: (path: string) => Promise<ProjectListItem[]>;
  } = { open: openProject, scan: listProjects },
): Promise<ProjectDirectoryResolution> {
  try {
    return { kind: "project", project: await operations.open(path) };
  } catch (error) {
    if (!String(error).includes("缺少 gal.project.json")) throw error;
  }

  try {
    const projects = await operations.scan(path);
    if (projects.length > 0) return { kind: "contained", path, projects };
  } catch {
    // Discovery is guidance only; an unreadable directory keeps the safe existing prompt.
  }
  return { kind: "initialize", path };
}

export function ProjectList({ onOpen, canGoForward = false, onForward, onOpenSettings }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newProjectParent, setNewProjectParent] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectTemplate, setNewProjectTemplate] = useState<ProjectTemplate>("blank");
  const [initTarget, setInitTarget] = useState<string | null>(null);
  const [containedTarget, setContainedTarget] = useState<{
    path: string;
    projects: ProjectListItem[];
  } | null>(null);
  const [workspaceDir, setWorkspaceDir] = useState<string | null>(() => loadWorkspaceDir());
  const [workspaceProjects, setWorkspaceProjects] = useState<ProjectListItem[] | null>(null);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>(() => loadRecentProjects());

  const completeOpen = useCallback((project: ProjectData, options?: ProjectOpenOptions) => {
    setRecentProjects(rememberRecentProject(project));
    onOpen(project, options);
  }, [onOpen]);

  const openDirectory = useCallback(async (dir: string) => {
    const target = dir.trim();
    if (!target) {
      setError("先选择一个项目目录");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const resolution = await resolveProjectDirectory(target);
      if (resolution.kind === "project") {
        completeOpen(resolution.project);
      } else if (resolution.kind === "contained") {
        setContainedTarget({ path: resolution.path, projects: resolution.projects });
      } else {
        setInitTarget(resolution.path);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [completeOpen]);

  const openRecentProject = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      completeOpen(await openProject(path));
    } catch (openError) {
      setError(String(openError));
    } finally {
      setLoading(false);
    }
  }, [completeOpen]);

  const confirmInitialize = useCallback(async () => {
    if (!initTarget) return;
    setLoading(true);
    setError(null);
    try {
      completeOpen(await initializeProject(initTarget));
    } catch (initError) {
      setError(String(initError));
    } finally {
      setLoading(false);
      setInitTarget(null);
    }
  }, [completeOpen, initTarget]);

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

  const openNewProjectForm = useCallback((parentDir: string) => {
    setError(null);
    setNewProjectParent(parentDir);
    setNewProjectName("");
    setNewProjectTemplate("blank");
  }, []);

  const handleNew = async () => {
    const parentDir = await pickDirectory();
    if (!parentDir) return;
    openNewProjectForm(parentDir);
  };

  const handleCreateProject = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newProjectParent) return;
    const projectName = newProjectName.trim();
    if (!projectName) return;
    setLoading(true);
    setError(null);
    try {
      const created = await createProject(newProjectParent, projectName, newProjectTemplate);
      completeOpen(created, projectOpenOptionsForCreatedTemplate(newProjectTemplate));
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

        <section style={recentSectionStyle}>
          <div style={sectionHeadingStyle}>最近打开</div>
          {recentProjects.length === 0 ? (
            <div style={recentEmptyStyle}>打开或新建项目后会显示在这里。</div>
          ) : (
            <RecentProjectList
              items={recentProjects}
              disabled={loading}
              onOpen={(path) => void openRecentProject(path)}
              onRemove={(path) => setRecentProjects(removeRecentProject(path))}
            />
          )}
        </section>

        {workspaceDir && (
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
              <WorkspaceEmptyState
                disabled={loading}
                onCreate={() => openNewProjectForm(workspaceDir)}
              />
            ) : (
              <WorkspaceProjectList
                items={workspaceProjects}
                disabled={loading}
                onOpen={(path) => void openDirectory(path)}
              />
            )}
          </section>
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
            <ProjectTemplatePicker
              value={newProjectTemplate}
              disabled={loading}
              onChange={setNewProjectTemplate}
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
                  setNewProjectTemplate("blank");
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

      {containedTarget && (
        <ContainedProjectsDialog
          path={containedTarget.path}
          projects={containedTarget.projects}
          disabled={loading}
          onOpen={(path) => {
            setContainedTarget(null);
            void openDirectory(path);
          }}
          onInitialize={() => {
            setContainedTarget(null);
            setInitTarget(containedTarget.path);
          }}
          onClose={() => setContainedTarget(null)}
        />
      )}
    </div>
  );
}

export function WorkspaceEmptyState({
  disabled = false,
  onCreate,
}: {
  disabled?: boolean;
  onCreate: () => void;
}) {
  return (
    <EmptyState
      icon={FolderOpen}
      title="这个目录下还没有项目"
      description="在这个工作区新建项目，或把已有项目目录放进来。"
      action={(
        <Button variant="primary" onClick={onCreate} disabled={disabled}>
          <Plus size={15} />
          新建项目
        </Button>
      )}
    />
  );
}

export function ProjectTemplatePicker({
  value,
  disabled = false,
  onChange,
}: {
  value: ProjectTemplate;
  disabled?: boolean;
  onChange: (template: ProjectTemplate) => void;
}) {
  return (
    <fieldset style={templateFieldsetStyle} disabled={disabled}>
      <legend style={templateLegendStyle}>从哪里开始</legend>
      <label style={templateOptionStyle}>
        <input
          type="radio"
          name="project-template"
          value="blank"
          checked={value === "blank"}
          onChange={() => onChange("blank")}
        />
        <span>
          <strong style={templateTitleStyle}>空白项目</strong>
          <span style={templateDescriptionStyle}>从一个起始节点开始写自己的故事。</span>
        </span>
      </label>
      <label style={templateOptionStyle}>
        <input
          type="radio"
          name="project-template"
          value="example"
          checked={value === "example"}
          onChange={() => onChange("example")}
        />
        <span>
          <strong style={templateTitleStyle}>带示例</strong>
          <span style={templateDescriptionStyle}>包含可运行的分流、故事状态、结局与资源。</span>
        </span>
      </label>
    </fieldset>
  );
}

export function ContainedProjectsDialog({
  path,
  projects,
  disabled,
  onOpen,
  onInitialize,
  onClose,
}: {
  path: string;
  projects: ProjectListItem[];
  disabled: boolean;
  onOpen: (path: string) => void;
  onInitialize: () => void;
  onClose: () => void;
}) {
  return (
    <div className="gs-anim-fade" style={modalOverlayStyle}>
      <div className="gs-anim-pop" role="dialog" aria-modal="true" aria-labelledby="contained-projects-title" style={containedProjectsModalStyle}>
        <div id="contained-projects-title" style={modalHeaderStyle}>这个目录本身不是项目</div>
        <div style={containedProjectsDescriptionStyle}>
          里面有 {projects.length} 个项目。请选择要打开的项目，而不是把工作区目录初始化成嵌套项目。
        </div>
        <div style={parentPathStyle} title={path}>{path}</div>
        <WorkspaceProjectList items={projects} disabled={disabled} onOpen={onOpen} />
        <div style={containedProjectsSafetyStyle}>仍然初始化时，只会添加工程文件，不会删除或覆盖现有文件。</div>
        <div style={containedProjectsActionsStyle}>
          <Button variant="ghost" disabled={disabled} onClick={onInitialize}>仍然在此目录初始化</Button>
          <Button variant="secondary" disabled={disabled} onClick={onClose}>取消</Button>
        </div>
      </div>
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

export function RecentProjectList({
  items,
  disabled = false,
  onOpen,
  onRemove,
}: {
  items: RecentProject[];
  disabled?: boolean;
  onOpen: (path: string) => void;
  onRemove: (path: string) => void;
}) {
  return (
    <ul style={projectListStyle}>
      {items.map((item) => (
        <li key={item.path} style={recentProjectListItemStyle}>
          <button
            type="button"
            className="gs-list-row"
            style={recentProjectOpenStyle}
            disabled={disabled}
            onClick={() => onOpen(item.path)}
          >
            <span style={projectNameStyle}>{item.name}</span>
            <span style={projectPathStyle}>{item.path}</span>
            <span style={recentTimeStyle}>最后打开：{formatRecentProjectOpenedAt(item.lastOpenedAt)}</span>
          </button>
          <IconButton
            aria-label="从最近打开中移除"
            title="从最近打开中移除"
            disabled={disabled}
            onClick={() => onRemove(item.path)}
            style={recentRemoveStyle}
          >
            <X size={15} />
          </IconButton>
        </li>
      ))}
    </ul>
  );
}

export function formatRecentProjectOpenedAt(value: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    ...(timeZone ? { timeZone } : {}),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
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
const recentSectionStyle: React.CSSProperties = { marginBottom: "var(--space-5)" };
const sectionHeadingStyle: React.CSSProperties = {
  fontSize: "var(--text-sm)",
  fontWeight: 600,
  color: "var(--text-secondary)",
  marginBottom: "var(--space-3)",
};
const recentEmptyStyle: React.CSSProperties = {
  padding: "var(--space-4)",
  background: "var(--bg-inset)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  color: "var(--text-muted)",
  fontSize: "var(--text-sm)",
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
const recentProjectListItemStyle: React.CSSProperties = {
  position: "relative",
  display: "flex",
  alignItems: "stretch",
};
const recentProjectOpenStyle: React.CSSProperties = { paddingRight: "var(--space-12)" };
const projectNameStyle: React.CSSProperties = { fontSize: "var(--text-md)", fontWeight: 600, color: "var(--text-bright)" };
const projectPathStyle: React.CSSProperties = {
  minWidth: 0,
  fontSize: "var(--text-sm)",
  color: "var(--text-muted)",
  overflowWrap: "anywhere",
};
const recentTimeStyle: React.CSSProperties = { fontSize: "var(--text-xs)", color: "var(--text-muted)" };
const recentRemoveStyle: React.CSSProperties = {
  position: "absolute",
  top: "var(--space-2)",
  right: "var(--space-2)",
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
const containedProjectsModalStyle: React.CSSProperties = {
  ...modalStyle,
  width: "min(620px, 100%)",
};
const containedProjectsDescriptionStyle: React.CSSProperties = {
  color: "var(--text-secondary)",
  lineHeight: 1.6,
  marginBottom: "var(--space-2)",
};
const containedProjectsSafetyStyle: React.CSSProperties = {
  color: "var(--text-muted)",
  fontSize: "var(--text-sm)",
  lineHeight: 1.5,
  marginTop: "var(--space-3)",
};
const containedProjectsActionsStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "var(--space-2)",
  marginTop: "var(--space-4)",
};
const modalHeaderStyle: React.CSSProperties = { fontSize: "var(--text-lg)", fontWeight: 600, marginBottom: "var(--space-2)" };
const parentPathStyle: React.CSSProperties = {
  minWidth: 0,
  marginBottom: "var(--space-3)",
  fontSize: "var(--text-sm)",
  color: "var(--text-muted)",
  overflowWrap: "anywhere",
};
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
const templateFieldsetStyle: React.CSSProperties = {
  border: 0,
  padding: 0,
  margin: "var(--space-4) 0 0",
  display: "grid",
  gap: "var(--space-2)",
};
const templateLegendStyle: React.CSSProperties = {
  padding: 0,
  marginBottom: "var(--space-2)",
  color: "var(--text-secondary)",
  fontSize: "var(--text-sm)",
  fontWeight: 600,
};
const templateOptionStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto minmax(0, 1fr)",
  alignItems: "start",
  gap: "var(--space-2)",
  padding: "var(--space-3)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
};
const templateTitleStyle: React.CSSProperties = {
  display: "block",
  color: "var(--text-primary)",
  fontSize: "var(--text-sm)",
};
const templateDescriptionStyle: React.CSSProperties = {
  display: "block",
  marginTop: 2,
  color: "var(--text-muted)",
  fontSize: "var(--text-xs)",
  lineHeight: 1.5,
};
const modalActionsStyle: React.CSSProperties = { display: "flex", justifyContent: "flex-end", gap: "var(--space-2)", marginTop: "var(--space-4)" };
const errorStyle: React.CSSProperties = {
  padding: "var(--space-2) var(--space-3)", background: "var(--bg-error-soft)", border: "1px solid var(--border-error)",
  borderRadius: "var(--radius-sm)", color: "var(--status-error-text)", fontSize: "var(--text-base)", marginBottom: "var(--space-4)", whiteSpace: "pre-wrap",
};
const modalErrorStyle: React.CSSProperties = { ...errorStyle, marginTop: "var(--space-3)", marginBottom: 0 };
const workspaceSkeletonStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: "var(--space-2)" };
