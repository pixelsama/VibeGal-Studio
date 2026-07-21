import type { GraphRouteValue } from "./graphRouting";

export type BinaryOp = "||" | "&&" | "==" | "!=" | ">=" | "<=" | ">" | "<" | "+" | "-" | "*" | "/" | "%";
type Token =
  | { type: "identifier"; value: string }
  | { type: "literal"; value: GraphRouteValue }
  | { type: "op"; value: BinaryOp | "!" }
  | { type: "paren"; value: "(" | ")" };

export type ExpressionAst =
  | { type: "var"; name: string }
  | { type: "literal"; value: GraphRouteValue }
  | { type: "unary"; op: "!" | "-"; expr: ExpressionAst }
  | { type: "binary"; op: BinaryOp; left: ExpressionAst; right: ExpressionAst };

export type ExpressionEvaluationResult =
  | { ok: true; value: GraphRouteValue }
  | { ok: false; code: "unknown_variable" | "type_error" | "division_by_zero"; message: string; variableName?: string };

export function parseExpression(source: string): ExpressionAst {
  const parser = new Parser(tokenize(source));
  const expr = parser.parseExpression();
  parser.expectEnd();
  return expr;
}

export function collectExpressionReads(expr: ExpressionAst): string[] {
  const reads = new Set<string>();
  visitExpression(expr, (node) => {
    if (node.type === "var") reads.add(node.name);
  });
  return [...reads].sort();
}

export function evaluateExpression(expr: ExpressionAst, vars: Record<string, GraphRouteValue | undefined>): boolean {
  const result = evaluateExpressionValue(expr, vars);
  if (!result.ok) throw new Error(result.message);
  return truthy(result.value);
}

export function evaluateExpressionValue(
  expr: ExpressionAst,
  vars: Record<string, GraphRouteValue | undefined>,
): ExpressionEvaluationResult {
  const evaluate = (node: ExpressionAst): ExpressionEvaluationResult => {
    if (node.type === "literal") return { ok: true, value: node.value };
    if (node.type === "var") {
      if (!Object.prototype.hasOwnProperty.call(vars, node.name) || vars[node.name] === undefined) {
        return { ok: false, code: "unknown_variable", message: `未知变量：${node.name}`, variableName: node.name };
      }
      return { ok: true, value: vars[node.name] ?? null };
    }
    if (node.type === "unary") {
      const operand = evaluate(node.expr);
      if (!operand.ok) return operand;
      if (node.op === "!") return { ok: true, value: !truthy(operand.value) };
      return typeof operand.value === "number"
        ? { ok: true, value: -operand.value }
        : { ok: false, code: "type_error", message: "数值负号只接受 number" };
    }

    const left = evaluate(node.left);
    if (!left.ok) return left;
    if (node.op === "&&" && !truthy(left.value)) return { ok: true, value: false };
    if (node.op === "||" && truthy(left.value)) return { ok: true, value: true };
    const right = evaluate(node.right);
    if (!right.ok) return right;

    if (node.op === "&&" || node.op === "||") return { ok: true, value: truthy(right.value) };
    if (node.op === "==") return { ok: true, value: left.value === right.value };
    if (node.op === "!=") return { ok: true, value: left.value !== right.value };
    if ([">", "<", ">=", "<=", "+", "-", "*", "/", "%"].includes(node.op)) {
      if (typeof left.value !== "number" || typeof right.value !== "number") {
        return { ok: false, code: "type_error", message: `${node.op} 两侧必须是 number` };
      }
      if ((node.op === "/" || node.op === "%") && right.value === 0) {
        return { ok: false, code: "division_by_zero", message: "不能除以零" };
      }
      switch (node.op) {
        case ">": return { ok: true, value: left.value > right.value };
        case "<": return { ok: true, value: left.value < right.value };
        case ">=": return { ok: true, value: left.value >= right.value };
        case "<=": return { ok: true, value: left.value <= right.value };
        case "+": return { ok: true, value: left.value + right.value };
        case "-": return { ok: true, value: left.value - right.value };
        case "*": return { ok: true, value: left.value * right.value };
        case "/": return { ok: true, value: left.value / right.value };
        case "%": return { ok: true, value: left.value % right.value };
      }
    }
    return { ok: false, code: "type_error", message: `不支持运算符 ${node.op}` };
  };
  return evaluate(expr);
}

export function formatExpression(expr: ExpressionAst): string {
  const format = (node: ExpressionAst, parentPrecedence = 0): string => {
    if (node.type === "literal") return typeof node.value === "string" ? JSON.stringify(node.value) : String(node.value);
    if (node.type === "var") return node.name;
    if (node.type === "unary") return `${node.op}${format(node.expr, 7)}`;
    const precedence = PRECEDENCE[node.op];
    const rendered = `${format(node.left, precedence)} ${node.op} ${format(node.right, precedence + 1)}`;
    return precedence < parentPrecedence ? `(${rendered})` : rendered;
  };
  return format(expr);
}

function visitExpression(expr: ExpressionAst, fn: (expr: ExpressionAst) => void) {
  fn(expr);
  if (expr.type === "unary") visitExpression(expr.expr, fn);
  if (expr.type === "binary") {
    visitExpression(expr.left, fn);
    visitExpression(expr.right, fn);
  }
}

export function truthy(value: GraphRouteValue | undefined): boolean {
  return value === true || (typeof value === "number" && value !== 0) || (typeof value === "string" && value.length > 0);
}

const PRECEDENCE: Record<BinaryOp, number> = { "||": 1, "&&": 2, "==": 3, "!=": 3, ">": 4, "<": 4, ">=": 4, "<=": 4, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6 };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) { index += 1; continue; }
    const two = source.slice(index, index + 2);
    if (["&&", "||", "==", "!=", ">=", "<="].includes(two)) {
      tokens.push({ type: "op", value: two as BinaryOp }); index += 2; continue;
    }
    if (["!", ">", "<", "+", "-", "*", "/", "%"].includes(char)) {
      tokens.push({ type: "op", value: char as BinaryOp | "!" }); index += 1; continue;
    }
    if (char === "(" || char === ")") { tokens.push({ type: "paren", value: char }); index += 1; continue; }
    if (char === "\"" || char === "'") {
      let value = ""; let cursor = index + 1;
      while (cursor < source.length && source[cursor] !== char) {
        if (source[cursor] === "\\" && cursor + 1 < source.length) { value += source[cursor + 1]; cursor += 2; }
        else { value += source[cursor]; cursor += 1; }
      }
      if (cursor >= source.length) throw new Error("Unterminated string literal.");
      tokens.push({ type: "literal", value }); index = cursor + 1; continue;
    }
    const numberMatch = source.slice(index).match(/^\d+(?:\.\d+)?/);
    if (numberMatch) { tokens.push({ type: "literal", value: Number(numberMatch[0]) }); index += numberMatch[0].length; continue; }
    // Historical conditions allowed hyphenated variable names. Arithmetic
    // subtraction remains unambiguous because the formatter emits `a - b`.
    const identMatch = source.slice(index).match(/^[A-Za-z_][A-Za-z0-9_.]*(?:-[A-Za-z_][A-Za-z0-9_.]*)*/);
    if (identMatch) {
      const value = identMatch[0];
      tokens.push(value === "true" ? { type: "literal", value: true }
        : value === "false" ? { type: "literal", value: false }
        : value === "null" ? { type: "literal", value: null }
        : { type: "identifier", value });
      index += value.length; continue;
    }
    throw new Error(`Unsupported expression token at ${index}.`);
  }
  return tokens;
}

class Parser {
  private index = 0;
  constructor(private readonly tokens: Token[]) {}
  parseExpression(): ExpressionAst { return this.parseBinary(1); }
  expectEnd() { if (this.peek()) throw new Error("Unexpected token after expression."); }
  private parseBinary(minPrecedence: number): ExpressionAst {
    let left = this.parseUnary();
    while (true) {
      const token = this.peek();
      if (token?.type !== "op" || token.value === "!" || PRECEDENCE[token.value] < minPrecedence) break;
      const op = token.value; this.index += 1;
      left = { type: "binary", op, left, right: this.parseBinary(PRECEDENCE[op] + 1) };
    }
    return left;
  }
  private parseUnary(): ExpressionAst {
    const token = this.peek();
    if (token?.type === "op" && (token.value === "!" || token.value === "-")) {
      this.index += 1; return { type: "unary", op: token.value, expr: this.parseUnary() };
    }
    return this.parsePrimary();
  }
  private parsePrimary(): ExpressionAst {
    const token = this.peek();
    if (!token) throw new Error("Unexpected end of expression.");
    if (token.type === "identifier") { this.index += 1; return { type: "var", name: token.value }; }
    if (token.type === "literal") { this.index += 1; return { type: "literal", value: token.value }; }
    if (token.type === "paren" && token.value === "(") {
      this.index += 1; const expr = this.parseExpression();
      const close = this.peek(); if (close?.type !== "paren" || close.value !== ")") throw new Error("Expected closing parenthesis.");
      this.index += 1; return expr;
    }
    throw new Error("Unexpected expression token.");
  }
  private peek(): Token | undefined { return this.tokens[this.index]; }
}
