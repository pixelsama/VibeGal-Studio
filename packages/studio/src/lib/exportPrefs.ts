import type { DesktopRuntime } from "./tauri";

export type ExportTarget = "web" | "desktop";

/**
 * 构建警告策略（Spec 33 E9）：把「将警告视为错误」与「仍然允许警告」
 * 两个相互矛盾的复选框合并为单一策略。
 * - block：存在警告时阻止构建（等价旧 strict=true 且 allowWarnings=false）
 * - allow：警告仅提示，不阻止构建（旧版其余组合的净效果）
 */
export type WarningPolicy = "block" | "allow";

/**
 * 导出工作台的每项目偏好（localStorage 持久化）。
 * 空串目录表示跟随目标默认值：Web 为 dist/web，桌面为 dist/desktop-<runtime>。
 * 两种目标各记一份目录，切换目标不会覆盖另一种目标的发布位置。
 */
export interface ExportPrefs {
  target: ExportTarget;
  runtime: DesktopRuntime;
  webCustomOutDir: string;
  desktopCustomOutDir: string;
  warningPolicy: WarningPolicy;
}

export interface ExportPrefsStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export const EXPORT_PREFS_STORAGE_KEY = "vibegal.exportPrefs.v1";

export const DEFAULT_EXPORT_PREFS: ExportPrefs = {
  target: "desktop",
  runtime: "electron",
  webCustomOutDir: "",
  desktopCustomOutDir: "",
  warningPolicy: "allow",
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

  const maybe = value as Record<string, unknown>;
  return {
    // v1 的桌面专用偏好没有 target，迁移时保持原有桌面行为。
    target: maybe.target === "web" ? "web" : "desktop",
    runtime: maybe.runtime === "tauri" ? "tauri" : "electron",
    webCustomOutDir: typeof maybe.webCustomOutDir === "string" ? maybe.webCustomOutDir : "",
    desktopCustomOutDir: typeof maybe.desktopCustomOutDir === "string"
      ? maybe.desktopCustomOutDir
      : typeof maybe.customOutDir === "string"
        ? maybe.customOutDir
        : "",
    // 旧版双复选框迁移：strict=true 且 allowWarnings=false 才等同于 block，
    // 其余组合（含 strict + allowWarnings 同时开启）的净效果都是 allow。
    warningPolicy: maybe.warningPolicy === "block"
      ? "block"
      : maybe.warningPolicy === "allow"
        ? "allow"
        : typeof maybe.strict === "boolean" && maybe.strict === true && maybe.allowWarnings === false
          ? "block"
          : "allow",
  };
}
