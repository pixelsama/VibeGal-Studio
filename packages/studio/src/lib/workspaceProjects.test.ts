import { describe, expect, it, vi } from "vitest";
import {
  loadRecentProjects,
  loadWorkspaceDir,
  RECENT_PROJECTS_STORAGE_KEY,
  rememberRecentProject,
  removeRecentProject,
  saveWorkspaceDir,
  sortProjectsByName,
  WORKSPACE_DIR_STORAGE_KEY,
} from "./workspaceProjects";
import type { ProjectListItem } from "./types";

class MemoryStorage {
  readonly data = new Map<string, string>();
  readonly getItem = vi.fn((key: string) => this.data.get(key) ?? null);
  readonly setItem = vi.fn((key: string, value: string) => {
    this.data.set(key, value);
  });
}

function project(name: string, path: string): ProjectListItem {
  return { path, meta: { name, activeRendererId: "default", createdAt: "0" } };
}

describe("workspaceDir persistence", () => {
  it("returns null when nothing is remembered", () => {
    expect(loadWorkspaceDir(new MemoryStorage())).toBeNull();
  });

  it("round-trips the remembered workspace directory", () => {
    const storage = new MemoryStorage();
    saveWorkspaceDir("/ws/novels", storage);
    expect(storage.setItem).toHaveBeenCalledWith(WORKSPACE_DIR_STORAGE_KEY, "/ws/novels");
    expect(loadWorkspaceDir(storage)).toBe("/ws/novels");
  });

  it("treats blank or unreadable values as absent", () => {
    const storage = new MemoryStorage();
    storage.data.set(WORKSPACE_DIR_STORAGE_KEY, "   ");
    expect(loadWorkspaceDir(storage)).toBeNull();

    const throwing = {
      getItem: vi.fn(() => {
        throw new Error("denied");
      }),
      setItem: vi.fn(),
    };
    expect(loadWorkspaceDir(throwing)).toBeNull();
  });

  it("does not throw when persistence fails", () => {
    const throwing = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new Error("denied");
      }),
    };
    expect(() => saveWorkspaceDir("/ws/novels", throwing)).not.toThrow();
  });
});

describe("recent project persistence", () => {
  it("returns an empty list for absent or malformed data", () => {
    const storage = new MemoryStorage();
    expect(loadRecentProjects(storage)).toEqual([]);

    storage.data.set(RECENT_PROJECTS_STORAGE_KEY, "not json");
    expect(loadRecentProjects(storage)).toEqual([]);

    storage.data.set(RECENT_PROJECTS_STORAGE_KEY, JSON.stringify([{ path: 42 }]));
    expect(loadRecentProjects(storage)).toEqual([]);
  });

  it("records a successfully opened project", () => {
    const storage = new MemoryStorage();
    const openedAt = new Date("2026-07-22T07:30:00.000Z");

    const recent = rememberRecentProject(project("Alpha", "/ws/alpha"), openedAt, storage);

    expect(recent).toEqual([{
      path: "/ws/alpha",
      name: "Alpha",
      lastOpenedAt: "2026-07-22T07:30:00.000Z",
    }]);
    expect(loadRecentProjects(storage)).toEqual(recent);
  });

  it("deduplicates by path and moves the updated project to the front", () => {
    const storage = new MemoryStorage();
    rememberRecentProject(project("Old name", "/ws/alpha"), new Date("2026-07-20T00:00:00.000Z"), storage);
    rememberRecentProject(project("Beta", "/ws/beta"), new Date("2026-07-21T00:00:00.000Z"), storage);

    const recent = rememberRecentProject(
      project("New name", "/ws/alpha"),
      new Date("2026-07-22T00:00:00.000Z"),
      storage,
    );

    expect(recent.map((item) => item.path)).toEqual(["/ws/alpha", "/ws/beta"]);
    expect(recent[0]).toEqual({
      path: "/ws/alpha",
      name: "New name",
      lastOpenedAt: "2026-07-22T00:00:00.000Z",
    });
  });

  it("keeps only the ten most recently opened projects", () => {
    const storage = new MemoryStorage();
    for (let index = 0; index < 12; index += 1) {
      rememberRecentProject(
        project(`Project ${index}`, `/ws/${index}`),
        new Date(Date.UTC(2026, 6, index + 1)),
        storage,
      );
    }

    const recent = loadRecentProjects(storage);
    expect(recent).toHaveLength(10);
    expect(recent[0].path).toBe("/ws/11");
    expect(recent.at(-1)?.path).toBe("/ws/2");
  });

  it("removes only the requested project", () => {
    const storage = new MemoryStorage();
    rememberRecentProject(project("Alpha", "/ws/alpha"), new Date("2026-07-20T00:00:00.000Z"), storage);
    rememberRecentProject(project("Beta", "/ws/beta"), new Date("2026-07-21T00:00:00.000Z"), storage);

    expect(removeRecentProject("/ws/beta", storage)).toEqual([{
      path: "/ws/alpha",
      name: "Alpha",
      lastOpenedAt: "2026-07-20T00:00:00.000Z",
    }]);
    expect(loadRecentProjects(storage).map((item) => item.path)).toEqual(["/ws/alpha"]);
  });

  it("does not throw when recent-project storage is unavailable", () => {
    const throwing = {
      getItem: vi.fn(() => {
        throw new Error("denied");
      }),
      setItem: vi.fn(() => {
        throw new Error("denied");
      }),
    };

    expect(() => loadRecentProjects(throwing)).not.toThrow();
    expect(() => rememberRecentProject(project("Alpha", "/ws/alpha"), new Date(), throwing)).not.toThrow();
    expect(() => removeRecentProject("/ws/alpha", throwing)).not.toThrow();
  });
});

describe("sortProjectsByName", () => {
  it("sorts by display name and falls back to path, without mutating the input", () => {
    const items = [project("Beta", "/ws/b"), project("Alpha", "/ws/a"), project("Alpha", "/ws/a0")];
    const sorted = sortProjectsByName(items);
    expect(sorted.map((item) => item.path)).toEqual(["/ws/a", "/ws/a0", "/ws/b"]);
    expect(items[0].meta.name).toBe("Beta");
  });
});
