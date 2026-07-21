import { describe, expect, it } from "vitest";
import {
  collectExpressionReads,
  evaluateExpression,
  evaluateExpressionValue,
  formatExpression,
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

  it("evaluates deterministic scalar assignment expressions", () => {
    const expr = parseExpression("base_score + bonus * 2 - 1");
    expect(evaluateExpressionValue(expr, { base_score: 10, bonus: 3 })).toEqual({ ok: true, value: 15 });
    expect(formatExpression(expr)).toBe("base_score + bonus * 2 - 1");
  });

  it("returns structured failures for unknown variables, type errors, and division by zero", () => {
    expect(evaluateExpressionValue(parseExpression("missing + 1"), {})).toMatchObject({ ok: false, code: "unknown_variable" });
    expect(evaluateExpressionValue(parseExpression("name - 1"), { name: "Mio" })).toMatchObject({ ok: false, code: "type_error" });
    expect(evaluateExpressionValue(parseExpression("10 / 0"), {})).toMatchObject({ ok: false, code: "division_by_zero" });
  });
});
