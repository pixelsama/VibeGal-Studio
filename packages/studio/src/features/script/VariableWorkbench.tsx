import { useMemo, useState } from "react";
import type { VariableDeclaration, VariableRegistry } from "@vibegal/engine";
import type { NodeEntry, ProjectGraph } from "../../lib/types";
import { analyzeGraphVariables } from "./variableAnalysis";

export function VariableWorkbench({ registry, graph, nodes, onChange }: {
  registry: VariableRegistry;
  graph: ProjectGraph;
  nodes?: NodeEntry[];
  onChange?: (registry: VariableRegistry) => void;
}) {
  const analysis = useMemo(() => analyzeGraphVariables(graph, nodes), [graph, nodes]);
  const [query, setQuery] = useState("");
  const declarations = Object.entries(registry.variables)
    .filter(([name, declaration]) => [name, declaration.label, declaration.description]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(query.toLowerCase())));
  const update = (name: string, declaration: VariableDeclaration) => onChange?.({
    ...registry,
    variables: { ...registry.variables, [name]: declaration },
  });

  return <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
    <input aria-label="搜索变量声明" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索变量" />
    {onChange && <button type="button" onClick={() => {
      let index = 1;
      while (registry.variables[`variable_${index}`]) index += 1;
      onChange(registerInferredVariable(registry, `variable_${index}`, ["string"]));
    }}>新增变量</button>}
    {declarations.map(([name, declaration]) => {
      const usage = analysis.variables.find((entry) => entry.name === name);
      const references = (usage?.writes.length ?? 0) + (usage?.reads.length ?? 0);
      return <article key={name} style={{ padding: 8, border: "1px solid var(--border)", borderRadius: 6 }}>
        <strong>{declaration.label ?? name}</strong>
        <label>
          显示名称
          <input
            aria-label={`${name} 显示名称`}
            disabled={!onChange}
            value={declaration.label ?? ""}
            onChange={(event) => update(name, {
              ...declaration,
              label: event.target.value.trim() === "" ? undefined : event.target.value,
            })}
          />
        </label>
        <label>
          说明
          <input
            aria-label={`${name} 说明`}
            disabled={!onChange}
            value={declaration.description ?? ""}
            onChange={(event) => update(name, {
              ...declaration,
              description: event.target.value,
            })}
          />
        </label>
        <label>初始值 <TypedDefaultEditor name={name} declaration={declaration} disabled={!onChange} onChange={(value) => update(name, { ...declaration, default: value })} /></label>
        <details>
          <summary>技术详情</summary>
          <div>内部标识：{name}</div>
          <label>类型 <select aria-label={`${name} 类型`} disabled={!onChange} value={declaration.type}
            onChange={(event) => update(name, changeVariableType(declaration, event.target.value as VariableDeclaration["type"]))}>
            <option value="string">文本</option><option value="number">数值</option><option value="boolean">开关</option>
          </select></label>
          <label><input aria-label={`${name} 可空`} type="checkbox" disabled={!onChange} checked={declaration.nullable}
            onChange={(event) => update(name, {
              ...declaration,
              nullable: event.target.checked,
              default: !event.target.checked && declaration.default === null ? defaultForType(declaration.type) : declaration.default,
            })} />允许未设置</label>
          <label>存储方式 <select aria-label={`${name} 作用域`} disabled={!onChange} value={declaration.scope ?? "run"}
            onChange={(event) => update(name, { ...declaration, scope: event.target.value as "run" | "global" })}>
            <option value="run">本轮游戏</option><option value="global">跨周目保存</option>
          </select></label>
          <div>写入 {usage?.writes.length ?? 0} / 读取 {usage?.reads.length ?? 0}</div>
          {onChange && <button type="button" title={references ? `仍有 ${references} 个引用；删除后会产生未声明变量诊断` : "无引用"}
            onClick={() => { const variables = { ...registry.variables }; delete variables[name]; onChange({ ...registry, variables }); }}>
            删除声明{references ? `（${references} 个引用）` : ""}
          </button>}
        </details>
      </article>;
    })}
    {analysis.variables.filter((entry) => !registry.variables[entry.name]).map((entry) => <article key={entry.name} style={{ color: "var(--status-warn-text)" }}>
      未声明：{entry.name} · 推断 {entry.types.join("/") || "unknown"}
      {onChange && <button type="button" onClick={() => onChange(registerInferredVariable(registry, entry.name, entry.types))}>登记推断变量</button>}
    </article>)}
  </section>;
}

function TypedDefaultEditor({ name, declaration, disabled, onChange }: {
  name: string;
  declaration: VariableDeclaration;
  disabled: boolean;
  onChange: (value: string | number | boolean | null) => void;
}) {
  const isNull = declaration.default === null;
  return <div>
    {declaration.nullable && <label><input aria-label={`${name} 默认空值`} type="checkbox" disabled={disabled} checked={isNull}
      onChange={(event) => onChange(event.target.checked ? null : defaultForType(declaration.type))} />初始状态：未设置</label>}
    {!isNull && (declaration.type === "boolean" ? <select aria-label={`${name} 默认值`} disabled={disabled} value={String(declaration.default)}
      onChange={(event) => onChange(event.target.value === "true")}><option value="true">开启</option><option value="false">关闭</option></select>
      : <input aria-label={`${name} 默认值`} disabled={disabled} type={declaration.type === "number" ? "number" : "text"}
        value={String(declaration.default)} onChange={(event) => onChange(declaration.type === "number" ? Number(event.target.value) : event.target.value)} />)}
  </div>;
}

export function registerInferredVariable(registry: VariableRegistry, name: string, inferred: string[]): VariableRegistry {
  if (registry.variables[name]) return registry;
  const type: VariableDeclaration["type"] = inferred.length === 1 && ["string", "number", "boolean"].includes(inferred[0])
    ? inferred[0] as VariableDeclaration["type"] : "string";
  return {
    ...registry,
    variables: { ...registry.variables, [name]: { type, default: defaultForType(type), nullable: false, scope: "run", description: "" } },
  };
}

export function changeVariableType(declaration: VariableDeclaration, type: VariableDeclaration["type"]): VariableDeclaration {
  return { ...declaration, type, default: defaultForType(type) };
}

function defaultForType(type: VariableDeclaration["type"]): string | number | boolean {
  return type === "number" ? 0 : type === "boolean" ? false : "";
}
