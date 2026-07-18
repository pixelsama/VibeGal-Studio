import { describe, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import { NovelStateSchema } from "@vibegal/contracts";
import type { NovelState } from "./state";

describe("NovelState fixture contract", () => {
  it("keeps contracts NovelStateSchema identical to the engine view contract", () => {
    // fixture 快照（contracts）与视图契约（engine state.ts）必须逐字段等价；
    // 两边任一改结构都会在这里编译期报错，以 engine 为准修 contracts。
    expectTypeOf<NovelState>().toEqualTypeOf<z.infer<typeof NovelStateSchema>>();
  });
});
