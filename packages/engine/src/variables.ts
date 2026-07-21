import type { VariableDeclaration, VariableRegistry } from "./types";
import type { GraphRouteValue } from "./graphRouting";

export const EMPTY_VARIABLE_REGISTRY: VariableRegistry = { version: 1, variables: {} };

export function variableDefaults(
  registry: VariableRegistry | undefined,
  scope: "run" | "global",
): Record<string, GraphRouteValue> {
  return Object.fromEntries(Object.entries(registry?.variables ?? {})
    .filter(([, declaration]) => (declaration.scope ?? "run") === scope)
    .map(([name, declaration]) => [name, declaration.default]));
}

export function variableDeclaration(
  registry: VariableRegistry | undefined,
  name: string,
): VariableDeclaration | undefined {
  return registry?.variables[name];
}

export function assertVariableValue(
  name: string,
  value: GraphRouteValue,
  declaration: VariableDeclaration | undefined,
): void {
  if (name.startsWith("system.")) throw new Error(`只读系统变量不能写入：${name}`);
  if (!declaration) return;
  if (value === null && declaration.nullable) return;
  if (typeof value !== declaration.type) throw new Error(`变量 ${name} 要求 ${declaration.type}，实际为 ${value === null ? "null" : typeof value}`);
}

export function effectiveVariables(input: {
  run: Record<string, GraphRouteValue>;
  global: Record<string, GraphRouteValue>;
  playthroughCount: number;
  lastEndingId: string | null;
}): Record<string, GraphRouteValue> {
  return {
    ...input.run,
    ...input.global,
    "system.playthroughCount": input.playthroughCount,
    "system.lastEndingId": input.lastEndingId,
  };
}
