import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAsset } from "./assetPath";

type TauriInternals = {
  __TAURI_INTERNALS__?: {
    convertFileSrc?: (path: string, protocol?: string) => string;
  };
};

const globals = globalThis as TauriInternals;

afterEach(() => {
  delete globals.__TAURI_INTERNALS__;
});

describe("resolveAsset", () => {
  it("joins normal URL bases without requiring Tauri", () => {
    expect(resolveAsset("https://cdn.example/content/", "/assets/bg.png")).toBe(
      "https://cdn.example/content/assets/bg.png",
    );
  });

  it("converts the final local file path through Tauri when available", () => {
    const convertFileSrc = vi.fn((path: string) => `asset://${path}`);
    globals.__TAURI_INTERNALS__ = { convertFileSrc };

    const url = resolveAsset("/Users/me/Game/content", "assets/backgrounds/bg 1.png");

    expect(convertFileSrc).toHaveBeenCalledWith("/Users/me/Game/content/assets/backgrounds/bg 1.png", "asset");
    expect(url).toBe("asset:///Users/me/Game/content/assets/backgrounds/bg 1.png");
  });
});
