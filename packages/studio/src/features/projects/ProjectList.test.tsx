import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ContainedProjectsDialog,
  ProjectList,
  WorkspaceProjectList,
  resolveProjectDirectory,
} from "./ProjectList";
import type { ProjectData, ProjectListItem } from "../../lib/types";

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

describe("ProjectList entry page", () => {
  it("offers open/create/browse actions with guidance when no workspace is remembered", () => {
    const html = renderToStaticMarkup(<ProjectList onOpen={() => {}} />);

    expect(html).toContain("打开项目");
    expect(html).toContain("新建项目");
    expect(html).toContain("浏览工作区");
    expect(html).toContain("工作区目录");
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
