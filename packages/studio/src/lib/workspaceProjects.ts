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
