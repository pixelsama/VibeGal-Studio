/**
 * 主题与应用设置。
 *
 * - 设置持久化走 Tauri 后端（load_app_settings / save_app_settings），
 *   存到 app config 目录的 settings.json，符合「所有磁盘读写集中在 Rust」约定。
 * - 主题通过 CSS 变量实现：applyTheme() 在 <html> 上设 data-theme，
 *   index.css 里 :root / [data-theme="light"] 定义两套变量值。
 * - useAppSettings() 在 App 顶层调用，加载后再渲染主界面，避免主题未就绪时先画出整套 chrome。
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { loadAppSettings, saveAppSettings } from "./tauri";

export type ThemeMode = "system" | "dark" | "light";
export type ResolvedTheme = "dark" | "light";

export interface AppSettings {
  theme: ThemeMode;
}

export const DEFAULT_SETTINGS: AppSettings = { theme: "system" };

export interface LatestSettingsSaver {
  requestSave: (settings: AppSettings) => Promise<void>;
}

/**
 * 串行保存设置，并在前一次保存进行中时只保留最新请求。
 * 这样快速切换主题时，最终落盘的一定是最后一次选择。
 */
export function createLatestSettingsSaver(
  save: (settings: AppSettings) => Promise<void>,
  onError: (error: unknown) => void,
): LatestSettingsSaver {
  let queued: AppSettings | null = null;
  let running: Promise<void> | null = null;

  const drain = async () => {
    while (queued) {
      const next = queued;
      queued = null;
      try {
        await save(next);
      } catch (error) {
        onError(error);
      }
    }
  };

  return {
    requestSave(settings) {
      queued = settings;
      if (!running) {
        running = drain().finally(() => {
          running = null;
        });
      }
      return running;
    },
  };
}

function getSystemThemeMediaQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return null;
  }
  return window.matchMedia("(prefers-color-scheme: dark)");
}

/** 读取当前系统配色偏好。 */
export function getSystemTheme(): ResolvedTheme {
  const media = getSystemThemeMediaQuery();
  if (!media) return "dark";
  return media.matches ? "dark" : "light";
}

/** 把设置模式解析为实际应用的主题。 */
export function resolveTheme(mode: ThemeMode, systemTheme: ResolvedTheme = getSystemTheme()): ResolvedTheme {
  return mode === "system" ? systemTheme : mode;
}

/** 从 <html data-theme> 的属性值解析主题（applyTheme 写入的总是已解析值）。 */
export function themeFromAttribute(value: string | null | undefined): ResolvedTheme {
  return value === "light" ? "light" : "dark";
}

function readDocumentTheme(): ResolvedTheme {
  if (typeof document === "undefined") return "dark";
  return themeFromAttribute(document.documentElement.dataset.theme);
}

function subscribeDocumentTheme(onChange: () => void): () => void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return () => {};
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

/**
 * 订阅当前已应用的主题（<html data-theme>，由 App 顶层的 useAppSettings 维护）。
 * 供深层组件（如 React Flow 画布的 colorMode）跟随主题切换，无需层层传 props。
 */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribeDocumentTheme, readDocumentTheme, readDocumentTheme);
}

/** 订阅系统配色偏好变化。 */
export function subscribeSystemThemeChanges(onChange: () => void): () => void {
  const media = getSystemThemeMediaQuery();
  if (!media) return () => {};

  const handler = () => onChange();
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }
  const legacyMedia = media as MediaQueryList & {
    addListener?: (listener: () => void) => void;
    removeListener?: (listener: () => void) => void;
  };
  if (typeof legacyMedia.addListener === "function" && typeof legacyMedia.removeListener === "function") {
    legacyMedia.addListener(handler);
    return () => legacyMedia.removeListener(handler);
  }
  return () => {};
}

function useSystemTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribeSystemThemeChanges, getSystemTheme, () => "dark");
}

/** 把主题模式应用到 <html data-theme>。CSS 变量据此切换。 */
export function applyTheme(mode: ThemeMode, systemTheme: ResolvedTheme = getSystemTheme()): void {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = resolveTheme(mode, systemTheme);
  }
}

export interface UseAppSettingsResult {
  settings: AppSettings;
  loading: boolean;
  /** 更新设置：立即应用主题 + 持久化到后端 + 刷新本地 state */
  updateSettings: (next: Partial<AppSettings>) => Promise<void>;
}

/**
 * 加载并管理应用设置。
 * 初始化时从后端读取并应用主题；后续 updateSettings 同步到后端。
 */
export function useAppSettings(): UseAppSettingsResult {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const settingsRef = useRef<AppSettings>(DEFAULT_SETTINGS);
  const userUpdatedRef = useRef(false);
  const saverRef = useRef<LatestSettingsSaver | null>(null);
  const systemTheme = useSystemTheme();
  const resolvedTheme = resolveTheme(settings.theme, systemTheme);

  if (!saverRef.current) {
    saverRef.current = createLatestSettingsSaver(saveAppSettings, (error) => {
      console.warn("保存应用设置失败:", error);
    });
  }

  useEffect(() => {
    let active = true;
    loadAppSettings()
      .then((loaded) => {
        if (!active || userUpdatedRef.current) return;
        settingsRef.current = loaded;
        setSettings(loaded);
      })
      .catch((e) => {
        // 后端读取失败（首次运行无文件等）—— 用默认值
        console.warn("加载应用设置失败，使用默认值:", e);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  const updateSettings = useCallback(
    (next: Partial<AppSettings>) => {
      const merged: AppSettings = { ...settingsRef.current, ...next };
      userUpdatedRef.current = true;
      settingsRef.current = merged;
      setSettings(merged);
      return saverRef.current?.requestSave(merged) ?? Promise.resolve();
    },
    [],
  );

  return { settings, loading, updateSettings };
}
