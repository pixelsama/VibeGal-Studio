/**
 * 分流规则表 —— 节点的出口该怎么走。
 *
 * 原实现把求值过程直接暴露给作者：一行一个自由文本条件框，靠拖拽决定优先级，
 * 空条件被强制钉到最后并显示成「默认边 · 最后兜底」。作者必须自己理解
 * 「顺序即优先级」和「空 = 兜底」。
 *
 * 这里改成读得懂的规则表：「如果 …… 否则 ……」，兜底行明确渲染成「否则」，
 * 遮蔽（前序条件已经覆盖后序）写成一句话并给出可执行的修复建议。
 */
import { useState } from "react";
import { ChevronDown, ChevronUp, GripVertical, TriangleAlert } from "lucide-react";
import { evaluateGraphConditionResult, type VariableRegistry } from "@vibegal/engine";
import type { GraphEdge, ProjectGraph } from "../../lib/types";
import { IconButton } from "../common/Button";
import { SegmentedControl, SentenceRow, TextInput } from "../common/Form";
import { translateZhCN, useStudioI18n, type StudioTranslator } from "../../lib/i18n";
import { ConditionEditor } from "./ConditionEditor";
import { EdgeEffectsEditor } from "./EdgeEffectsEditor";
import { StateTrial } from "./StateTrial";
import type { StateSource } from "./storyState";

export type BranchMode = "choice" | "auto";

export interface BranchRulesProps {
  graph: ProjectGraph;
  nodeId: string;
  edges: GraphEdge[];
  sources: StateSource[];
  /** 编辑出口效果需要声明表：按用途决定「增加/减少/设为」的控件。 */
  registry?: VariableRegistry;
  disabled?: boolean;
  onChange: (edges: GraphEdge[]) => void;
  /** 表达式无法句子化时，交给宿主打开高级表达式编辑器。 */
  onEditExpression?: (edge: GraphEdge) => void;
  /** 试算值；与预览调试会话共用同一份，避免 Inspector 与预览各有一套。 */
  trialValues: Record<string, string | number | boolean | null>;
  onTrialChange: (values: Record<string, string | number | boolean | null>) => void;
}

export function BranchRules({
  graph,
  nodeId,
  edges,
  sources,
  registry,
  disabled,
  onChange,
  onEditExpression,
  trialValues,
  onTrialChange,
}: BranchRulesProps) {
  const { t } = useStudioI18n();
  const [dragging, setDragging] = useState<string | null>(null);

  if (edges.length === 0) {
    return <p className="gs-branch__single">{t("script.branch.terminal")}</p>;
  }
  if (edges.length === 1) {
    return (
      <p className="gs-branch__single">
        {t("script.branch.singleExit", { title: targetTitle(graph, edges[0].to, t) })}
      </p>
    );
  }

  const mode: BranchMode = edges.every((edge) => edge.mode === "auto") ? "auto" : "choice";
  const applyMode = (next: BranchMode) => {
    const normalized = edges.map((edge, index) => normalizeBranchEdge(graph, nodeId, edge, index, next));
    onChange(next === "auto" ? orderDefaultAutoEdgeLast(normalized) : normalized);
  };
  const updateEdge = (edgeId: string, patch: Partial<GraphEdge>) => {
    const next = edges.map((edge, index) => {
      const normalized = normalizeBranchEdge(graph, nodeId, edge, index, mode);
      return normalized.id === edgeId ? normalizeEdge({ ...normalized, ...patch, mode }) : normalized;
    });
    onChange(mode === "auto" ? orderDefaultAutoEdgeLast(next) : next);
  };

  const outcomes = mode === "auto" ? evaluateBranchOutcomes(edges, trialValues, t) : null;

  return (
    <div className="gs-branch">
      <SegmentedControl<BranchMode>
        aria-label={t("script.branch.modeLabel")}
        value={mode}
        disabled={disabled}
        options={[
          { value: "choice", label: t("script.branch.mode.choice") },
          { value: "auto", label: t("script.branch.mode.auto") },
        ]}
        onChange={applyMode}
      />

      {mode === "auto" && <p className="gs-branch__rule-hint">{t("script.branch.orderHint")}</p>}

      <ol className="gs-branch__list">
        {edges.map((edge, index) => {
          const outcome = outcomes?.[index];
          const isFallback = mode === "auto" && !edge.condition?.trim();
          return (
            <li
              key={edge.id}
              className={`gs-branch__row${outcome?.winner ? " gs-branch__row--winner" : ""}`}
              draggable={!disabled && !isFallback}
              onDragStart={() => setDragging(edge.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (dragging && dragging !== edge.id) {
                  const reordered = moveEdgeById(edges, dragging, edge.id);
                  onChange(mode === "auto" ? orderDefaultAutoEdgeLast(reordered) : reordered);
                }
                setDragging(null);
              }}
            >
              <div className="gs-branch__row-head">
                {mode === "auto" && !isFallback && <span className="gs-branch__index">{index + 1}</span>}
                {isFallback && (
                  <span className="gs-branch__index gs-branch__index--fallback">
                    {t("script.branch.fallback")}
                  </span>
                )}
                <span className="gs-branch__target">
                  {t("script.branch.target", { title: targetTitle(graph, edge.to, t) })}
                </span>
                {!disabled && !isFallback && (
                  <span className="gs-branch__reorder">
                    <GripVertical size={14} aria-hidden="true" />
                    <IconButton
                      aria-label={t("script.branch.moveUp", { id: edge.id })}
                      disabled={index === 0}
                      onClick={() => onChange(orderAfterMove(edges, index, -1, mode))}
                    >
                      <ChevronUp size={14} aria-hidden="true" />
                    </IconButton>
                    <IconButton
                      aria-label={t("script.branch.moveDown", { id: edge.id })}
                      disabled={index === edges.length - 1}
                      onClick={() => onChange(orderAfterMove(edges, index, 1, mode))}
                    >
                      <ChevronDown size={14} aria-hidden="true" />
                    </IconButton>
                  </span>
                )}
              </div>

              {mode === "choice" ? (
                <SentenceRow lead={t("script.branch.choiceText")}>
                  <TextInput
                    aria-label={t("script.branch.choiceTextFor", {
                      title: targetTitle(graph, edge.to, t),
                    })}
                    disabled={disabled}
                    value={edge.label ?? targetTitle(graph, edge.to, t)}
                    onChange={(label) => updateEdge(edge.id, { mode: "choice", label, condition: null })}
                  />
                </SentenceRow>
              ) : (
                <ConditionEditor
                  source={edge.condition ?? ""}
                  sources={sources}
                  disabled={disabled}
                  onEditExpression={!disabled && onEditExpression ? () => onEditExpression(edge) : undefined}
                  onChange={(condition) => updateEdge(edge.id, { mode: "auto", label: null, condition: condition || null })}
                />
              )}

              <EdgeEffectsEditor
                effects={edge.effects}
                registry={registry}
                disabled={disabled}
                onChange={(effects) => updateEdge(edge.id, { effects })}
              />

              {outcome?.problem && (
                <p
                  className={`gs-branch__problem gs-branch__problem--${outcome.problem.severity}`}
                  data-severity={outcome.problem.severity}
                  role="alert"
                >
                  <TriangleAlert size={14} aria-hidden="true" />
                  <strong className="gs-branch__problem-label">
                    {outcome.problem.severity === "error" ? t("status.severity.error") : t("status.severity.warning")}
                  </strong>
                  {outcome.problem.message}
                </p>
              )}
              {outcome?.winner && <p className="gs-branch__winner">{t("script.branch.winner")}</p>}
            </li>
          );
        })}
      </ol>

      {mode === "auto" && !edges.some((edge) => !edge.condition?.trim()) && !disabled && (
        <p className="gs-branch__problem gs-branch__problem--warn" data-severity="warn" role="alert">
          <TriangleAlert size={14} aria-hidden="true" />
          <strong className="gs-branch__problem-label">{t("status.severity.warning")}</strong>
          {t("script.branch.noFallback")}
        </p>
      )}

      {mode === "auto" && (
        <StateTrial sources={sources} values={trialValues} onChange={onTrialChange} />
      )}
    </div>
  );
}

// ── 试算 ───────────────────────────────────────────────────────────────

export interface BranchOutcome {
  /** 按试算值，这条是实际胜出的分支。 */
  winner: boolean;
  /** 需要作者处理的问题；null 表示这条没问题。 */
  problem: BranchProblem | null;
}

export interface BranchProblem {
  message: string;
  severity: "error" | "warn";
}

/**
 * 逐条求值，模拟运行时「首个命中者胜出」。
 *
 * 两个独立结论：
 * - winner：按这组试算值实际会走哪条；换一组值就会变。
 * - problem：与试算值无关的结构问题。只有当前面某条【恒真】（空条件或不引用
 *   任何状态且求值为真）时，后面的分支才是真的永远走不到；仅仅是这次没轮到它
 *   不算问题，否则每换一组试算值就会冒出一片假警告。
 *
 * 与运行时同源：都走 evaluateGraphConditionResult，所以试算结论和实际播放一致。
 */
export function evaluateBranchOutcomes(
  edges: GraphEdge[],
  values: Record<string, string | number | boolean | null>,
  t: StudioTranslator = translateZhCN,
): BranchOutcome[] {
  let decided = false;
  let unreachableFrom: number | null = null;

  return edges.map((edge, index) => {
    const result = evaluateGraphConditionResult(edge.condition ?? null, values);

    if (!result.ok) {
      return {
        winner: false,
        problem: {
          message: t("script.branch.evaluationFailed", { detail: result.message }),
          severity: "error",
        },
      };
    }

    const problem = unreachableFrom != null
      ? {
        message: t("script.branch.unreachable", { number: unreachableFrom + 1 }),
        severity: "warn" as const,
      }
      : null;

    if (unreachableFrom == null && alwaysTrue(edge.condition)) unreachableFrom = index;

    const winner = !decided && result.value;
    if (winner) decided = true;
    return { winner, problem };
  });
}

/** 恒真：空条件，或不引用任何状态也能求值为真（如 `true`）。 */
function alwaysTrue(condition: string | null | undefined): boolean {
  const source = condition?.trim();
  if (!source) return true;
  const result = evaluateGraphConditionResult(source, {});
  return result.ok && result.value;
}

// ── 边排序模型（沿用既有语义，行为不变）─────────────────────────────────

export function moveEdge(edges: GraphEdge[], index: number, delta: -1 | 1): GraphEdge[] {
  const target = index + delta;
  if (target < 0 || target >= edges.length) return edges;
  const next = [...edges];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function moveEdgeById(edges: GraphEdge[], draggedId: string, targetId: string): GraphEdge[] {
  const from = edges.findIndex((edge) => edge.id === draggedId);
  const to = edges.findIndex((edge) => edge.id === targetId);
  if (from < 0 || to < 0 || from === to) return edges;
  const next = [...edges];
  const [dragged] = next.splice(from, 1);
  next.splice(to, 0, dragged);
  return next;
}

/** 兜底分支永远排在最后，否则它后面的条件永远没机会求值。 */
export function orderDefaultAutoEdgeLast(edges: GraphEdge[]): GraphEdge[] {
  return [...edges.filter((edge) => edge.condition?.trim()), ...edges.filter((edge) => !edge.condition?.trim())];
}

function orderAfterMove(edges: GraphEdge[], index: number, delta: -1 | 1, mode: BranchMode) {
  const next = moveEdge(edges, index, delta);
  return mode === "auto" ? orderDefaultAutoEdgeLast(next) : next;
}

export function normalizeBranchEdge(
  graph: ProjectGraph,
  from: string,
  edge: GraphEdge,
  index: number,
  mode: BranchMode,
): GraphEdge {
  return {
    ...normalizeEdge(edge),
    from,
    mode,
    label: mode === "choice"
      ? edge.label?.trim()
        || persistedTargetTitle(graph, edge.to)
        || `选项 ${index + 1}`
      : null,
    condition: mode === "auto" ? edge.condition ?? null : null,
  };
}

function persistedTargetTitle(
  graph: ProjectGraph,
  nodeId: string,
): string {
  return graph.nodes.find((node) => node.id === nodeId)?.title
    || nodeId;
}

export function normalizeEdge(edge: GraphEdge): GraphEdge {
  return {
    ...edge,
    mode: edge.mode ?? "linear",
    label: edge.label ?? null,
    condition: edge.condition ?? null,
  };
}

export function targetTitle(
  graph: ProjectGraph,
  nodeId: string,
  t: StudioTranslator = translateZhCN,
): string {
  return graph.nodes.find((node) => node.id === nodeId)?.title
    || nodeId
    || t("script.branch.unselected");
}
