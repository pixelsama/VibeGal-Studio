export type GraphConditionLiteral = string | number | boolean | null;

export type GraphConditionAst =
  | { kind: "identifier"; name: string }
  | { kind: "literal"; value: GraphConditionLiteral }
  | { kind: "unary"; op: "!"; expr: GraphConditionAst }
  | { kind: "logical"; op: "&&" | "||"; left: GraphConditionAst; right: GraphConditionAst }
  | { kind: "comparison"; op: "==" | "!=" | ">" | "<" | ">=" | "<="; left: GraphConditionAst; right: GraphConditionAst };

interface Token {
  kind: "identifier" | "number" | "string" | "boolean" | "null" | "op" | "paren" | "eof";
  value: string;
  index: number;
}

export function parseGraphCondition(source: string): { ok: true; ast: GraphConditionAst } | { ok: false; error: string } {
  try {
    const parser = new ConditionParser(source);
    return { ok: true, ast: parser.parse() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function collectConditionVariables(ast: GraphConditionAst): string[] {
  const names = new Set<string>();

  const visit = (node: GraphConditionAst) => {
    switch (node.kind) {
      case "identifier":
        names.add(node.name);
        return;
      case "literal":
        return;
      case "unary":
        visit(node.expr);
        return;
      case "logical":
      case "comparison":
        visit(node.left);
        visit(node.right);
        return;
    }
  };

  visit(ast);
  return Array.from(names).sort();
}

class ConditionParser {
  private readonly tokens: Token[];
  private index = 0;

  constructor(source: string) {
    this.tokens = tokenizeCondition(source);
  }

  parse(): GraphConditionAst {
    const ast = this.parseOr();
    this.expect("eof");
    return ast;
  }

  private parseOr(): GraphConditionAst {
    let expr = this.parseAnd();
    while (this.peekValue("||")) {
      this.consume();
      expr = { kind: "logical", op: "||", left: expr, right: this.parseAnd() };
    }
    return expr;
  }

  private parseAnd(): GraphConditionAst {
    let expr = this.parseComparison();
    while (this.peekValue("&&")) {
      this.consume();
      expr = { kind: "logical", op: "&&", left: expr, right: this.parseComparison() };
    }
    return expr;
  }

  private parseComparison(): GraphConditionAst {
    let expr = this.parseUnary();
    while (this.peek().kind === "op" && ["==", "!=", ">", "<", ">=", "<="].includes(this.peek().value)) {
      const op = this.consume().value as "==" | "!=" | ">" | "<" | ">=" | "<=";
      expr = { kind: "comparison", op, left: expr, right: this.parseUnary() };
    }
    return expr;
  }

  private parseUnary(): GraphConditionAst {
    if (this.peekValue("!")) {
      this.consume();
      return { kind: "unary", op: "!", expr: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): GraphConditionAst {
    const token = this.peek();
    if (token.kind === "identifier") {
      this.consume();
      return { kind: "identifier", name: token.value };
    }
    if (token.kind === "number") {
      this.consume();
      return { kind: "literal", value: Number(token.value) };
    }
    if (token.kind === "string") {
      this.consume();
      return { kind: "literal", value: token.value };
    }
    if (token.kind === "boolean") {
      this.consume();
      return { kind: "literal", value: token.value === "true" };
    }
    if (token.kind === "null") {
      this.consume();
      return { kind: "literal", value: null };
    }
    if (token.kind === "paren" && token.value === "(") {
      this.consume();
      const expr = this.parseOr();
      this.expectValue(")");
      return expr;
    }
    throw new Error(`无法解析条件表达式：位置 ${token.index + 1} 附近语法无效`);
  }

  private expect(kind: Token["kind"]) {
    const token = this.consume();
    if (token.kind !== kind) {
      throw new Error(`无法解析条件表达式：位置 ${token.index + 1} 期望 ${kind}`);
    }
  }

  private expectValue(value: string) {
    const token = this.consume();
    if (token.value !== value) {
      throw new Error(`无法解析条件表达式：位置 ${token.index + 1} 期望 ${value}`);
    }
  }

  private peekValue(value: string) {
    return this.peek().value === value;
  }

  private peek(): Token {
    return this.tokens[this.index] ?? this.tokens.at(-1)!;
  }

  private consume(): Token {
    const token = this.peek();
    this.index += 1;
    return token;
  }
}

function tokenizeCondition(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    const twoCharOp = source.slice(index, index + 2);
    if (["&&", "||", "==", "!=", ">=", "<="].includes(twoCharOp)) {
      tokens.push({ kind: "op", value: twoCharOp, index });
      index += 2;
      continue;
    }
    if (["!", ">", "<"].includes(char)) {
      tokens.push({ kind: "op", value: char, index });
      index += 1;
      continue;
    }
    if (["(", ")"].includes(char)) {
      tokens.push({ kind: "paren", value: char, index });
      index += 1;
      continue;
    }
    if (char === "\"" || char === "'") {
      const { value, nextIndex } = readString(source, index, char);
      tokens.push({ kind: "string", value, index });
      index = nextIndex;
      continue;
    }
    if (/[0-9]/.test(char)) {
      const match = source.slice(index).match(/^\d+(?:\.\d+)?/);
      if (!match) throw new Error(`无法解析条件表达式：位置 ${index + 1} 数字无效`);
      tokens.push({ kind: "number", value: match[0], index });
      index += match[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const match = source.slice(index).match(/^[A-Za-z_][\w.-]*/);
      if (!match) throw new Error(`无法解析条件表达式：位置 ${index + 1} 标识符无效`);
      const value = match[0];
      const kind = value === "true" || value === "false" ? "boolean" : value === "null" ? "null" : "identifier";
      tokens.push({ kind, value, index });
      index += value.length;
      continue;
    }
    throw new Error(`无法解析条件表达式：位置 ${index + 1} 字符 ${char} 不受支持`);
  }
  tokens.push({ kind: "eof", value: "", index: source.length });
  return tokens;
}

function readString(source: string, start: number, quote: string): { value: string; nextIndex: number } {
  let index = start + 1;
  let value = "";
  while (index < source.length) {
    const char = source[index];
    if (char === "\\") {
      value += source[index + 1] ?? "";
      index += 2;
      continue;
    }
    if (char === quote) {
      return { value, nextIndex: index + 1 };
    }
    value += char;
    index += 1;
  }
  throw new Error(`无法解析条件表达式：位置 ${start + 1} 字符串未闭合`);
}
