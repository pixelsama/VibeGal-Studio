import { describe, expectTypeOf, it } from "vitest";
import type { RendererProps } from "./renderer";

describe("RendererProps preview flag (spec 34)", () => {
  it("preview 为可选布尔字段（缺省 undefined = 非预览）", () => {
    expectTypeOf<RendererProps["preview"]>().toEqualTypeOf<boolean | undefined>();
  });

  it("缺省对象字面量仍可赋给 RendererProps（可选字段不破坏现有渲染层）", () => {
    type WithoutPreview = Omit<RendererProps, "preview">;
    expectTypeOf<WithoutPreview>().toExtend<RendererProps>();
  });
});
