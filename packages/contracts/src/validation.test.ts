import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contractDiagnostics, instructionPolicies } from "./diagnostics";
import { buildJsonSchema, SCHEMAS, type SchemaName } from "./schemaExport";
import { validateContractInput } from "./validation";

type ExpectedIssue = {
  code: string;
  severity: "error" | "warn";
  source: string;
  jsonPath: string;
};

const fixture = JSON.parse(readFileSync(
  new URL("../fixtures/validation-contract.json", import.meta.url),
  "utf8",
)) as {
  nodeCases: Array<{ id: string; input: unknown; issues: ExpectedIssue[] }>;
  schemaCases: Array<{
    id: string;
    schema: "graph" | "manifest" | "meta";
    input: unknown;
    issues: ExpectedIssue[];
  }>;
  limitCase: {
    id: string;
    count: number;
    retained: number;
    repeatedIssue: Omit<ExpectedIssue, "jsonPath"> & { jsonPathTemplate: string };
    truncationIssue: ExpectedIssue;
  };
};

const defaultsFixture = JSON.parse(readFileSync(
  new URL("../fixtures/default-projection-contract.json", import.meta.url),
  "utf8",
)) as {
  cases: Array<{ id: string; schema: SchemaName; input: unknown; expected: unknown }>;
};

const stable = (issues: ReturnType<typeof validateContractInput>) => issues.map((issue) => ({
  code: issue.code,
  severity: issue.severity,
  source: issue.source,
  jsonPath: issue.jsonPath,
}));

describe("contract validation corpus", () => {
  for (const testCase of fixture.nodeCases) {
    it(testCase.id, () => {
      expect(stable(validateContractInput("nodeFile", testCase.input))).toEqual(testCase.issues);
    });
  }

  for (const testCase of fixture.schemaCases) {
    it(testCase.id, () => {
      expect(stable(validateContractInput(testCase.schema, testCase.input))).toEqual(testCase.issues);
    });
  }

  it(fixture.limitCase.id, () => {
    const testCase = fixture.limitCase;
    const input = Array.from({ length: testCase.count }, () => ({}));
    const repeated = Array.from({ length: testCase.count }, (_, index) => ({
      code: testCase.repeatedIssue.code,
      severity: testCase.repeatedIssue.severity,
      source: testCase.repeatedIssue.source,
      jsonPath: testCase.repeatedIssue.jsonPathTemplate.replace("{index}", String(index)),
    })).sort(issueOrder).slice(0, testCase.retained);
    const expected = [...repeated, testCase.truncationIssue].sort(issueOrder);

    expect(stable(validateContractInput("nodeFile", input))).toEqual(expected);
  });

  it("keeps instruction policies aligned with every generated discriminator", () => {
    const nodeSchema = buildJsonSchema("nodeFile") as {
      items: { oneOf: Array<{ properties: { t: { const: string } } }> };
    };
    const discriminators = nodeSchema.items.oneOf
      .map((branch) => branch.properties.t.const)
      .sort();

    expect(Object.keys(instructionPolicies).sort()).toEqual(discriminators);

    const allInstructions = fixture.nodeCases.find(
      (testCase) => testCase.id === "node.valid.all-instructions",
    )?.input;
    expect(Array.isArray(allInstructions)).toBe(true);
    const fixtureDiscriminators = (allInstructions as Array<{ t: string }>)
      .map((instruction) => instruction.t)
      .sort();
    expect(fixtureDiscriminators).toEqual(discriminators);
  });

  it("declares every policy and corpus issue code in canonical diagnostics", () => {
    const policyCodes = Object.values(instructionPolicies).flatMap((policy) =>
      "references" in policy
        ? policy.references.flatMap((rule) => "missingCode" in rule ? [rule.missingCode] : [])
        : []);
    const fixtureCodes = [...fixture.nodeCases, ...fixture.schemaCases]
      .flatMap((testCase) => testCase.issues.map((issue) => issue.code));

    for (const code of [...policyCodes, ...fixtureCodes]) {
      expect(contractDiagnostics).toHaveProperty(code);
    }
  });
});

describe("contract default projection corpus", () => {
  for (const testCase of defaultsFixture.cases) {
    it(testCase.id, () => {
      expect(SCHEMAS[testCase.schema].parse(testCase.input)).toEqual(testCase.expected);
    });
  }
});

function issueOrder(left: ExpectedIssue, right: ExpectedIssue): number {
  const leftKey = `${left.jsonPath}\0${left.code}`;
  const rightKey = `${right.jsonPath}\0${right.code}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}
