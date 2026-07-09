import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __findUnsupportedBareImportsForTest,
  __rewriteBareImportsForTest,
  formatRuntimeCompilerErrorForTest,
} from "./runtimeCompiler";

describe("rewriteBareImports", () => {
  it("rewrites mixed default and named React imports", () => {
    const { code, unknownSpecs } = __rewriteBareImportsForTest(
      'import React, { memo, useEffect as useFx } from "react";\nexport default memo(() => React.createElement("div"));',
    );

    expect(unknownSpecs).toEqual([]);
    expect(code).toContain('const __gal_vendor_react = globalThis.__GAL_VENDOR__["react"];');
    expect(code).toContain("const React = __gal_vendor_react.default ?? __gal_vendor_react;");
    expect(code).toContain("const { memo, useEffect: useFx } = __gal_vendor_react;");
    expect(code).not.toContain("import React");
  });

  it("rewrites aliased named imports using valid destructuring syntax", () => {
    const { code, unknownSpecs } = __rewriteBareImportsForTest(
      'import { memo as m, useState } from "react";\nexport { m, useState };',
    );

    expect(unknownSpecs).toEqual([]);
    expect(code).toContain("const { memo: m, useState } =");
    expect(code).not.toContain("memo as m");
  });

  it("rewrites aliased re-exports without exporting undefined locals", () => {
    const { code, unknownSpecs } = __rewriteBareImportsForTest(
      'export { memo as rendererMemo, useState } from "react";',
    );

    expect(unknownSpecs).toEqual([]);
    expect(code).toContain("const { memo: rendererMemo, useState } =");
    expect(code).toContain("export { rendererMemo, useState };");
    expect(code).not.toContain("export { memo as rendererMemo");
  });

  it("leaves relative renderer imports for the bundler", () => {
    const { code, unknownSpecs } = __rewriteBareImportsForTest(
      'import { Stage } from "./Stage";\nexport { Effects } from "../Effects";\nconst mod = import("./lazy");',
    );

    expect(unknownSpecs).toEqual([]);
    expect(code).toContain('import { Stage } from "./Stage";');
    expect(code).toContain('export { Effects } from "../Effects";');
    expect(code).toContain('import("./lazy")');
  });

  it("reports unsupported bare imports with renderer and file context", () => {
    const message = formatRuntimeCompilerErrorForTest({
      rendererId: "mobile",
      error: {
        kind: "unsupported-import",
        diagnostics: [{
          severity: "error",
          code: "renderer_unsupported_import",
          rendererId: "mobile",
          step: "compile",
          message: "Unsupported renderer bare import: lodash-es.",
          file: "renderers/mobile/Stage.tsx",
          line: 2,
          column: 24,
          snippet: 'import debounce from "lodash-es";',
        }],
        file: "renderers/mobile/Stage.tsx",
        specs: ["lodash-es"],
      },
    });

    expect(message).toContain("渲染层 mobile");
    expect(message).toContain("renderers/mobile/Stage.tsx:2:24");
    expect(message).toContain("lodash-es");
    expect(message).toContain("仅支持");
  });

  it("rendererCheckReportsUnsupportedBareImport", () => {
    const diagnostics = __findUnsupportedBareImportsForTest(
      [{ path: "Stage.tsx", content: 'import debounce from "lodash-es";\nexport const Stage = () => null;' }],
      "mobile",
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        severity: "error",
        code: "renderer_unsupported_import",
        rendererId: "mobile",
        step: "compile",
        file: "renderers/mobile/Stage.tsx",
        line: 1,
        column: 22,
        snippet: 'import debounce from "lodash-es";',
      }),
    ]);
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
