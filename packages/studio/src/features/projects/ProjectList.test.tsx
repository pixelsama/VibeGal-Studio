import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ProjectList, WorkspaceProjectList } from "./ProjectList";
import type { ProjectListItem } from "../../lib/types";

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
