import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseExpression } from "@vibegal/engine";
import { addLogicalClause, ConditionBuilder, isVisualConditionAst } from "./ConditionBuilder";

const registry = {
  version: 1 as const,
  variables: {
    affection: { type: "number" as const, default: 0, nullable: false, scope: "run" as const },
    has_key: { type: "boolean" as const, default: false, nullable: false, scope: "run" as const },
  },
};

describe("ConditionBuilder", () => {
  it("round trips nested logical comparison groups", () => {
    const ast = parseExpression("affection >= 3 && (has_key == true || affection >= 5)");
    expect(isVisualConditionAst(ast)).toBe(true);
    const html = renderToStaticMarkup(createElement(ConditionBuilder, {
      source: "affection >= 3 && (has_key == true || affection >= 5)", registry, onChange: () => {},
    }));
    expect(html).toContain("AND");
    expect(html).toContain("OR");
    expect(html).not.toContain("暂不支持可视化往返");
  });

  it("adds a typed comparison clause without mutating the existing AST", () => {
    const ast = parseExpression("affection >= 3");
    const next = addLogicalClause(ast, "&&", registry);
    expect(next).not.toBe(ast);
    expect(next).toMatchObject({ type: "binary", op: "&&" });
    expect(isVisualConditionAst(next)).toBe(true);
  });
});
