import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __esbuildErrorToDiagnosticForTest,
  __resolveMemoryPathForTest,
  __vendorShimForTest,
} from "./runtimeCompiler";

describe("resolveMemoryPath", () => {
  const files = new Set([
    "index.tsx",
    "layers/Foo.tsx",
    "layers/Bar.ts",
    "effects/index.ts",
  ]);

  it("resolves an exact relative path with extension", () => {
    expect(__resolveMemoryPathForTest("./layers/Foo.tsx", "index.tsx", files)).toBe("layers/Foo.tsx");
  });

  it("completes missing extensions in tsx / ts order", () => {
    expect(__resolveMemoryPathForTest("./layers/Foo", "index.tsx", files)).toBe("layers/Foo.tsx");
    expect(__resolveMemoryPathForTest("./layers/Bar", "index.tsx", files)).toBe("layers/Bar.ts");
  });

  it("resolves parent-relative specifiers against the importer directory", () => {
    expect(__resolveMemoryPathForTest("../layers/Foo", "effects/index.ts", files)).toBe("layers/Foo.tsx");
  });

  it("resolves a directory specifier to its index file", () => {
    expect(__resolveMemoryPathForTest("./effects", "index.tsx", files)).toBe("effects/index.ts");
  });

  it("returns null when no candidate exists", () => {
    expect(__resolveMemoryPathForTest("./Missing", "index.tsx", files)).toBeNull();
  });
});

describe("vendorShimSource", () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__GAL_VENDOR__;
  });

  it("re-exports the injected vendor module exports", () => {
    const fakeReact = { useState: () => null, useEffect: () => null, default: { name: "FakeReact" } };
    (globalThis as Record<string, unknown>).__GAL_VENDOR__ = { react: fakeReact };

    const shim = __vendorShimForTest("react");

    expect(shim).toContain('const __m = globalThis.__GAL_VENDOR__["react"];');
    expect(shim).toContain("export default (__m && __m.default !== undefined) ? __m.default : __m;");
    expect(shim).toContain('export const useState = __m["useState"];');
    expect(shim).toContain('export const useEffect = __m["useEffect"];');
  });

  it("skips default and non-identifier export names", () => {
    (globalThis as Record<string, unknown>).__GAL_VENDOR__ = {
      "@vibegal/engine": { resolveAsset: () => null, default: {}, "not-an-identifier": 1 },
    };

    const shim = __vendorShimForTest("@vibegal/engine");

    expect(shim).toContain('export const resolveAsset = __m["resolveAsset"];');
    expect(shim).not.toContain("export const default");
    expect(shim).not.toContain("not-an-identifier");
  });

  it("returns null when the vendor module is not injected", () => {
    (globalThis as Record<string, unknown>).__GAL_VENDOR__ = {};

    expect(__vendorShimForTest("react")).toBeNull();
  });
});

describe("esbuildErrorToDiagnostic", () => {
  it("maps unsupported bare import errors with location to renderer_unsupported_import", () => {
    const diagnostic = __esbuildErrorToDiagnosticForTest("mobile", {
      text: "VIBEGAL_UNSUPPORTED_RENDERER_IMPORT:lodash-es",
      location: {
        file: "index.tsx",
        line: 1,
        column: 22,
        lineText: 'import debounce from "lodash-es";',
      },
    } as never);

    expect(diagnostic).toEqual({
      severity: "error",
      code: "renderer_unsupported_import",
      rendererId: "mobile",
      step: "compile",
      message: expect.stringContaining("lodash-es"),
      file: "renderers/mobile/index.tsx",
      line: 1,
      column: 22,
      snippet: 'import debounce from "lodash-es";',
    });
    expect(diagnostic.message).toContain("仅支持 react、react/jsx-runtime、react-dom、@vibegal/engine 与相对路径 import");
  });

  it("maps generic build errors to renderer_compile_failed and strips the memory:// prefix", () => {
    const diagnostic = __esbuildErrorToDiagnosticForTest("mobile", {
      text: 'ERROR: Unexpected "}"',
      location: {
        file: "memory://layers/Foo.tsx",
        line: 3,
        column: 5,
        lineText: "const x = }",
      },
    } as never);

    expect(diagnostic).toEqual(expect.objectContaining({
      code: "renderer_compile_failed",
      message: 'ERROR: Unexpected "}"',
      file: "renderers/mobile/layers/Foo.tsx",
      line: 3,
      column: 5,
      snippet: "const x = }",
    }));
  });

  it("leaves location fields undefined when esbuild reports no location", () => {
    const diagnostic = __esbuildErrorToDiagnosticForTest("mobile", {
      text: "ERROR: build failed",
      location: null,
    } as never);

    expect(diagnostic).toEqual(expect.objectContaining({
      code: "renderer_compile_failed",
      file: undefined,
      line: undefined,
      column: undefined,
      snippet: undefined,
    }));
  });
});

describe("esbuild initialization", () => {
  afterEach(() => {
    vi.doUnmock("esbuild-wasm");
    vi.resetModules();
    delete (globalThis as Record<string, unknown>).__GAL_ESBUILD_READY__;
    delete (globalThis as Record<string, unknown>).__GAL_ESBUILD_INIT_PROMISE__;
  });

  it("waits on the same in-flight initialize promise for concurrent compiler calls", async () => {
    vi.resetModules();
    delete (globalThis as Record<string, unknown>).__GAL_ESBUILD_READY__;
    delete (globalThis as Record<string, unknown>).__GAL_ESBUILD_INIT_PROMISE__;
    let resolveInitialize: (() => void) | null = null;
    let initializing = false;
    const initialize = vi.fn(() => {
      if (initializing) {
        return Promise.reject(new Error('Cannot call "initialize" more than once'));
      }
      initializing = true;
      return new Promise<void>((resolve) => {
        resolveInitialize = () => {
          initializing = false;
          resolve();
        };
      });
    });

    vi.doMock("esbuild-wasm", () => ({
      initialize,
    }));

    const module = await import("./runtimeCompiler");
    const ensureEsbuild = (module as { __ensureEsbuildForTest?: () => Promise<void> }).__ensureEsbuildForTest;
    expect(ensureEsbuild).toBeTypeOf("function");

    let firstResolved = false;
    let secondResolved = false;
    const first = ensureEsbuild!().then(() => {
      firstResolved = true;
    });
    const second = ensureEsbuild!().then(() => {
      secondResolved = true;
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(firstResolved).toBe(false);
    expect(secondResolved).toBe(false);

    resolveInitialize?.();
    await Promise.all([first, second]);

    expect(firstResolved).toBe(true);
    expect(secondResolved).toBe(true);
  });
});
