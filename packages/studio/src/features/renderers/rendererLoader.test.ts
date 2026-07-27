import { beforeEach, describe, expect, it, vi } from "vitest";

const rendererManifest = { id: "default", name: "Default", contractVersion: 1, Component: () => null };
let compileResult: unknown = rendererManifest;
let compileBeforeExecutionGate: Promise<void> | null = null;

const SOURCE_FINGERPRINT = "source-hash";

vi.mock("../../lib/tauri", () => ({
  loadAppSettings: vi.fn(async () => ({ theme: "system", rendererTrust: {} })),
  updateAppSettings: vi.fn(async (update: (settings: { theme: "system"; rendererTrust: Record<string, string> }) => unknown) => (
    update({ theme: "system", rendererTrust: {} })
  )),
  rendererSourceFingerprint: vi.fn(async () => SOURCE_FINGERPRINT),
  readRendererSource: vi.fn(async () => ({
    files: [{ path: "index.tsx", content: "export default {};" }],
    fingerprint: SOURCE_FINGERPRINT,
  })),
}));

vi.mock("./runtimeCompiler", () => ({
  compileRenderer: vi.fn(async (_files: unknown, options?: { beforeExecute?: () => void }) => {
    if (compileBeforeExecutionGate) await compileBeforeExecutionGate;
    options?.beforeExecute?.();
    return compileResult;
  }),
}));

describe("loadRenderer", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    compileResult = rendererManifest;
    compileBeforeExecutionGate = null;
    const { clearRendererCache } = await import("./rendererLoader");
    const { configureRendererTrustPersistence } = await import("./rendererTrust");
    clearRendererCache();
    configureRendererTrustPersistence({
      load: async () => ({}),
      save: async () => {},
    });
  });

  it("loads project renderers through the Tauri file API in dev", async () => {
    const { readRendererSource } = await import("../../lib/tauri");
    const { compileRenderer } = await import("./runtimeCompiler");
    const { loadRenderer } = await import("./rendererLoader");
    const { trustProjectRenderer } = await import("./rendererTrust");

    await trustProjectRenderer("/outside/vite-allow-list/project", "default", SOURCE_FINGERPRINT);
    await expect(loadRenderer("/outside/vite-allow-list/project", "default")).resolves.toBe(rendererManifest);
    expect(readRendererSource).toHaveBeenCalledWith("/outside/vite-allow-list/project", "default");
    expect(compileRenderer).toHaveBeenCalledWith(
      [{ path: "index.tsx", content: "export default {};" }],
      expect.objectContaining({ rendererId: "default", beforeExecute: expect.any(Function) }),
    );
  });

  it("does not compile project code before explicit trust", async () => {
    const { readRendererSource } = await import("../../lib/tauri");
    const { compileRenderer } = await import("./runtimeCompiler");
    const { loadRenderer } = await import("./rendererLoader");

    await expect(loadRenderer("/project", "default")).rejects.toMatchObject({
      code: "renderer_trust_required",
    });
    expect(readRendererSource).toHaveBeenCalledWith("/project", "default");
    expect(compileRenderer).not.toHaveBeenCalled();
  });

  it("does not return a cached renderer after project trust is revoked", async () => {
    const { readRendererSource } = await import("../../lib/tauri");
    const { compileRenderer } = await import("./runtimeCompiler");
    const { loadRenderer } = await import("./rendererLoader");
    const { clearRendererTrust, trustProjectRenderer } = await import("./rendererTrust");

    await trustProjectRenderer("/project", "default", SOURCE_FINGERPRINT);
    await expect(loadRenderer("/project", "default")).resolves.toBe(rendererManifest);
    await clearRendererTrust("/project");

    await expect(loadRenderer("/project", "default")).rejects.toMatchObject({
      code: "renderer_trust_required",
    });
    expect(readRendererSource).toHaveBeenCalledTimes(2);
    expect(compileRenderer).toHaveBeenCalledTimes(1);
  });

  it("aborts an in-flight compile when project trust is revoked before execution", async () => {
    const { compileRenderer } = await import("./runtimeCompiler");
    const { loadRenderer } = await import("./rendererLoader");
    const { clearRendererTrust, trustProjectRenderer } = await import("./rendererTrust");
    let resumeExecution!: () => void;
    compileBeforeExecutionGate = new Promise((resolve) => {
      resumeExecution = resolve;
    });

    await trustProjectRenderer("/project", "default", SOURCE_FINGERPRINT);
    const outcome = loadRenderer("/project", "default").then(
      (value) => ({ value, error: null }),
      (error: unknown) => ({ value: null, error }),
    );
    await vi.waitFor(() => expect(compileRenderer).toHaveBeenCalledTimes(1));

    await clearRendererTrust("/project");
    resumeExecution();

    await expect(outcome).resolves.toMatchObject({
      value: null,
      error: { code: "renderer_trust_required" },
    });
  });

  it("rendererCheckReportsMissingDefaultExport", async () => {
    compileResult = undefined;
    const { getRendererDiagnostics, loadRenderer } = await import("./rendererLoader");
    const { trustProjectRenderer } = await import("./rendererTrust");
    await trustProjectRenderer("/project", "default", SOURCE_FINGERPRINT);

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
    const { trustProjectRenderer } = await import("./rendererTrust");
    await trustProjectRenderer("/project", "default", SOURCE_FINGERPRINT);

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
    const { trustProjectRenderer } = await import("./rendererTrust");
    await trustProjectRenderer("/project", "default", SOURCE_FINGERPRINT);

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
    const { trustProjectRenderer } = await import("./rendererTrust");
    await trustProjectRenderer("/project", "default", SOURCE_FINGERPRINT);

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

  it("rejects malformed renderer appearance descriptions before exposing them to Studio", async () => {
    compileResult = {
      id: "default",
      name: "Default",
      contractVersion: 1,
      appearance: {
        groups: [{
          id: "caption",
          label: "字幕框",
          controls: [{ key: "caption.opacity", label: "不透明度", kind: "slider" }],
        }],
      },
      Component: () => null,
    };
    const { getRendererDiagnostics, loadRenderer } = await import("./rendererLoader");
    const { trustProjectRenderer } = await import("./rendererTrust");
    await trustProjectRenderer("/project", "default", SOURCE_FINGERPRINT);

    try {
      await loadRenderer("/project", "default");
      throw new Error("loadRenderer should fail");
    } catch (error) {
      expect(getRendererDiagnostics(error)).toEqual([
        expect.objectContaining({
          severity: "error",
          code: "renderer_manifest_invalid",
          rendererId: "default",
          step: "manifest",
          file: "renderers/default/index.tsx",
        }),
      ]);
    }
  });
});
