import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SIDEBAR_PREFS,
  SIDEBAR_PREFS_STORAGE_KEY,
  loadSidebarPrefs,
  saveSidebarPrefs,
  updateSidebarPref,
} from "./sidebarPrefs";

class MemoryStorage {
  readonly data = new Map<string, string>();
  readonly getItem = vi.fn((key: string) => this.data.get(key) ?? null);
  readonly setItem = vi.fn((key: string, value: string) => {
    this.data.set(key, value);
  });
}

describe("sidebarPrefs", () => {
  it("uses expanded sidebars as the default preference", () => {
    const storage = new MemoryStorage();

    expect(loadSidebarPrefs(storage)).toEqual(DEFAULT_SIDEBAR_PREFS);
  });

  it("reads existing sidebar preferences from app-level localStorage", () => {
    const storage = new MemoryStorage();
    storage.data.set(SIDEBAR_PREFS_STORAGE_KEY, JSON.stringify({
      assetsSidebarCollapsed: false,
      scriptOutlineCollapsed: true,
    }));

    expect(loadSidebarPrefs(storage)).toEqual({
      assetsSidebarCollapsed: false,
      scriptOutlineCollapsed: true,
    });
  });

  it("persists updated sidebar preferences", () => {
    const storage = new MemoryStorage();

    saveSidebarPrefs({
      assetsSidebarCollapsed: true,
      scriptOutlineCollapsed: false,
    }, storage);

    expect(storage.setItem).toHaveBeenCalledWith(
      SIDEBAR_PREFS_STORAGE_KEY,
      JSON.stringify({
        assetsSidebarCollapsed: true,
        scriptOutlineCollapsed: false,
      }),
    );
  });

  it("updates one sidebar preference without discarding the others", () => {
    const storage = new MemoryStorage();
    storage.data.set(SIDEBAR_PREFS_STORAGE_KEY, JSON.stringify({
      assetsSidebarCollapsed: true,
      scriptOutlineCollapsed: false,
    }));

    expect(updateSidebarPref("scriptOutlineCollapsed", true, storage)).toEqual({
      assetsSidebarCollapsed: true,
      scriptOutlineCollapsed: true,
    });
    expect(JSON.parse(storage.data.get(SIDEBAR_PREFS_STORAGE_KEY) ?? "{}")).toEqual({
      assetsSidebarCollapsed: true,
      scriptOutlineCollapsed: true,
    });
  });

  it("falls back to defaults for bad localStorage data", () => {
    const storage = new MemoryStorage();
    storage.data.set(SIDEBAR_PREFS_STORAGE_KEY, "{bad json");

    expect(loadSidebarPrefs(storage)).toEqual(DEFAULT_SIDEBAR_PREFS);
  });

  it("does not throw when localStorage read or write fails", () => {
    const throwingStorage = {
      getItem: vi.fn(() => {
        throw new Error("read denied");
      }),
      setItem: vi.fn(() => {
        throw new Error("write denied");
      }),
    };

    expect(loadSidebarPrefs(throwingStorage)).toEqual(DEFAULT_SIDEBAR_PREFS);
    expect(() => saveSidebarPrefs({
      assetsSidebarCollapsed: false,
      scriptOutlineCollapsed: true,
    }, throwingStorage)).not.toThrow();
  });
});
