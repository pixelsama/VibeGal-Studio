import type { VariableBand, VariableDeclaration, VariableKind, VariableRegistry, Instruction, ChoiceInstr } from "./types";
import type { GraphRouteValue } from "./graphRouting";
import type { DecisionLogEvent } from "./runtimeContract";
import type { ProjectGraphData } from "./types";

export const EMPTY_VARIABLE_REGISTRY: VariableRegistry = { version: 1, variables: {} };

/**
 * Namespaces the runtime owns. Projects may never declare or write these:
 * - `system.*`  runtime facts (playthrough count, last ending)
 * - `chose.*`   Spec 35: one entry per `chose.<choiceInstructionId>.<optionIndex>`,
 *               true once the player picked that option. Keyed by choice 指令的 id
 *               与选项下标（无 id 的 choice 不参与追踪）。
 * - `seen.*`    one entry per node, true once the player reached it
 *
 * `chose.`/`seen.` are derived from the decision log rather than stored, so a
 * save slot never drifts from the path that actually happened, and rollback
 * automatically un-sets them.
 */
export const READONLY_VARIABLE_PREFIXES = ["system.", "chose.", "seen."] as const;

export function isReadonlyVariableName(name: string): boolean {
  return READONLY_VARIABLE_PREFIXES.some((prefix) => name.startsWith(prefix));
}

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

// ── 用途（kind）─────────────────────────────────────────────────────────
// kind 是 type 之上的一层透镜，不是替代品：type 仍然是权威的运行时类型。
// 旧 registry 没有 kind 时按 type 回退，因此老项目无需迁移即可被新界面读懂。

const KIND_BY_TYPE: Record<VariableDeclaration["type"], VariableKind> = {
  boolean: "flag",
  number: "meter",
  string: "text",
};

export function variableKind(declaration: VariableDeclaration | undefined): VariableKind {
  if (!declaration) return "text";
  if (declaration.kind) return declaration.kind;
  // 未声明 kind 但列了可选值的旧变量，实际语义就是枚举状态。
  if (declaration.type === "string" && (declaration.options?.length ?? 0) > 0) return "state";
  return KIND_BY_TYPE[declaration.type];
}

export function variableTypeForKind(kind: VariableKind): VariableDeclaration["type"] {
  return kind === "flag" ? "boolean" : kind === "meter" || kind === "counter" ? "number" : "string";
}

// ── 范围与分段 ──────────────────────────────────────────────────────────

/**
 * 写入时按声明范围钳制。范围是后加的可选字段，缺省即无界，所以早于该字段的
 * 项目运行结果完全不变；只有作者显式填了范围才会生效。
 */
export function clampVariableValue(
  value: GraphRouteValue,
  declaration: VariableDeclaration | undefined,
): GraphRouteValue {
  if (typeof value !== "number" || !declaration) return value;
  let next = value;
  if (declaration.min != null) next = Math.max(declaration.min, next);
  if (declaration.max != null) next = Math.min(declaration.max, next);
  return next;
}

/**
 * 分段的下界（不含）：上一段的 upTo。首段没有下界。
 *
 * 分段只是取值的命名辅助 —— 条件里存的始终是数字字面量，不是分段 id。
 * 这样作者以后改分段名或边界，已经写好的条件不会被静默改变含义。
 */
export function variableBandLowerBound(
  declaration: VariableDeclaration | undefined,
  bandId: string,
): number | undefined {
  const bands = declaration?.bands ?? [];
  const index = bands.findIndex((band) => band.id === bandId);
  if (index <= 0) return undefined;
  return bands[index - 1].upTo;
}

/** 数值落在哪一段。用于把 `好感度 62` 显示成「喜欢」。 */
export function variableBandAt(
  value: GraphRouteValue,
  declaration: VariableDeclaration | undefined,
): VariableBand | undefined {
  if (typeof value !== "number") return undefined;
  return declaration?.bands?.find((band) => band.upTo == null || value <= band.upTo);
}

// ── 剧情经历（chose. / seen.）───────────────────────────────────────────

/**
 * Spec 35：经历变量（`chose.*` / `seen.*`）的来源从「图 choice 边」迁移到
 * 「节点内 choice 指令」。
 *
 * - `seen.<nodeId>`：节点被到达过。仍从 graph.nodes 派生。
 * - `chose.<choiceInstructionId>.<optionIndex>`：玩家选过某个选项。从节点指令
 *   序列里的 `choice` 指令派生；只有带 `id` 的 choice 指令参与追踪，没有 `id`
 *   的（不关心是否选过的简单选项）不记账。
 *
 * 先把每个可达经历落一个 false，这样条件引用一个还没发生的经历时是「不成立」，
 * 而不是求值报 unknown_variable 把玩家卡住。
 *
 * `nodeEntries` 接受 `{ id, instructions }` 形态，因为引擎用 instructionsByNodeId
 * Map 持有节点内容；graph.nodes 只描述结构，不含指令。
 */
export interface ExperienceNodeEntry {
  id: string;
  instructions: readonly Instruction[];
}

export function storyExperienceVariables(
  graph: Pick<ProjectGraphData, "nodes" | "edges"> | null | undefined,
  nodeEntries: readonly ExperienceNodeEntry[] | null | undefined,
  decisions: readonly DecisionLogEvent[],
): Record<string, boolean> {
  const experience: Record<string, boolean> = {};
  for (const node of graph?.nodes ?? []) experience[`seen.${node.id}`] = false;

  // 预置所有带 id 的 choice 指令的每个选项为 false。
  // 嵌套在 if.then / choice.options[].body 里的 choice 也要扫到，所以递归遍历。
  for (const entry of nodeEntries ?? []) {
    for (const choice of findChoiceInstructions(entry.instructions)) {
      if (!choice.id) continue; // 无 id = 不追踪
      choice.options.forEach((_option, optionIndex) => {
        experience[`chose.${choice.id}.${optionIndex}`] = false;
      });
    }
  }

  for (const event of decisions) {
    if (event.type === "start") experience[`seen.${event.nodeId}`] = true;
    else if (event.type === "checkpoint") experience[`seen.${event.snapshot.currentNodeId}`] = true;
    else {
      experience[`seen.${event.toNodeId}`] = true;
      // 只有玩家自己做的选择算「选过」；条件路由（auto）由条件本身表达，不重复记账。
      if (event.type === "choice" && event.choiceInstructionId != null && event.optionIndex != null) {
        experience[`chose.${event.choiceInstructionId}.${event.optionIndex}`] = true;
      }
    }
  }
  return experience;
}

/** 递归收集指令序列（含 if.then/else、choice.options[].body）里所有 choice 指令。 */
function findChoiceInstructions(instructions: readonly Instruction[]): ChoiceInstr[] {
  const found: ChoiceInstr[] = [];
  const walk = (list: readonly Instruction[]): void => {
    for (const instr of list) {
      if (instr.t === "choice") {
        found.push(instr);
        for (const option of instr.options) {
          if (option.body) walk(option.body);
        }
      } else if (instr.t === "if") {
        walk(instr.then);
        if (instr.else) walk(instr.else);
      }
    }
  };
  walk(instructions);
  return found;
}

/**
 * 一次故事状态改变，供预览的「剧情检查」解释「这个值是哪来的」。
 *
 * 只存在内存里，不进存档：它是创作期的调试辅助，玩家永远看不到，进存档只会
 * 撑大档案并绑住 `RUNTIME_RECORD_SCHEMA_VERSION`。
 *
 * `instructionIndex` 用数组下标而不是稳定指令 ID：run-scope 的 `set` 本来就不发
 * 稳定 ID（只有 say/narrate/wait/pause 和 global set 有），而跳转发生在同一次预览
 * 会话内、项目文件未被改动，下标是稳定的。
 */
export interface StateWriteEvent {
  variable: string;
  from: GraphRouteValue;
  to: GraphRouteValue;
  nodeId: string;
  /** 节点内指令的下标；来自出口效果时为 undefined。 */
  instructionIndex?: number;
  /** 有值表示这次改变来自「走这条出口之后」，而不是节点里的某条指令。 */
  edgeId?: string;
  /** Spec 35：有值表示这次改变来自玩家选了某个 choice 选项之后的 effects。 */
  choiceInstructionId?: string;
  /** Spec 35：与 choiceInstructionId 配对，标记选了第几个选项。 */
  optionIndex?: number;
  /**
   * 记录这次写入时决策日志的长度，用于回滚时精确裁剪：
   * 回滚把决策日志截到长度 L 后，保留 decisionIndex <= L 的写入。
   */
  decisionIndex: number;
}

export function assertVariableValue(
  name: string,
  value: GraphRouteValue,
  declaration: VariableDeclaration | undefined,
): void {
  if (isReadonlyVariableName(name)) throw new Error(`只读变量不能写入：${name}`);
  if (!declaration) return;
  if (value === null && declaration.nullable) return;
  if (typeof value !== declaration.type) throw new Error(`变量 ${name} 要求 ${declaration.type}，实际为 ${value === null ? "null" : typeof value}`);
}

export function effectiveVariables(input: {
  run: Record<string, GraphRouteValue>;
  global: Record<string, GraphRouteValue>;
  playthroughCount: number;
  lastEndingId: string | null;
  experience?: Record<string, boolean>;
}): Record<string, GraphRouteValue> {
  return {
    ...input.run,
    ...input.global,
    ...input.experience,
    "system.playthroughCount": input.playthroughCount,
    "system.lastEndingId": input.lastEndingId,
  };
}
