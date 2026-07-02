import { describe, expect, it } from "vitest";
import { __rewriteBareImportsForTest } from "./runtimeCompiler";

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
});
