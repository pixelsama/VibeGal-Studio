import { beforeEach, describe, expect, it, vi } from "vitest";

const rendererManifest = { Component: () => null, meta: { id: "default" } };

vi.mock("../../lib/tauri", () => ({
  readRendererFiles: vi.fn(async () => [{ path: "index.tsx", content: "export default {};" }]),
}));

vi.mock("./runtimeCompiler", () => ({
  compileRenderer: vi.fn(async () => rendererManifest),
}));

describe("loadRenderer", () => {
  beforeEach(async () => {
    const { clearRendererCache } = await import("./rendererLoader");
    clearRendererCache();
  });

  it("loads project renderers through the Tauri file API in dev", async () => {
    const { readRendererFiles } = await import("../../lib/tauri");
    const { compileRenderer } = await import("./runtimeCompiler");
    const { loadRenderer } = await import("./rendererLoader");

    await expect(loadRenderer("/outside/vite-allow-list/project", "default")).resolves.toBe(rendererManifest);
    expect(readRendererFiles).toHaveBeenCalledWith("/outside/vite-allow-list/project", "default");
    expect(compileRenderer).toHaveBeenCalledWith([{ path: "index.tsx", content: "export default {};" }]);
  });
});
