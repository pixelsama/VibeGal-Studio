import { useMemo } from "react";
import {
  formatExpression,
  type BinaryOp,
  type ExpressionAst,
  type VariableRegistry,
} from "@vibegal/engine";
import { parseGraphCondition } from "./graphCondition";

type Comparison = Extract<ExpressionAst, { type: "binary" }> & {
  left: Extract<ExpressionAst, { type: "var" }>;
  right: Extract<ExpressionAst, { type: "literal" }>;
};

const COMPARISONS: BinaryOp[] = ["==", "!=", ">", "<", ">=", "<="];

export function ConditionBuilder({ source, registry, onChange }: {
  source: string;
  registry?: VariableRegistry;
  onChange: (source: string) => void;
}) {
  const parsed = useMemo(() => parseGraphCondition(source), [source]);
  if (!source || !parsed.ok || !isVisualConditionAst(parsed.ast)) {
    return <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
      源码模式{source && parsed.ok ? "（该表达式暂不支持可视化往返）" : ""}
    </div>;
  }
  const apply = (ast: ExpressionAst) => onChange(formatExpression(ast));
  return <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
    <VisualExpression ast={parsed.ast} registry={registry} onChange={apply} />
    <div style={{ display: "flex", gap: 4 }}>
      <button type="button" onClick={() => apply(addLogicalClause(parsed.ast, "&&", registry))}>+ AND</button>
      <button type="button" onClick={() => apply(addLogicalClause(parsed.ast, "||", registry))}>+ OR</button>
    </div>
  </div>;
}

function VisualExpression({ ast, registry, onChange }: {
  ast: ExpressionAst;
  registry?: VariableRegistry;
  onChange: (ast: ExpressionAst) => void;
}) {
  if (isComparison(ast)) return <ComparisonEditor comparison={ast} registry={registry} onChange={onChange} />;
  if (ast.type !== "binary" || (ast.op !== "&&" && ast.op !== "||")) return null;
  return <fieldset style={{ display: "flex", flexDirection: "column", gap: 4 }}>
    <legend>{ast.op === "&&" ? "AND" : "OR"}</legend>
    <VisualExpression ast={ast.left} registry={registry} onChange={(left) => onChange({ ...ast, left })} />
    <VisualExpression ast={ast.right} registry={registry} onChange={(right) => onChange({ ...ast, right })} />
  </fieldset>;
}

function ComparisonEditor({ comparison, registry, onChange }: {
  comparison: Comparison;
  registry?: VariableRegistry;
  onChange: (ast: ExpressionAst) => void;
}) {
  const names = Object.keys(registry?.variables ?? {});
  const declaration = registry?.variables[comparison.left.name];
  const operators: BinaryOp[] = declaration?.type === "number" ? COMPARISONS : ["==", "!="];
  const value = comparison.right.value;
  const updateValue = (raw: string) => {
    const next = declaration?.type === "number" ? Number(raw)
      : declaration?.type === "boolean" ? raw === "true"
      : raw;
    onChange({ ...comparison, right: { type: "literal", value: next } });
  };
  return <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 4 }}>
    <select value={comparison.left.name} onChange={(event) => {
      const name = event.target.value;
      onChange({ ...comparison, left: { type: "var", name }, right: defaultLiteral(registry?.variables[name]?.type) });
    }}>
      {names.map((name) => <option key={name}>{name}</option>)}
    </select>
    <select value={comparison.op} onChange={(event) => onChange({ ...comparison, op: event.target.value as BinaryOp })}>
      {operators.map((operator) => <option key={operator}>{operator}</option>)}
    </select>
    {declaration?.type === "boolean" ? <select value={String(value)} onChange={(event) => updateValue(event.target.value)}>
      <option value="true">true</option><option value="false">false</option>
    </select> : <input type={declaration?.type === "number" ? "number" : "text"} value={String(value)} onChange={(event) => updateValue(event.target.value)} />}
  </div>;
}

export function isVisualConditionAst(ast: ExpressionAst): boolean {
  if (isComparison(ast)) return true;
  return ast.type === "binary" && (ast.op === "&&" || ast.op === "||")
    && isVisualConditionAst(ast.left) && isVisualConditionAst(ast.right);
}

export function addLogicalClause(ast: ExpressionAst, op: "&&" | "||", registry?: VariableRegistry): ExpressionAst {
  const name = Object.keys(registry?.variables ?? {})[0] ?? "variable";
  return {
    type: "binary",
    op,
    left: ast,
    right: { type: "binary", op: "==", left: { type: "var", name }, right: defaultLiteral(registry?.variables[name]?.type) },
  };
}

function isComparison(ast: ExpressionAst): ast is Comparison {
  return ast.type === "binary" && COMPARISONS.includes(ast.op)
    && ast.left.type === "var" && ast.right.type === "literal";
}

function defaultLiteral(type?: "string" | "number" | "boolean"): Extract<ExpressionAst, { type: "literal" }> {
  return { type: "literal", value: type === "number" ? 0 : type === "boolean" ? false : "" };
}
