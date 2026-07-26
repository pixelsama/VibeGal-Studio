/**
 * 故事状态的领域模型 —— 变量面板、条件编辑器和分流规则表共用这一层。
 *
 * 界面上的名词全部由这里产出：作者看到的是「雪·好感度」「拿到钥匙 已发生」，
 * 而不是 `affection_yuki >= 60` 或 `has_key == true`。引擎侧的表达式文法完全
 * 不变，本模块只负责在「作者说的话」和「表达式字符串」之间双向翻译。
 */
import {
  formatExpression,
  parseExpression,
  variableBandLowerBound,
  variableKind,
  type ExpressionAst,
  type Manifest,
  type VariableDeclaration,
  type VariableKind,
  type VariableRegistry,
} from "@vibegal/engine";
import type { ProjectGraph } from "../../lib/types";

// ── 词汇表 ─────────────────────────────────────────────────────────────
// 用途名一律是作者会说的词；实现术语（boolean/number/string）只出现在技术详情里。

export const KIND_LABEL: Record<VariableKind, string> = {
  flag: "是否发生",
  meter: "数值",
  state: "状态",
  counter: "次数",
  text: "文本",
};

export const KIND_HINT: Record<VariableKind, string> = {
  flag: "记录一件事发生了没有，比如「拿到钥匙」",
  meter: "可增可减的数值，比如好感度、信任度",
  state: "在几个固定状态里选一个，比如当前走的是哪条线",
  counter: "累计次数，比如见面了几次",
  text: "自由文本，比如玩家取的名字",
};

export const SCOPE_LABEL: Record<"run" | "global", string> = {
  run: "本轮游戏",
  global: "跨周目保存",
};

/** 只读命名空间在界面上的分组名。 */
export const EXPERIENCE_GROUP = "剧情经历";
export const SYSTEM_GROUP = "系统状态";

// ── 可引用的故事状态 ───────────────────────────────────────────────────

export type StateSourceKind = VariableKind | "chose" | "seen" | "system";

export interface StateSource {
  /** 表达式里的标识符，如 `affection_yuki` / `chose.start__left`。 */
  name: string;
  /** 作者看到的名字，如「雪 · 好感度」。 */
  label: string;
  kind: StateSourceKind;
  /** 下拉框里的分组标题。 */
  group: string;
  /** 只读来源不能被写入，也不能在故事状态面板里编辑。 */
  readonly: boolean;
  declaration?: VariableDeclaration;
}

/** 变量的展示名：优先 label，其次「角色 · 名称」，最后退回内部标识。 */
export function variableLabel(
  name: string,
  declaration: VariableDeclaration | undefined,
  manifest?: Manifest,
): string {
  const own = declaration?.label?.trim();
  const character = declaration?.of ? manifest?.characters?.[declaration.of]?.name ?? declaration.of : null;
  if (own && character) return `${character} · ${own}`;
  if (own) return own;
  if (character) return `${character} · ${name}`;
  return name;
}

/**
 * 汇总条件里可以引用的一切故事状态：声明变量 + 剧情经历 + 系统状态。
 *
 * 剧情经历（chose./seen.）不需要作者声明任何东西就能用 —— 这是这次重构里
 * 唯一真正减少工作量的部分，所以它和声明变量并列出现在同一个选择器里。
 */
export function collectStateSources(input: {
  registry?: VariableRegistry;
  graph?: ProjectGraph;
  manifest?: Manifest;
}): StateSource[] {
  const sources: StateSource[] = [];

  for (const [name, declaration] of Object.entries(input.registry?.variables ?? {})) {
    const kind = variableKind(declaration);
    sources.push({
      name,
      label: variableLabel(name, declaration, input.manifest),
      kind,
      group: KIND_LABEL[kind],
      readonly: false,
      declaration,
    });
  }

  const nodeTitle = new Map((input.graph?.nodes ?? []).map((node) => [node.id, node.title || node.id]));
  for (const edge of input.graph?.edges ?? []) {
    if ((edge.mode ?? "linear") !== "choice") continue;
    const from = nodeTitle.get(edge.from) ?? edge.from;
    const option = edge.label?.trim() || nodeTitle.get(edge.to) || edge.to;
    sources.push({
      name: `chose.${edge.id}`,
      label: `在「${from}」选了「${option}」`,
      kind: "chose",
      group: EXPERIENCE_GROUP,
      readonly: true,
    });
  }
  for (const node of input.graph?.nodes ?? []) {
    sources.push({
      name: `seen.${node.id}`,
      label: `到过「${node.title || node.id}」`,
      kind: "seen",
      group: EXPERIENCE_GROUP,
      readonly: true,
    });
  }

  sources.push(
    { name: "system.playthroughCount", label: "通关次数", kind: "system", group: SYSTEM_GROUP, readonly: true },
    { name: "system.lastEndingId", label: "上次达成的结局", kind: "system", group: SYSTEM_GROUP, readonly: true },
  );

  return sources;
}

/**
 * 试算用的默认值。
 *
 * 必须覆盖只读命名空间：早期实现只取声明变量，于是任何引用通关次数或剧情经历
 * 的条件都会在 Inspector 里被报成「未知变量」——一个纯粹由试算环境不完整导致
 * 的误报。
 */
export function stateSourceDefaults(sources: StateSource[]): Record<string, string | number | boolean | null> {
  return Object.fromEntries(sources.map((source) => [source.name, defaultForSource(source)]));
}

function defaultForSource(source: StateSource): string | number | boolean | null {
  if (source.declaration) return source.declaration.default;
  if (source.kind === "system") return source.name === "system.playthroughCount" ? 0 : null;
  return false;
}

// ── 句子化条件 ─────────────────────────────────────────────────────────

/** 作者能看懂的比较方式。每一项都对应一段确定的表达式。 */
export type ClauseOperator =
  | "happened"      // flag / chose / seen：已发生
  | "notHappened"   // 未发生
  | "atLeast"       // 数值 >= n（含「达到某分段」）
  | "atMost"        // 数值 <= n
  | "is"            // 状态/文本 == v
  | "isNot";        // 状态/文本 != v

export interface ConditionClause {
  source: string;
  operator: ClauseOperator;
  /** happened/notHappened 不带值。 */
  value?: string | number | boolean;
}

export interface ConditionSentence {
  /** all = 全部满足（&&），any = 任一满足（||）。 */
  join: "all" | "any";
  clauses: ConditionClause[];
}

/**
 * 把表达式解析成句子。
 *
 * 只接受扁平的同构与或链 —— 这覆盖了绝大多数真实条件，而嵌套括号一旦出现就
 * 落回表达式模式，不做半吊子的可视化。返回 null 表示「这条得用表达式编辑」。
 */
export function parseConditionSentence(source: string): ConditionSentence | null {
  const trimmed = source.trim();
  if (!trimmed) return null;
  let ast: ExpressionAst;
  try {
    ast = parseExpression(trimmed);
  } catch {
    return null;
  }
  const join = topLevelJoin(ast);
  const parts = join ? flattenJoin(ast, join === "all" ? "&&" : "||") : [ast];
  const clauses: ConditionClause[] = [];
  for (const part of parts) {
    const clause = parseClause(part);
    if (!clause) return null;
    clauses.push(clause);
  }
  return { join: join ?? "all", clauses };
}

function topLevelJoin(ast: ExpressionAst): "all" | "any" | null {
  if (ast.type !== "binary") return null;
  if (ast.op === "&&") return "all";
  if (ast.op === "||") return "any";
  return null;
}

/** 摊平同一种连接符的链条；混用 && 和 || 时返回 null 触发表达式模式。 */
function flattenJoin(ast: ExpressionAst, op: "&&" | "||"): ExpressionAst[] {
  if (ast.type !== "binary" || ast.op !== op) return [ast];
  return [...flattenJoin(ast.left, op), ...flattenJoin(ast.right, op)];
}

function parseClause(ast: ExpressionAst): ConditionClause | null {
  // 裸变量 `has_key` 与取反 `!has_key` —— 作者最自然的写法，
  // 旧的可视化构建器恰好两种都不支持。
  if (ast.type === "var") return { source: ast.name, operator: "happened" };
  if (ast.type === "unary" && ast.op === "!" && ast.expr.type === "var") {
    return { source: ast.expr.name, operator: "notHappened" };
  }
  if (ast.type !== "binary" || ast.left.type !== "var" || ast.right.type !== "literal") return null;
  const source = ast.left.name;
  const value = ast.right.value;
  if (value === null) return null;
  switch (ast.op) {
    case "==":
      if (typeof value === "boolean") return { source, operator: value ? "happened" : "notHappened" };
      return { source, operator: "is", value };
    case "!=":
      if (typeof value === "boolean") return { source, operator: value ? "notHappened" : "happened" };
      return { source, operator: "isNot", value };
    case ">=":
      return typeof value === "number" ? { source, operator: "atLeast", value } : null;
    case "<=":
      return typeof value === "number" ? { source, operator: "atMost", value } : null;
    default:
      return null;
  }
}

/** 把句子写回表达式字符串。空句子返回空串，即「默认边」。 */
export function formatConditionSentence(sentence: ConditionSentence): string {
  if (sentence.clauses.length === 0) return "";
  const asts = sentence.clauses.map(clauseToAst);
  const op = sentence.join === "all" ? "&&" : "||";
  const combined = asts.reduce((left, right) => ({ type: "binary" as const, op, left, right }));
  return formatExpression(combined);
}

function clauseToAst(clause: ConditionClause): ExpressionAst {
  const variable = { type: "var" as const, name: clause.source };
  switch (clause.operator) {
    case "happened":
      return variable;
    case "notHappened":
      return { type: "unary", op: "!", expr: variable };
    case "atLeast":
      return { type: "binary", op: ">=", left: variable, right: { type: "literal", value: Number(clause.value ?? 0) } };
    case "atMost":
      return { type: "binary", op: "<=", left: variable, right: { type: "literal", value: Number(clause.value ?? 0) } };
    case "is":
      return { type: "binary", op: "==", left: variable, right: { type: "literal", value: clause.value ?? "" } };
    case "isNot":
      return { type: "binary", op: "!=", left: variable, right: { type: "literal", value: clause.value ?? "" } };
  }
}

/** 某个来源支持哪些比较方式。 */
export function operatorsForSource(source: StateSource | undefined): ClauseOperator[] {
  const kind = source?.kind ?? "text";
  if (kind === "flag" || kind === "chose" || kind === "seen") return ["happened", "notHappened"];
  if (kind === "meter" || kind === "counter") return ["atLeast", "atMost"];
  if (kind === "system") return source?.name === "system.playthroughCount" ? ["atLeast", "atMost"] : ["is", "isNot"];
  return ["is", "isNot"];
}

export const OPERATOR_LABEL: Record<ClauseOperator, string> = {
  happened: "已发生",
  notHappened: "还没发生",
  atLeast: "达到",
  atMost: "不超过",
  is: "是",
  isNot: "不是",
};

/** 新建子句时的默认形态，保证一插入就是合法条件。 */
export function defaultClause(source: StateSource | undefined): ConditionClause {
  const operator = operatorsForSource(source)[0];
  if (operator === "happened" || operator === "notHappened") {
    return { source: source?.name ?? "", operator };
  }
  if (operator === "atLeast" || operator === "atMost") {
    return { source: source?.name ?? "", operator, value: source?.declaration?.min ?? 0 };
  }
  const options = source?.declaration?.options;
  return { source: source?.name ?? "", operator, value: options?.[0]?.id ?? "" };
}

/** 分段名 → 该分段的起始值，用于「好感度 达到 喜欢」这类选择。 */
export function bandThreshold(declaration: VariableDeclaration | undefined, bandId: string): number {
  const lower = variableBandLowerBound(declaration, bandId);
  // 分段的下界是「上一段的 upTo」，即上一段的最后一个命中值，所以门槛是它 +1。
  return lower == null ? declaration?.min ?? 0 : lower + 1;
}

/** 数值落在哪个分段（用于把当前值显示成「喜欢」）。 */
export function bandLabelForValue(declaration: VariableDeclaration | undefined, value: number): string | undefined {
  return declaration?.bands?.find((band) => band.upTo == null || value <= band.upTo)?.label;
}

// ── 诊断改写 ───────────────────────────────────────────────────────────

/**
 * 把静态分析的 issue code 翻译成作者能照做的一句话。
 *
 * 原实现直接把 `read_before_write` / `write_without_read` / `type_conflict`
 * 当徽章渲染出来 —— 那是给写这段分析代码的人看的，不是给写故事的人看的。
 */
export function describeVariableIssue(
  issue: { code: string; message: string; severity: "error" | "warn" },
  name: string,
  registry?: VariableRegistry,
  manifest?: Manifest,
): { code: string; message: string; fix?: string; severity: "error" | "warn" } {
  const declaration = registry?.variables[name];
  const label = variableLabel(name, declaration, manifest);

  switch (issue.code) {
    case "read_before_write":
      return {
        code: issue.code,
        severity: "error",
        message: `分流用到了「${label}」，但整个故事里没有任何地方改变它。`,
        fix: "这条分支永远走不到。在某个节点里加一处改动，或者改用玩家的选择来判断。",
      };
    case "write_without_read":
      return {
        code: issue.code,
        severity: "warn",
        message: `「${label}」会被改变，但没有任何分流用到它。`,
        fix: declaration?.displayOnly
          ? undefined
          : "如果它只是给界面显示用的，可以在它的技术详情里打开「仅用于界面显示」，这条提示就不再出现。",
      };
    case "type_conflict":
      return {
        code: issue.code,
        severity: "warn",
        message: `「${label}」在不同地方被写成了不一样的东西（有时是文字，有时是数字）。`,
        fix: "统一成一种，否则分流判断的结果会不稳定。",
      };
    default:
      return { code: issue.code, severity: issue.severity, message: issue.message };
  }
}
