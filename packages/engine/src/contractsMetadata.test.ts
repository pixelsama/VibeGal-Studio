import { describe, expect, it } from "vitest";
import { contractDiagnostics, instructionPolicies } from "@vibegal/contracts";

/**
 * C-01 / V-02: instruction semantics are exported by the contracts package,
 * rather than maintained as a second switch in an engine consumer.
 */
describe("contracts diagnostic metadata", () => {
  it("declares policy for every instruction discriminator", () => {
    expect(instructionPolicies.bg.references).toEqual([
      expect.objectContaining({ kind: "registry", missingCode: "missing_background_ref" }),
    ]);
    expect(instructionPolicies.say.storyPoint).toBe(true);
    // Spec 35：choice 是玩家中断点（storyPoint），if 是纯控制流。
    expect(instructionPolicies.choice.storyPoint).toBe(true);
    expect(instructionPolicies.if).toEqual({});
  });
});
