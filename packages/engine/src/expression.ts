import type { GraphRouteValue } from "./graphRouting";

type BinaryOp = "&&" | "||" | "==" | "!=" | ">=" | "<=" | ">" | "<";
type ComparisonOp = Exclude<BinaryOp, "&&" | "||">;

type Token =
  | { type: "identifier"; value: string }
  | { type: "literal"; value: GraphRouteValue }
  | { type: "op"; value: BinaryOp | "!" }
  | { type: "paren"; value: "(" | ")" };

export type ExpressionAst =
  | { type: "var"; name: string }
  | { type: "literal"; value: GraphRouteValue }
  | { type: "not"; expr: ExpressionAst }
  | { type: "binary"; op: BinaryOp; left: ExpressionAst; right: ExpressionAst };

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
  return Array.from(reads).sort();
}

export function evaluateExpression(expr: ExpressionAst, vars: Record<string, GraphRouteValue | undefined>): boolean {
  return truthy(evaluateValue(expr, vars));
}

function evaluateValue(expr: ExpressionAst, vars: Record<string, GraphRouteValue | undefined>): GraphRouteValue {
  switch (expr.type) {
    case "literal":
      return expr.value;
    case "var":
      return vars[expr.name] ?? null;
    case "not":
      return !truthy(evaluateValue(expr.expr, vars));
    case "binary": {
      if (expr.op === "&&") return truthy(evaluateValue(expr.left, vars)) && truthy(evaluateValue(expr.right, vars));
      if (expr.op === "||") return truthy(evaluateValue(expr.left, vars)) || truthy(evaluateValue(expr.right, vars));
      const left = evaluateValue(expr.left, vars);
      const right = evaluateValue(expr.right, vars);
      return evaluateComparison(expr.op, left, right);
    }
  }
}

function evaluateComparison(op: ComparisonOp, left: GraphRouteValue, right: GraphRouteValue): boolean {
  switch (op) {
    case "==":
      return left === right;
    case "!=":
      return left !== right;
    case ">":
      return typeof left === "number" && typeof right === "number" && left > right;
    case "<":
      return typeof left === "number" && typeof right === "number" && left < right;
    case ">=":
      return typeof left === "number" && typeof right === "number" && left >= right;
    case "<=":
      return typeof left === "number" && typeof right === "number" && left <= right;
  }
}

function visitExpression(expr: ExpressionAst, fn: (expr: ExpressionAst) => void) {
  fn(expr);
  if (expr.type === "not") visitExpression(expr.expr, fn);
  if (expr.type === "binary") {
    visitExpression(expr.left, fn);
    visitExpression(expr.right, fn);
  }
}

function truthy(value: GraphRouteValue | undefined): boolean {
  return value === true || (typeof value === "number" && value !== 0) || (typeof value === "string" && value.length > 0);
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    const two = source.slice(index, index + 2);
    if (isBinaryOp(two)) {
      tokens.push({ type: "op", value: two });
      index += 2;
      continue;
    }
    if (char === "!" || char === ">" || char === "<") {
      tokens.push({ type: "op", value: char });
      index += 1;
      continue;
    }
    if (char === "(" || char === ")") {
      tokens.push({ type: "paren", value: char });
      index += 1;
      continue;
    }
    if (char === "\"" || char === "'") {
      const end = source.indexOf(char, index + 1);
      if (end < 0) throw new Error("Unterminated string literal.");
      tokens.push({ type: "literal", value: source.slice(index + 1, end) });
      index = end + 1;
      continue;
    }

    const numberMatch = source.slice(index).match(/^-?\d+(?:\.\d+)?/);
    if (numberMatch) {
      tokens.push({ type: "literal", value: Number(numberMatch[0]) });
      index += numberMatch[0].length;
      continue;
    }

    const identMatch = source.slice(index).match(/^[A-Za-z_][\w.-]*/);
    if (identMatch) {
      const value = identMatch[0];
      if (value === "true") tokens.push({ type: "literal", value: true });
      else if (value === "false") tokens.push({ type: "literal", value: false });
      else if (value === "null") tokens.push({ type: "literal", value: null });
      else tokens.push({ type: "identifier", value });
      index += value.length;
      continue;
    }

    throw new Error(`Unsupported expression token at ${index}.`);
  }
  return tokens;
}

function isBinaryOp(value: string): value is BinaryOp {
  return value === "&&" || value === "||" || value === "==" || value === "!=" || value === ">=" || value === "<=";
}

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  parseExpression(): ExpressionAst {
    return this.parseOr();
  }

  expectEnd() {
    if (this.peek()) throw new Error("Unexpected token after expression.");
  }

  private parseOr(): ExpressionAst {
    let left = this.parseAnd();
    while (this.matchOp("||")) left = { type: "binary", op: "||", left, right: this.parseAnd() };
    return left;
  }

  private parseAnd(): ExpressionAst {
    let left = this.parseComparison();
    while (this.matchOp("&&")) left = { type: "binary", op: "&&", left, right: this.parseComparison() };
    return left;
  }

  private parseComparison(): ExpressionAst {
    let left = this.parseUnary();
    const op = this.matchComparison();
    if (op) left = { type: "binary", op, left, right: this.parseUnary() };
    return left;
  }

  private parseUnary(): ExpressionAst {
    if (this.matchOp("!")) return { type: "not", expr: this.parseUnary() };
    return this.parsePrimary();
  }

  private parsePrimary(): ExpressionAst {
    const token = this.peek();
    if (!token) throw new Error("Unexpected end of expression.");
    if (token.type === "identifier") {
      this.index += 1;
      return { type: "var", name: token.value };
    }
    if (token.type === "literal") {
      this.index += 1;
      return { type: "literal", value: token.value };
    }
    if (token.type === "paren" && token.value === "(") {
      this.index += 1;
      const expr = this.parseExpression();
      const close = this.peek();
      if (close?.type !== "paren" || close.value !== ")") throw new Error("Expected closing parenthesis.");
      this.index += 1;
      return expr;
    }
    throw new Error("Unexpected expression token.");
  }

  private matchComparison(): ComparisonOp | null {
    const token = this.peek();
    if (token?.type === "op" && isComparisonOp(token.value)) {
      this.index += 1;
      return token.value;
    }
    return null;
  }

  private matchOp(op: BinaryOp | "!"): boolean {
    const token = this.peek();
    if (token?.type === "op" && token.value === op) {
      this.index += 1;
      return true;
    }
    return false;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }
}

function isComparisonOp(value: BinaryOp | "!"): value is ComparisonOp {
  return value === "==" || value === "!=" || value === ">=" || value === "<=" || value === ">" || value === "<";
}
