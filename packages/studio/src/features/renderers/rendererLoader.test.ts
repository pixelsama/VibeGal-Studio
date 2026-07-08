import { beforeEach, describe, expect, it, vi } from "vitest";

const rendererManifest = { id: "default", name: "Default", contractVersion: 1, Component: () => null };
let compileResult: unknown = rendererManifest;

vi.mock("../../lib/tauri", () => ({
  readRendererFiles: vi.fn(async () => [{ path: "index.tsx", content: "export default {};" }]),
}));

vi.mock("./runtimeCompiler", () => ({
  compileRenderer: vi.fn(async () => compileResult),
}));

describe("loadRenderer", () => {
  beforeEach(async () => {
    compileResult = rendererManifest;
    const { clearRendererCache } = await import("./rendererLoader");
    clearRendererCache();
  });

  it("loads project renderers through the Tauri file API in dev", async () => {
    const { readRendererFiles } = await import("../../lib/tauri");
    const { compileRenderer } = await import("./runtimeCompiler");
    const { loadRenderer } = await import("./rendererLoader");

    await expect(loadRenderer("/outside/vite-allow-list/project", "default")).resolves.toBe(rendererManifest);
    expect(readRendererFiles).toHaveBeenCalledWith("/outside/vite-allow-list/project", "default");
    expect(compileRenderer).toHaveBeenCalledWith([{ path: "index.tsx", content: "export default {};" }], { rendererId: "default" });
  });

  it("rendererCheckReportsMissingDefaultExport", async () => {
    compileResult = undefined;
    const { getRendererDiagnostics, loadRenderer } = await import("./rendererLoader");

    try {
      await loadRenderer("/project", "default");
      throw new Error("loadRenderer should fail");
    } catch (error) {
      expect(getRendererDiagnostics(error)).toEqual([
        expect.objectContaining({
          severity: "error",
          code: "renderer_missing_default_export",
          rendererId: "default",
          step: "manifest",
          file: "renderers/default/index.tsx",
        }),
      ]);
    }
  });

  it("studioRendererDiagnosticsMatchCliCodes", async () => {
    compileResult = { id: "other", name: "Other", contractVersion: 1, Component: () => null };
    const { getRendererDiagnostics, loadRenderer } = await import("./rendererLoader");

    try {
      await loadRenderer("/project", "default");
      throw new Error("loadRenderer should fail");
    } catch (error) {
      expect(getRendererDiagnostics(error)?.map((diagnostic) => diagnostic.code)).toEqual([
        "renderer_manifest_id_mismatch",
      ]);
    }
  });

  it("rendererCheckReportsMissingContractVersion", async () => {
    compileResult = { id: "default", name: "Default", Component: () => null };
    const { getRendererDiagnostics, loadRenderer } = await import("./rendererLoader");

    try {
      await loadRenderer("/project", "default");
      throw new Error("loadRenderer should fail");
    } catch (error) {
      expect(getRendererDiagnostics(error)).toEqual([
        expect.objectContaining({
          code: "renderer_contract_missing",
          rendererId: "default",
          step: "contract",
          file: "renderers/default/index.tsx",
        }),
      ]);
    }
  });

  it("reports unsupported contract version with the same stable code", async () => {
    compileResult = { id: "default", name: "Default", contractVersion: 2, Component: () => null };
    const { getRendererDiagnostics, loadRenderer } = await import("./rendererLoader");

    try {
      await loadRenderer("/project", "default");
      throw new Error("loadRenderer should fail");
    } catch (error) {
      expect(getRendererDiagnostics(error)).toEqual([
        expect.objectContaining({
          code: "renderer_contract_unsupported",
          rendererId: "default",
          step: "contract",
          file: "renderers/default/index.tsx",
        }),
      ]);
    }
  });
});
