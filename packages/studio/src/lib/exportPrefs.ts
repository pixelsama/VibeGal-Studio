import type { DesktopRuntime } from "./tauri";

/**
 * 导出工作台的每项目偏好（localStorage 持久化）。
 * 只记用户显式改过的选项；空串字段表示「跟随默认」：
 * - customOutDir 为空：输出目录跟随 runtime 的默认推导（<项目>/dist/desktop-<runtime>）
 * - rendererId 为空：跟随项目的 activeRendererId
 */
export interface ExportPrefs {
  runtime: DesktopRuntime;
  customOutDir: string;
  rendererId: string;
  strict: boolean;
  allowWarnings: boolean;
}

export interface ExportPrefsStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export const EXPORT_PREFS_STORAGE_KEY = "vibegal.exportPrefs.v1";

export const DEFAULT_EXPORT_PREFS: ExportPrefs = {
  runtime: "electron",
  customOutDir: "",
  rendererId: "",
  strict: false,
  allowWarnings: false,
};

interface ExportPrefsFile {
  projects: Record<string, ExportPrefs>;
}

export function loadExportPrefs(
  projectPath: string,
  storage = browserLocalStorage(),
): ExportPrefs {
  if (!storage) return { ...DEFAULT_EXPORT_PREFS };

  try {
    const raw = storage.getItem(EXPORT_PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_EXPORT_PREFS };
    const file = JSON.parse(raw) as Partial<ExportPrefsFile> | null;
    const entry = file?.projects?.[projectPath];
    return normalizeExportPrefs(entry);
  } catch {
    return { ...DEFAULT_EXPORT_PREFS };
  }
}

export function saveExportPrefs(
  projectPath: string,
  prefs: ExportPrefs,
  storage = browserLocalStorage(),
): ExportPrefs {
  if (!storage) return prefs;

  try {
    const raw = storage.getItem(EXPORT_PREFS_STORAGE_KEY);
    const file = raw ? (JSON.parse(raw) as Partial<ExportPrefsFile>) : null;
    const projects =
      file && typeof file === "object" && file.projects && typeof file.projects === "object"
        ? { ...file.projects }
        : {};
    projects[projectPath] = normalizeExportPrefs(prefs);
    storage.setItem(
      EXPORT_PREFS_STORAGE_KEY,
      JSON.stringify({ projects } satisfies ExportPrefsFile),
    );
  } catch {
    // 持久化失败不阻塞导出交互本身
  }

  return prefs;
}

function browserLocalStorage(): ExportPrefsStorage | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

function normalizeExportPrefs(value: unknown): ExportPrefs {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_EXPORT_PREFS };
  }

  const maybe = value as Partial<Record<keyof ExportPrefs, unknown>>;
  return {
    runtime: maybe.runtime === "tauri" ? "tauri" : "electron",
    customOutDir: typeof maybe.customOutDir === "string" ? maybe.customOutDir : "",
    rendererId: typeof maybe.rendererId === "string" ? maybe.rendererId : "",
    strict: typeof maybe.strict === "boolean" ? maybe.strict : false,
    allowWarnings: typeof maybe.allowWarnings === "boolean" ? maybe.allowWarnings : false,
  };
}
