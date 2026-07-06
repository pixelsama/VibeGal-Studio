import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyTheme,
  createLatestSettingsSaver,
  resolveTheme,
  subscribeSystemThemeChanges,
  type AppSettings,
  type ResolvedTheme,
} from "./theme";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createLatestSettingsSaver", () => {
  it("serializes saves so the last requested settings are the final write", async () => {
    const firstSave = deferred();
    const secondSave = deferred();
    const saved: AppSettings[] = [];
    const save = vi.fn((settings: AppSettings) => {
      saved.push(settings);
      return saved.length === 1 ? firstSave.promise : secondSave.promise;
    });
    const saver = createLatestSettingsSaver(save, () => {});

    const pending = saver.requestSave({ theme: "dark" });
    saver.requestSave({ theme: "light" });

    expect(save).toHaveBeenCalledTimes(1);
    firstSave.resolve();
    await Promise.resolve();

    expect(save).toHaveBeenCalledTimes(2);
    expect(saved).toEqual([{ theme: "dark" }, { theme: "light" }]);

    secondSave.resolve();
    await pending;
  });
});

describe("theme resolution", () => {
  it("resolves system mode to the current system preference", () => {
    expect(resolveTheme("system", "dark")).toBe("dark");
    expect(resolveTheme("system", "light")).toBe("light");
    expect(resolveTheme("dark", "light")).toBe("dark");
    expect(resolveTheme("light", "dark")).toBe("light");
  });

  it("applies the resolved theme to <html> and follows matchMedia for system mode", () => {
    const documentElement = { dataset: {} as Record<string, string> };
    const media = createMatchMedia(true);
    vi.stubGlobal("document", { documentElement });
    vi.stubGlobal("window", { matchMedia: media.matchMedia });

    applyTheme("system");
    expect(documentElement.dataset.theme).toBe("dark");

    media.setMatches(false);
    applyTheme("system");
    expect(documentElement.dataset.theme).toBe("light");
  });

  it("subscribes to system theme changes", () => {
    const media = createMatchMedia(true);
    vi.stubGlobal("window", { matchMedia: media.matchMedia });

    const observed: ResolvedTheme[] = [];
    const unsubscribe = subscribeSystemThemeChanges(() => {
      observed.push(resolveTheme("system"));
    });

    expect(resolveTheme("system")).toBe("dark");
    media.setMatches(false);
    expect(observed).toEqual(["light"]);

    unsubscribe();
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mediaQueryList = {
    get matches() {
      return matches;
    },
    media: "(prefers-color-scheme: dark)",
    onchange: null as ((event: MediaQueryListEvent) => void) | null,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    },
    addListener: (listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    },
    removeListener: (listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    },
  } satisfies MediaQueryList;

  return {
    matchMedia: vi.fn(() => mediaQueryList),
    setMatches(next: boolean) {
      matches = next;
      const event = { matches, media: mediaQueryList.media } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
      mediaQueryList.onchange?.(event);
    },
  };
}
