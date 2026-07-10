import { describe, expect, expectTypeOf, it } from "vitest";
import {
  InstructionSchema as ContractInstructionSchema,
  ManifestSchema as ContractManifestSchema,
  ProjectGraphSchema as ContractProjectGraphSchema,
  type Instruction as ContractInstruction,
  type Manifest as ContractManifest,
  type ProjectGraphData as ContractProjectGraphData,
} from "@vibegal/contracts";
import {
  InstructionSchema as EngineInstructionSchema,
  ManifestSchema as EngineManifestSchema,
  ProjectGraphSchema as EngineProjectGraphSchema,
  type Instruction as EngineInstruction,
  type Manifest as EngineManifest,
  type ProjectGraphData as EngineProjectGraphData,
} from "./index";

describe("contracts source boundary", () => {
  it("re-exports the exact contract schema instances through the engine API", () => {
    expect(EngineInstructionSchema).toBe(ContractInstructionSchema);
    expect(EngineManifestSchema).toBe(ContractManifestSchema);
    expect(EngineProjectGraphSchema).toBe(ContractProjectGraphSchema);
  });

  it("keeps the engine's public structural types identical to contracts", () => {
    expectTypeOf<EngineInstruction>().toEqualTypeOf<ContractInstruction>();
    expectTypeOf<EngineManifest>().toEqualTypeOf<ContractManifest>();
    expectTypeOf<EngineProjectGraphData>().toEqualTypeOf<ContractProjectGraphData>();
  });
});
