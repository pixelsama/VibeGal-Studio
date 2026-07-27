import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ContainedProjectsDialog,
  formatRecentProjectOpenedAt,
  ProjectList,
  ProjectTemplatePicker,
  RecentProjectList,
  WorkspaceProjectList,
  resolveProjectDirectory,
} from "./ProjectList";
import type { ProjectData, ProjectListItem } from "../../lib/types";
import {
  RECENT_PROJECTS_STORAGE_KEY,
  WORKSPACE_DIR_STORAGE_KEY,
  type RecentProject,
} from "../../lib/workspaceProjects";

vi.mock("../../lib/tauri", () => ({
  createProject: vi.fn(),
  initializeProject: vi.fn(),
  openProject: vi.fn(),
  pickDirectory: vi.fn(),
  listProjects: vi.fn(),
}));

function project(name: string, path: string): ProjectListItem {
  return { path, meta: { name, activeRendererId: "default", createdAt: "0" } };
}

const openedProject = { path: "/ws/project" } as ProjectData;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProjectList entry page", () => {
  it("offers exactly one set of open/create/browse actions", () => {
    const html = renderToStaticMarkup(<ProjectList onOpen={() => {}} />);

    expect(html.match(/打开项目…/g)).toHaveLength(1);
    expect(html.match(/>新建项目<\/button>/g)).toHaveLength(1);
    expect(html.match(/浏览工作区…/g)).toHaveLength(1);
    expect(html).toContain("最近打开");
    expect(html).toContain("打开或新建项目后会显示在这里");
    expect(html).not.toContain("还没有打开的项目");
  });

  it("shows recent projects and workspace projects as separate sections", () => {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => {
        if (key === WORKSPACE_DIR_STORAGE_KEY) return "/ws";
        if (key === RECENT_PROJECTS_STORAGE_KEY) {
          return JSON.stringify([recentProject("Recent", "/other/recent")]);
        }
        return null;
      },
      setItem: vi.fn(),
    });

    const html = renderToStaticMarkup(<ProjectList onOpen={() => {}} />);

    expect(html).toContain("最近打开");
    expect(html).toContain("Recent");
    expect(html).toContain("工作区");
    expect(html).toContain("/ws");
  });
});

describe("ProjectTemplatePicker", () => {
  it("defaults creators to a blank project and explains the runnable example", () => {
    const html = renderToStaticMarkup(
      <ProjectTemplatePicker value="blank" onChange={() => {}} />,
    );

    expect(html).toContain("空白项目");
    expect(html).toContain("带示例");
    expect(html).toContain("可运行的分流、故事状态、结局与资源");
    expect(html).toMatch(/<input[^>]*checked=""[^>]*value="blank"/);
    expect(html).not.toMatch(/<input[^>]*checked=""[^>]*value="example"/);
  });
});

describe("RecentProjectList", () => {
  it("shows project details, local opened time, and an independent remove button", () => {
    const item = recentProject("Alpha", "/ws/alpha");
    const html = renderToStaticMarkup(
      <RecentProjectList items={[item]} onOpen={() => {}} onRemove={() => {}} />,
    );

    expect(html).toContain("Alpha");
    expect(html).toContain("/ws/alpha");
    expect(html).toContain("最后打开：");
    expect(html).toContain('aria-label="从最近打开中移除"');
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(formatRecentProjectOpenedAt(item.lastOpenedAt, "Asia/Shanghai")).toBe("2026/07/22 15:30");
  });
});

describe("WorkspaceProjectList", () => {
  it("lists projects sorted by name together with their paths", () => {
    const html = renderToStaticMarkup(
      <WorkspaceProjectList
        items={[project("Beta", "/ws/b"), project("Alpha", "/ws/a")]}
        onOpen={() => {}}
      />,
    );

    expect(html.indexOf("Alpha")).toBeLessThan(html.indexOf("Beta"));
    expect(html).toContain("/ws/a");
    expect(html).toContain("/ws/b");
  });
});

describe("resolveProjectDirectory", () => {
  it("returns an existing project without scanning its children", async () => {
    const scan = vi.fn();

    await expect(resolveProjectDirectory("/ws/project", {
      open: vi.fn().mockResolvedValue(openedProject),
      scan,
    })).resolves.toEqual({ kind: "project", project: openedProject });
    expect(scan).not.toHaveBeenCalled();
  });

  it("offers contained projects before initialization", async () => {
    const contained = [project("Alpha", "/ws/alpha"), project("Beta", "/ws/beta")];

    await expect(resolveProjectDirectory("/ws", {
      open: vi.fn().mockRejectedValue(new Error("不是 VibeGal-Studio 项目目录（缺少 gal.project.json）")),
      scan: vi.fn().mockResolvedValue(contained),
    })).resolves.toEqual({ kind: "contained", path: "/ws", projects: contained });
  });

  it("offers initialization when no child project exists", async () => {
    await expect(resolveProjectDirectory("/empty", {
      open: vi.fn().mockRejectedValue(new Error("缺少 gal.project.json")),
      scan: vi.fn().mockResolvedValue([]),
    })).resolves.toEqual({ kind: "initialize", path: "/empty" });
  });

  it("falls back to initialization when child scanning fails", async () => {
    await expect(resolveProjectDirectory("/private", {
      open: vi.fn().mockRejectedValue(new Error("缺少 gal.project.json")),
      scan: vi.fn().mockRejectedValue(new Error("access denied")),
    })).resolves.toEqual({ kind: "initialize", path: "/private" });
  });

  it("preserves unrelated open errors", async () => {
    await expect(resolveProjectDirectory("/broken", {
      open: vi.fn().mockRejectedValue(new Error("invalid manifest")),
      scan: vi.fn(),
    })).rejects.toThrow("invalid manifest");
  });
});

describe("ContainedProjectsDialog", () => {
  it("distinguishes a workspace directory and keeps initialization secondary", () => {
    const html = renderToStaticMarkup(
      <ContainedProjectsDialog
        path="/ws"
        projects={[project("Alpha", "/ws/alpha"), project("Beta", "/ws/beta")]}
        disabled={false}
        onOpen={() => {}}
        onInitialize={() => {}}
        onClose={() => {}}
      />,
    );

    expect(html).toContain("这个目录本身不是项目");
    expect(html).toContain("里面有 2 个项目");
    expect(html).toContain("Alpha");
    expect(html).toContain("Beta");
    expect(html).toContain("仍然在此目录初始化");
    expect(html).toContain("不会删除或覆盖现有文件");
  });
});

function recentProject(name: string, path: string): RecentProject {
  return { name, path, lastOpenedAt: "2026-07-22T07:30:00.000Z" };
}
