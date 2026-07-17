import { describe, expect, it, vi } from "vitest";
import {
  loadWorkspaceDir,
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

describe("sortProjectsByName", () => {
  it("sorts by display name and falls back to path, without mutating the input", () => {
    const items = [project("Beta", "/ws/b"), project("Alpha", "/ws/a"), project("Alpha", "/ws/a0")];
    const sorted = sortProjectsByName(items);
    expect(sorted.map((item) => item.path)).toEqual(["/ws/a", "/ws/a0", "/ws/b"]);
    expect(items[0].meta.name).toBe("Beta");
  });
});
