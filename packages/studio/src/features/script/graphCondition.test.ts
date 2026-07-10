import { collectExpressionReads, parseExpression } from "@vibegal/engine";
import { describe, expect, it } from "vitest";
import { collectConditionVariables, parseGraphCondition } from "./graphCondition";

describe("graph conditions", () => {
  it("uses the engine expression contract as its only parser", () => {
    const source = "score >= -2 && (route == 'stay' || !blocked)";
    const parsed = parseGraphCondition(source);

    expect(parsed).toEqual({ ok: true, ast: parseExpression(source) });
    if (parsed.ok) {
      expect(collectConditionVariables(parsed.ast)).toEqual(
        collectExpressionReads(parseExpression(source)),
      );
    }
  });
});
