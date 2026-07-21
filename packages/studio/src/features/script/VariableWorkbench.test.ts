import { describe, expect, it } from "vitest";
import { changeVariableType, registerInferredVariable } from "./VariableWorkbench";

describe("VariableWorkbench model", () => {
  it("registers inferred variables with an explicit compatible declaration", () => {
    const registry = { version: 1 as const, variables: {} };
    expect(registerInferredVariable(registry, "affection", ["number"])).toEqual({
      version: 1,
      variables: { affection: { type: "number", default: 0, nullable: false, scope: "run", description: "" } },
    });
  });

  it("resets the default when the declaration type changes", () => {
    expect(changeVariableType({ type: "string", default: "123", nullable: true, scope: "run" }, "boolean"))
      .toEqual({ type: "boolean", default: false, nullable: true, scope: "run" });
  });
});
