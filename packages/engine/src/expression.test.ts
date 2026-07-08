import { describe, expect, it } from "vitest";
import {
  collectExpressionReads,
  evaluateExpression,
  parseExpression,
} from "./expression";

describe("expression contract", () => {
  it("expressionParserRejectsArbitraryJs", () => {
    expect(() => parseExpression("has_key && (globalThis.alert(1) || true)")).toThrow();
    expect(() => parseExpression("route = 'stay'")).toThrow();
    expect(() => parseExpression("affection += 1")).toThrow();
  });

  it("expressionAnalyzerCollectsVariableReads", () => {
    const expr = parseExpression("flags.route.locked && (affection >= 3 || has_key == true)");

    expect(collectExpressionReads(expr)).toEqual([
      "affection",
      "flags.route.locked",
      "has_key",
    ]);
  });

  it("evaluates comparisons with &&, ||, and parentheses", () => {
    const expr = parseExpression("(affection >= 3 && has_key == true) || route == 'stay'");

    expect(
      evaluateExpression(expr, { affection: 2, has_key: false, route: "leave" }),
    ).toBe(false);
    expect(
      evaluateExpression(expr, { affection: 3, has_key: true, route: "leave" }),
    ).toBe(true);
    expect(
      evaluateExpression(expr, { affection: 0, has_key: false, route: "stay" }),
    ).toBe(true);
  });
});
