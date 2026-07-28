/**
 * 句子化条件编辑器。
 *
 * 作者读到的是「雪·好感度 达到 喜欢」而不是 `affection_yuki >= 60`。
 * 每个子句一行，第二个操作数按状态用途换控件（开关 / 分段下拉 / 状态下拉 /
 * 步进器），所以路线名不用手打，也就不会打错。
 *
 * 结构上只支持扁平的「全部满足 / 任一满足」——覆盖绝大多数真实条件；
 * 复杂表达式落回文本模式，不做半吊子的可视化往返。
 */
import { useMemo } from "react";
import { Plus, X } from "lucide-react";
import type { VariableDeclaration } from "@vibegal/engine";
import { Button, IconButton } from "../common/Button";
import { NumberInput, SegmentedControl, Select, SentenceRow, SentenceWord, Switch, TextInput } from "../common/Form";
import { translateZhCN, useStudioI18n, type StudioTranslator } from "../../lib/i18n";
import {
  bandThreshold,
  defaultClause,
  formatConditionSentence,
  operatorLabel,
  operatorsForSource,
  parseConditionSentence,
  type ClauseOperator,
  type ConditionClause,
  type ConditionSentence,
  type StateSource,
} from "./storyState";

export interface ConditionEditorProps {
  /** 表达式原文。空串表示「没有条件」，即兜底分支。 */
  source: string;
  sources: StateSource[];
  onChange: (source: string) => void;
  disabled?: boolean;
  /** 无法句子化时，由调用方提供的表达式编辑入口。 */
  onEditExpression?: () => void;
}

export function ConditionEditor({ source, sources, onChange, disabled, onEditExpression }: ConditionEditorProps) {
  const { t } = useStudioI18n();
  const sentence = useMemo(() => parseConditionSentence(source), [source]);
  const byName = useMemo(() => new Map(sources.map((item) => [item.name, item])), [sources]);

  if (source.trim() && !sentence) {
    return (
      <div className="gs-condition gs-condition--raw">
        <code className="gs-condition__raw-source">{source}</code>
        <div className="gs-condition__raw-hint">
          {t("script.condition.rawHint")}
          {onEditExpression && <Button onClick={onEditExpression}>{t("script.condition.editExpression")}</Button>}
        </div>
      </div>
    );
  }

  const current: ConditionSentence = sentence ?? { join: "all", clauses: [] };
  const apply = (next: ConditionSentence) => onChange(formatConditionSentence(next));
  const writable = sources.filter((item) => item.kind !== "system" || item.name === "system.playthroughCount");

  return (
    <div className="gs-condition">
      {current.clauses.length > 1 && (
        <SegmentedControl<"all" | "any">
          aria-label={t("script.condition.joinLabel")}
          value={current.join}
          disabled={disabled}
          options={[
            {
              value: "all",
              label: t("script.condition.join.all"),
              title: t("script.condition.join.allHint"),
            },
            {
              value: "any",
              label: t("script.condition.join.any"),
              title: t("script.condition.join.anyHint"),
            },
          ]}
          onChange={(join) => apply({ ...current, join })}
        />
      )}

      {current.clauses.map((clause, index) => (
        <ClauseRow
          key={index}
          clause={clause}
          index={index}
          join={current.join}
          sources={sources}
          source={byName.get(clause.source)}
          disabled={disabled}
          t={t}
          onChange={(next) => apply({ ...current, clauses: current.clauses.map((item, at) => at === index ? next : item) })}
          onRemove={() => apply({ ...current, clauses: current.clauses.filter((_, at) => at !== index) })}
        />
      ))}

      {!disabled && (
        <Button
          onClick={() => apply({ ...current, clauses: [...current.clauses, defaultClause(writable[0])] })}
          disabled={writable.length === 0}
        >
          <Plus size={14} aria-hidden="true" />
          {t("script.condition.add")}
        </Button>
      )}

      {current.clauses.length === 0 && (
        <p className="gs-condition__empty">{t("script.condition.fallbackDescription")}</p>
      )}
    </div>
  );
}

function ClauseRow({
  clause,
  index,
  join,
  sources,
  source,
  disabled,
  t,
  onChange,
  onRemove,
}: {
  clause: ConditionClause;
  index: number;
  join: "all" | "any";
  sources: StateSource[];
  source?: StateSource;
  disabled?: boolean;
  t: StudioTranslator;
  onChange: (clause: ConditionClause) => void;
  onRemove: () => void;
}) {
  const operators = operatorsForSource(source);
  const lead = index === 0
    ? t("script.condition.lead.if")
    : join === "all"
      ? t("script.condition.lead.and")
      : t("script.condition.lead.or");

  return (
    <SentenceRow
      lead={lead}
      trailing={!disabled && (
        <IconButton aria-label={t("script.condition.remove", { number: index + 1 })} onClick={onRemove}>
          <X size={14} aria-hidden="true" />
        </IconButton>
      )}
    >
      <Select
        aria-label={t("script.condition.sourceLabel", { number: index + 1 })}
        disabled={disabled}
        value={clause.source}
        options={sources.map((item) => ({ value: item.name, label: item.label, group: item.group }))}
        onChange={(name) => {
          const next = sources.find((item) => item.name === name);
          onChange(defaultClause(next));
        }}
      />
      {operators.length > 1 ? (
        <Select
          aria-label={t("script.condition.operatorLabel", { number: index + 1 })}
          disabled={disabled}
          value={clause.operator}
          options={operators.map((operator) => ({ value: operator, label: operatorLabel(operator, t) }))}
          onChange={(operator) => onChange({ ...clause, operator: operator as ClauseOperator })}
        />
      ) : (
        <SentenceWord>{operatorLabel(clause.operator, t)}</SentenceWord>
      )}
      <ClauseValue clause={clause} index={index} source={source} disabled={disabled} t={t} onChange={onChange} />
    </SentenceRow>
  );
}

/** 第二个操作数：按用途换控件，作者永远不必手打字面量。 */
function ClauseValue({
  clause,
  index,
  source,
  disabled,
  t,
  onChange,
}: {
  clause: ConditionClause;
  index: number;
  source?: StateSource;
  disabled?: boolean;
  t: StudioTranslator;
  onChange: (clause: ConditionClause) => void;
}) {
  const label = t("script.condition.valueLabel", { number: index + 1 });
  // 已发生 / 还没发生 本身就说完了，没有第二个操作数。
  if (clause.operator === "happened" || clause.operator === "notHappened") return null;

  const declaration = source?.declaration;

  if (clause.operator === "is" || clause.operator === "isNot") {
    const options = declaration?.options;
    if (options && options.length > 0) {
      return (
        <Select
          aria-label={label}
          disabled={disabled}
          value={String(clause.value ?? "")}
          options={options.map((option) => ({ value: option.id, label: option.label }))}
          onChange={(value) => onChange({ ...clause, value })}
        />
      );
    }
    if (declaration?.type === "boolean") {
      return (
        <Switch
          aria-label={label}
          disabled={disabled}
          checked={clause.value === true}
          label={clause.value === true
            ? t("script.condition.boolean.yes")
            : t("script.condition.boolean.no")}
          onChange={(checked) => onChange({ ...clause, value: checked })}
        />
      );
    }
    return (
      <TextInput
        aria-label={label}
        disabled={disabled}
        value={String(clause.value ?? "")}
        onChange={(value) => onChange({ ...clause, value })}
      />
    );
  }

  // 数值门槛：有分段就选分段名，条件里仍然存数字，这样改分段名不会改变已有条件。
  const bands = declaration?.bands;
  if (bands && bands.length > 0) {
    const numeric = Number(clause.value ?? 0);
    const matching = bands.find((band) => bandThreshold(declaration, band.id) === numeric);
    return (
      <div className="gs-condition__band">
        <Select
          aria-label={label}
          disabled={disabled}
          value={matching?.id ?? ""}
          placeholder={matching ? undefined : t("script.condition.customValue", { value: numeric })}
          options={bands.map((band) => ({ value: band.id, label: band.label }))}
          onChange={(bandId) => onChange({ ...clause, value: bandThreshold(declaration, bandId) })}
        />
        <details className="gs-condition__exact">
          <summary>{t("script.condition.exactValue")}</summary>
          <NumberInput
            aria-label={t("script.condition.exactValueLabel", { label })}
            disabled={disabled}
            value={numeric}
            min={declaration?.min}
            max={declaration?.max}
            onChange={(value) => onChange({ ...clause, value })}
          />
        </details>
      </div>
    );
  }

  return (
    <NumberInput
      aria-label={label}
      disabled={disabled}
      value={Number(clause.value ?? 0)}
      min={declaration?.min}
      max={declaration?.max}
      onChange={(value) => onChange({ ...clause, value })}
    />
  );
}

/** 供分流规则表复用：把条件渲染成一行只读文字。 */
export function describeCondition(
  source: string,
  sources: StateSource[],
  t: StudioTranslator = translateZhCN,
): string {
  const sentence = parseConditionSentence(source);
  if (!sentence) return source.trim() || t("script.condition.fallback");
  if (sentence.clauses.length === 0) return t("script.condition.fallback");
  const byName = new Map(sources.map((item) => [item.name, item]));
  const joiner = sentence.join === "all"
    ? t("script.condition.joinSummary.all")
    : t("script.condition.joinSummary.any");
  return sentence.clauses
    .map((clause) => describeClause(clause, byName.get(clause.source), t))
    .join(joiner);
}

function describeClause(
  clause: ConditionClause,
  source: StateSource | undefined,
  t: StudioTranslator,
): string {
  const name = source?.label ?? clause.source;
  const operator = operatorLabel(clause.operator, t);
  if (clause.operator === "happened" || clause.operator === "notHappened") return `${name} ${operator}`;
  const declaration: VariableDeclaration | undefined = source?.declaration;
  if (clause.operator === "atLeast" || clause.operator === "atMost") {
    const band = declaration?.bands?.find((item) => bandThreshold(declaration, item.id) === Number(clause.value));
    return `${name} ${operator} ${band?.label ?? clause.value}`;
  }
  const option = declaration?.options?.find((item) => item.id === clause.value);
  return `${name} ${operator} ${option?.label ?? clause.value}`;
}
