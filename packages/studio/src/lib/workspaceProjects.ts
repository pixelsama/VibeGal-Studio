/**
 * 项目入口页的工作区目录记忆。
 *
 * 「工作区目录」= 包含多个项目的共同父目录（list_projects 扫描它的直接子目录）。
 * 记住用户上次浏览的工作区目录，下次启动直接列出其中的项目。
 * 与项目数据无关，存 localStorage 即可（参照 sidebarPrefs 的模式）。
 */
import type { ProjectListItem } from "./types";

export interface WorkspaceDirStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export const WORKSPACE_DIR_STORAGE_KEY = "vibegal.workspaceDir.v1";
export const RECENT_PROJECTS_STORAGE_KEY = "vibegal.recentProjects.v1";
export const MAX_RECENT_PROJECTS = 10;

export interface RecentProject {
  path: string;
  name: string;
  lastOpenedAt: string;
}

export function loadWorkspaceDir(storage = browserLocalStorage()): string | null {
  if (!storage) return null;

  try {
    const raw = storage.getItem(WORKSPACE_DIR_STORAGE_KEY);
    return raw && raw.trim() ? raw : null;
  } catch {
    return null;
  }
}

export function saveWorkspaceDir(dir: string, storage = browserLocalStorage()): void {
  if (!storage) return;

  try {
    storage.setItem(WORKSPACE_DIR_STORAGE_KEY, dir);
  } catch {
    // 记忆失败不应阻塞打开项目的流程。
  }
}

export function loadRecentProjects(storage = browserLocalStorage()): RecentProject[] {
  if (!storage) return [];

  try {
    const raw = storage.getItem(RECENT_PROJECTS_STORAGE_KEY);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];

    const seenPaths = new Set<string>();
    return value
      .filter(isRecentProject)
      .sort((a, b) => Date.parse(b.lastOpenedAt) - Date.parse(a.lastOpenedAt))
      .filter((item) => {
        if (seenPaths.has(item.path)) return false;
        seenPaths.add(item.path);
        return true;
      })
      .slice(0, MAX_RECENT_PROJECTS);
  } catch {
    return [];
  }
}

export function rememberRecentProject(
  project: ProjectListItem,
  openedAt = new Date(),
  storage = browserLocalStorage(),
): RecentProject[] {
  const item: RecentProject = {
    path: project.path,
    name: project.meta.name,
    lastOpenedAt: openedAt.toISOString(),
  };
  const next = [
    item,
    ...loadRecentProjects(storage).filter((recent) => recent.path !== item.path),
  ].slice(0, MAX_RECENT_PROJECTS);
  saveRecentProjects(next, storage);
  return next;
}

export function removeRecentProject(
  path: string,
  storage = browserLocalStorage(),
): RecentProject[] {
  const next = loadRecentProjects(storage).filter((item) => item.path !== path);
  saveRecentProjects(next, storage);
  return next;
}

/** 项目列表按显示名排序（同名按路径兜底），不改动入参数组。 */
export function sortProjectsByName(items: ProjectListItem[]): ProjectListItem[] {
  return [...items].sort(
    (a, b) => a.meta.name.localeCompare(b.meta.name, "zh-Hans-CN") || a.path.localeCompare(b.path),
  );
}

function browserLocalStorage(): WorkspaceDirStorage | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

function saveRecentProjects(items: RecentProject[], storage: WorkspaceDirStorage | null): void {
  if (!storage) return;

  try {
    storage.setItem(RECENT_PROJECTS_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Recent-project history must never block opening or creating a project.
  }
}

function isRecentProject(value: unknown): value is RecentProject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<RecentProject>;
  return typeof item.path === "string"
    && item.path.trim().length > 0
    && typeof item.name === "string"
    && item.name.trim().length > 0
    && typeof item.lastOpenedAt === "string"
    && Number.isFinite(Date.parse(item.lastOpenedAt));
}
