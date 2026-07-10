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
    expect(contractDiagnostics.choice_instruction_not_supported.severity).toBe("error");
  });
});
