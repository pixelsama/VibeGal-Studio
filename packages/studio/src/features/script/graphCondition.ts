import {
  collectExpressionReads,
  parseExpression,
  type ExpressionAst,
  type GraphRouteValue,
} from "@vibegal/engine";

/**
 * Studio graph tools deliberately expose the engine AST directly. Keeping this
 * small adapter preserves the editor's error-result API without maintaining a
 * second condition grammar.
 */
export type GraphConditionLiteral = GraphRouteValue;
export type GraphConditionAst = ExpressionAst;

export function parseGraphCondition(source: string): { ok: true; ast: GraphConditionAst } | { ok: false; error: string } {
  try {
    return { ok: true, ast: parseExpression(source) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function collectConditionVariables(ast: GraphConditionAst): string[] {
  return collectExpressionReads(ast);
}
