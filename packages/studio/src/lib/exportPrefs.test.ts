import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_EXPORT_PREFS,
  EXPORT_PREFS_STORAGE_KEY,
  loadExportPrefs,
  saveExportPrefs,
  type ExportPrefsStorage,
} from "./exportPrefs";

function makeStorage(initial: Record<string, string> = {}): ExportPrefsStorage & { data: Record<string, string> } {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe("loadExportPrefs", () => {
  it("无存储数据时返回默认偏好", () => {
    expect(loadExportPrefs("/project", makeStorage())).toEqual(DEFAULT_EXPORT_PREFS);
  });

  it("读取指定项目的偏好，其他项目不受影响", () => {
    const storage = makeStorage({
      [EXPORT_PREFS_STORAGE_KEY]: JSON.stringify({
        projects: {
          "/project": { runtime: "tauri", customOutDir: "D:/release", rendererId: "mobile", strict: true, allowWarnings: true },
          "/other": { runtime: "electron", customOutDir: "", rendererId: "", strict: false, allowWarnings: false },
        },
      }),
    });

    expect(loadExportPrefs("/project", storage)).toEqual({
      runtime: "tauri",
      customOutDir: "D:/release",
      rendererId: "mobile",
      strict: true,
      allowWarnings: true,
    });
    expect(loadExportPrefs("/missing", storage)).toEqual(DEFAULT_EXPORT_PREFS);
  });

  it("损坏的 JSON 回退到默认偏好", () => {
    const storage = makeStorage({ [EXPORT_PREFS_STORAGE_KEY]: "{not json" });
    expect(loadExportPrefs("/project", storage)).toEqual(DEFAULT_EXPORT_PREFS);
  });

  it("字段类型不合法时逐字段回退", () => {
    const storage = makeStorage({
      [EXPORT_PREFS_STORAGE_KEY]: JSON.stringify({
        projects: {
          "/project": { runtime: "wine", customOutDir: 42, strict: "yes", allowWarnings: true },
        },
      }),
    });

    expect(loadExportPrefs("/project", storage)).toEqual({
      ...DEFAULT_EXPORT_PREFS,
      allowWarnings: true,
    });
  });
});

describe("saveExportPrefs", () => {
  it("写入指定项目的偏好并保留其他项目", () => {
    const storage = makeStorage({
      [EXPORT_PREFS_STORAGE_KEY]: JSON.stringify({
        projects: {
          "/other": { runtime: "tauri", customOutDir: "", rendererId: "", strict: false, allowWarnings: false },
        },
      }),
    });

    saveExportPrefs("/project", { ...DEFAULT_EXPORT_PREFS, customOutDir: "D:/out" }, storage);

    const saved = JSON.parse(storage.data[EXPORT_PREFS_STORAGE_KEY]);
    expect(saved.projects["/project"].customOutDir).toBe("D:/out");
    expect(saved.projects["/other"].runtime).toBe("tauri");
  });

  it("存储抛错时不阻塞调用方", () => {
    const storage: ExportPrefsStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };

    expect(() => saveExportPrefs("/project", DEFAULT_EXPORT_PREFS, storage)).not.toThrow();
    expect(loadExportPrefs("/project", storage)).toEqual(DEFAULT_EXPORT_PREFS);
  });

  it("保存时规范化非法字段", () => {
    const storage = makeStorage();
    const dirty = { ...DEFAULT_EXPORT_PREFS, runtime: "plan9" } as unknown as Parameters<typeof saveExportPrefs>[1];
    saveExportPrefs("/project", dirty, storage);
    expect(loadExportPrefs("/project", storage).runtime).toBe("electron");
  });
});

describe("browser localStorage 缺失", () => {
  it("localStorage 不可用时读写都安全回退", () => {
    vi.stubGlobal("localStorage", undefined);
    try {
      expect(loadExportPrefs("/project")).toEqual(DEFAULT_EXPORT_PREFS);
      expect(() => saveExportPrefs("/project", DEFAULT_EXPORT_PREFS)).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
