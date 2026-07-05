import { describe, expect, it, vi } from "vitest";
import { resolveAssetUrl } from "./assetPreview";
import { convertFileSrc } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}));

describe("asset preview URLs", () => {
  it("converts the final asset file path instead of appending after a converted directory URL", () => {
    const url = resolveAssetUrl("/Users/me/Game", "assets/backgrounds/bg 1.png");

    expect(convertFileSrc).toHaveBeenCalledWith("/Users/me/Game/content/assets/backgrounds/bg 1.png");
    expect(url).toBe("asset:///Users/me/Game/content/assets/backgrounds/bg 1.png");
  });
});
