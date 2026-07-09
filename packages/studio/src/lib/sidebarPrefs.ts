export interface SidebarPrefs {
  renderSidebarCollapsed: boolean;
  assetsSidebarCollapsed: boolean;
  scriptOutlineCollapsed: boolean;
}

export type SidebarPrefKey = keyof SidebarPrefs;

export interface SidebarPrefsStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export const SIDEBAR_PREFS_STORAGE_KEY = "vibegal.sidebarPrefs.v1";

export const DEFAULT_SIDEBAR_PREFS: SidebarPrefs = {
  renderSidebarCollapsed: false,
  assetsSidebarCollapsed: false,
  scriptOutlineCollapsed: false,
};

export function loadSidebarPrefs(storage = browserLocalStorage()): SidebarPrefs {
  if (!storage) return { ...DEFAULT_SIDEBAR_PREFS };

  try {
    const raw = storage.getItem(SIDEBAR_PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SIDEBAR_PREFS };
    return normalizeSidebarPrefs(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SIDEBAR_PREFS };
  }
}

export function saveSidebarPrefs(
  prefs: SidebarPrefs,
  storage = browserLocalStorage(),
): SidebarPrefs {
  if (!storage) return prefs;

  try {
    storage.setItem(SIDEBAR_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage failure should not block the workspace interaction itself.
  }

  return prefs;
}

export function updateSidebarPref(
  key: SidebarPrefKey,
  collapsed: boolean,
  storage = browserLocalStorage(),
): SidebarPrefs {
  const next = { ...loadSidebarPrefs(storage), [key]: collapsed };
  return saveSidebarPrefs(next, storage);
}

function browserLocalStorage(): SidebarPrefsStorage | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

function normalizeSidebarPrefs(value: unknown): SidebarPrefs {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_SIDEBAR_PREFS };
  }

  const maybePrefs = value as Partial<Record<SidebarPrefKey, unknown>>;
  return {
    renderSidebarCollapsed: boolOrDefault(maybePrefs.renderSidebarCollapsed, DEFAULT_SIDEBAR_PREFS.renderSidebarCollapsed),
    assetsSidebarCollapsed: boolOrDefault(maybePrefs.assetsSidebarCollapsed, DEFAULT_SIDEBAR_PREFS.assetsSidebarCollapsed),
    scriptOutlineCollapsed: boolOrDefault(maybePrefs.scriptOutlineCollapsed, DEFAULT_SIDEBAR_PREFS.scriptOutlineCollapsed),
  };
}

function boolOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}
