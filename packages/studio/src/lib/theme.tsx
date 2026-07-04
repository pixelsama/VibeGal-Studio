/**
 * 主题与应用设置。
 *
 * - 设置持久化走 Tauri 后端（load_app_settings / save_app_settings），
 *   存到 app config 目录的 settings.json，符合「所有磁盘读写集中在 Rust」约定。
 * - 主题通过 CSS 变量实现：applyTheme() 在 <html> 上设 data-theme，
 *   index.css 里 :root / [data-theme="light"] 定义两套变量值。
 * - useAppSettings() 在 App 顶层调用，加载后再渲染主界面，避免主题未就绪时先画出整套 chrome。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { loadAppSettings, saveAppSettings } from "./tauri";

export type ThemeMode = "dark" | "light";

export interface AppSettings {
  theme: ThemeMode;
}

export const DEFAULT_SETTINGS: AppSettings = { theme: "dark" };

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

/** 把主题模式应用到 <html data-theme>。CSS 变量据此切换。 */
export function applyTheme(mode: ThemeMode): void {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = mode;
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
        applyTheme(loaded.theme);
      })
      .catch((e) => {
        // 后端读取失败（首次运行无文件等）—— 用默认值
        console.warn("加载应用设置失败，使用默认值:", e);
        if (active && !userUpdatedRef.current) applyTheme(DEFAULT_SETTINGS.theme);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const updateSettings = useCallback(
    (next: Partial<AppSettings>) => {
      const merged: AppSettings = { ...settingsRef.current, ...next };
      userUpdatedRef.current = true;
      settingsRef.current = merged;
      setSettings(merged);
      applyTheme(merged.theme);
      return saverRef.current?.requestSave(merged) ?? Promise.resolve();
    },
    [],
  );

  return { settings, loading, updateSettings };
}
