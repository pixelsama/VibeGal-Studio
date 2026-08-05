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

/** 返回表达式草稿的校验错误；空串是合法的兜底条件。 */
export function conditionDraftError(source: string): string | null {
  const condition = source.trim();
  if (!condition) return null;
  const parsed = parseGraphCondition(condition);
  return parsed.ok ? null : parsed.error;
}

export function collectConditionVariables(ast: GraphConditionAst): string[] {
  return collectExpressionReads(ast);
}
