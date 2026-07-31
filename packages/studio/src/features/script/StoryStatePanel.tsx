/**
 * 故事状态面板 —— 取代原来的 Variable Workbench + Variable Table。
 *
 * 那两块列的是同一批变量：一块能编辑声明，一块显示用量，作者要在两处之间对照。
 * 这里合成一张卡片：一个状态一张卡，声明与用量在同一处，按用途分组。
 *
 * 面板只呈现作者要回答的问题（这是记什么？初始是多少？哪里改它？），实现细节
 * （内部标识、type/nullable、存储作用域）收进「技术详情」。
 */
import { useState } from "react";
import {
  variableTypeForKind,
  type Manifest,
  type VariableDeclaration,
  type VariableKind,
  type VariableRegistry,
} from "@vibegal/engine";
import { Button, IconButton } from "../common/Button";
import { Field, NumberInput, SegmentedControl, Select, Slider, Switch, TextInput } from "../common/Form";
import { type VariableEntry } from "./variableAnalysis";
import { bandLabelForValue, variableLabel } from "./storyState";
import {
  translateZhCN,
  type StudioTranslator,
} from "../../lib/i18n";

const KIND_ORDER: VariableKind[] = ["flag", "meter", "state", "counter", "text"];

const KIND_MESSAGE_KEY = {
  flag: "script.state.kind.flag",
  meter: "script.state.kind.meter",
  state: "script.state.kind.state",
  counter: "script.state.kind.counter",
  text: "script.state.kind.text",
} as const;

const KIND_HINT_MESSAGE_KEY = {
  flag: "script.state.kindHint.flag",
  meter: "script.state.kindHint.meter",
  state: "script.state.kindHint.state",
  counter: "script.state.kindHint.counter",
  text: "script.state.kindHint.text",
} as const;

function kindLabel(kind: VariableKind, t: StudioTranslator): string {
  return t(KIND_MESSAGE_KEY[kind]);
}

function kindHint(kind: VariableKind, t: StudioTranslator): string {
  return t(KIND_HINT_MESSAGE_KEY[kind]);
}

function scopeLabel(
  scope: "run" | "global",
  t: StudioTranslator,
): string {
  return t(
    scope === "global"
      ? "script.state.scope.global"
      : "script.state.scope.run",
  );
}

// ── 单个状态卡片 ───────────────────────────────────────────────────────

export function StateCard({
  name,
  declaration,
  kind,
  usage,
  manifest,
  editable,
  onChange,
  onRename,
  onRemove,
  onSelectNode,
  onSelectEdge,
  t = translateZhCN,
}: {
  name: string;
  declaration: VariableDeclaration;
  kind: VariableKind;
  usage?: VariableEntry;
  manifest?: Manifest;
  editable: boolean;
  onChange: (declaration: VariableDeclaration) => void;
  onRename?: (from: string, to: string) => void;
  onRemove: () => void;
  onSelectNode?: (nodeId: string) => void;
  onSelectEdge?: (edgeId: string) => void;
  t?: StudioTranslator;
}) {
  const writes = usage?.writes.length ?? 0;
  const reads = usage?.reads.length ?? 0;
  const title = variableLabel(name, declaration, manifest);

  return (
    <article className="gs-state-card">
      <header className="gs-state-card__head">
        <div>
          <div className="gs-state-card__title">{title}</div>
          <div className="gs-state-card__meta">
            {kindLabel(kind, t)} · {scopeLabel(declaration.scope ?? "run", t)}
          </div>
        </div>
        {editable && onRename && (
          <RenameButton name={name} label={title} onRename={onRename} t={t} />
        )}
      </header>

      <Field label={t("script.state.displayName")} hint={t("script.state.displayNameHint")}>
        {({ id }) => (
          <TextInput
            id={id}
            disabled={!editable}
            value={declaration.label ?? ""}
            onChange={(value) => onChange({ ...declaration, label: value.trim() === "" ? undefined : value })}
          />
        )}
      </Field>

      <InitialValueField declaration={declaration} kind={kind} editable={editable} onChange={onChange} t={t} />

      {(kind === "meter" || kind === "counter") && (
        <RangeFields declaration={declaration} editable={editable} onChange={onChange} t={t} />
      )}
      {kind === "state" && (
        <OptionsField declaration={declaration} editable={editable} onChange={onChange} t={t} />
      )}

      {/* 详细用量由 StoryStateView 的「在故事里」承担；卡片只给一句概览。 */}
      <div className="gs-state-card__usage">
        <span>{describeUsage(writes, reads, declaration.displayOnly, t)}</span>
        <div className="gs-state-card__usage-actions">
          {usage?.writes[0]?.nodeId && onSelectNode && (
            <Button onClick={() => onSelectNode(usage.writes[0]!.nodeId!)}>{t("script.state.usage.firstWrite")}</Button>
          )}
          {usage?.reads[0]?.edgeId && onSelectEdge && (
            <Button onClick={() => onSelectEdge(usage.reads[0]!.edgeId!)}>{t("script.state.usage.firstRead")}</Button>
          )}
        </div>
      </div>

      <details className="gs-state-card__details">
        <summary>{t("script.state.technical")}</summary>
        <div className="gs-state-card__details-body">
          <div>{t("script.state.internalId")}<code>{name}</code></div>
          <div>{t("script.state.dataType")}{declaration.type}</div>
          <Field label={t("script.state.storage")} hint={t("script.state.storageHint")}>
            {({ id }) => (
              <Select
                id={id}
                disabled={!editable}
                value={declaration.scope ?? "run"}
                options={[
                  { value: "run", label: scopeLabel("run", t) },
                  { value: "global", label: scopeLabel("global", t) },
                ]}
                onChange={(value) => onChange({ ...declaration, scope: value as "run" | "global" })}
              />
            )}
          </Field>
          <Switch
            aria-label={t("script.state.displayOnlyAria", { title })}
            disabled={!editable}
            checked={declaration.displayOnly ?? false}
            label={t("script.state.displayOnly")}
            onChange={(checked) => onChange({ ...declaration, displayOnly: checked || undefined })}
          />
          {editable && (
            <Button
              variant="danger"
              title={writes + reads > 0
                ? t("script.state.referencesRemain", { count: writes + reads })
                : t("script.state.noReferences")}
              onClick={onRemove}
            >
              {writes + reads > 0
                ? t("script.state.deleteWithReferences", { count: writes + reads })
                : t("script.state.delete")}
            </Button>
          )}
        </div>
      </details>
    </article>
  );
}

function RenameButton({
  name,
  label,
  onRename,
  t = translateZhCN,
}: {
  name: string;
  label: string;
  onRename: (from: string, to: string) => void;
  t?: StudioTranslator;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft == null) {
    return <Button onClick={() => setDraft(name)} title={t("script.state.renameHint")}>{t("script.state.renameId")}</Button>;
  }
  const invalid = !/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(draft)
    || /^(?:system|chose|seen)\./.test(draft);
  return (
    <div className="gs-state-card__rename">
      <Field
        label={t("script.state.internalIdFor", { label })}
        error={invalid ? t("script.state.invalidId") : undefined}
      >
        {({ id, invalid: isInvalid }) => (
          <TextInput id={id} invalid={isInvalid} value={draft} onChange={setDraft} />
        )}
      </Field>
      <Button
        variant="primary"
        disabled={invalid || draft === name}
        onClick={() => { onRename(name, draft); setDraft(null); }}
      >
        {t("script.state.renameAll")}
      </Button>
      <Button onClick={() => setDraft(null)}>{t("script.state.cancel")}</Button>
    </div>
  );
}

function InitialValueField({
  declaration,
  kind,
  editable,
  onChange,
  t = translateZhCN,
}: {
  declaration: VariableDeclaration;
  kind: VariableKind;
  editable: boolean;
  onChange: (declaration: VariableDeclaration) => void;
  t?: StudioTranslator;
}) {
  if (kind === "flag") {
    return (
      <Field label={t("script.state.initial.flag")}>
        {() => (
          <Switch
            aria-label={t("script.state.initial.flag")}
            disabled={!editable}
            checked={declaration.default === true}
            label={declaration.default === true
              ? t("script.state.initial.happened")
              : t("script.state.initial.notHappened")}
            onChange={(checked) => onChange({ ...declaration, default: checked })}
          />
        )}
      </Field>
    );
  }
  if (kind === "state") {
    const options = declaration.options ?? [];
    return (
      <Field label={t("script.state.initial.state")}>
        {({ id }) => (
          <Select
            id={id}
            disabled={!editable || options.length === 0}
            value={typeof declaration.default === "string" ? declaration.default : ""}
            options={options.map((option) => ({ value: option.id, label: option.label }))}
            placeholder={options.length === 0 ? t("script.state.initial.addOptionsFirst") : undefined}
            onChange={(value) => onChange({ ...declaration, default: value })}
          />
        )}
      </Field>
    );
  }
  if (kind === "meter" || kind === "counter") {
    const value = typeof declaration.default === "number" ? declaration.default : 0;
    const bounded = declaration.min != null && declaration.max != null;
    return (
      <Field
        label={t("script.state.initial.number")}
        hint={bounded ? undefined : t("script.state.initial.unbounded")}
      >
        {({ id }) => bounded ? (
          <Slider
            id={id}
            aria-label={t("script.state.initial.number")}
            disabled={!editable}
            value={value}
            min={declaration.min!}
            max={declaration.max!}
            valueLabel={bandLabelForValue(declaration, value) ?? String(value)}
            marks={(declaration.bands ?? []).flatMap((band, index, all) => {
              const start = index === 0 ? declaration.min! : (all[index - 1].upTo ?? declaration.min!) + 1;
              return [{ value: start, label: band.label }];
            })}
            onChange={(next) => onChange({ ...declaration, default: next })}
          />
        ) : (
          <NumberInput
            id={id}
            aria-label={t("script.state.initial.number")}
            disabled={!editable}
            value={value}
            onChange={(next) => onChange({ ...declaration, default: next })}
          />
        )}
      </Field>
    );
  }
  return (
    <Field label={t("script.state.initial.text")}>
      {({ id }) => (
        <TextInput
          id={id}
          disabled={!editable}
          value={typeof declaration.default === "string" ? declaration.default : ""}
          onChange={(value) => onChange({ ...declaration, default: value })}
        />
      )}
    </Field>
  );
}

function RangeFields({
  declaration,
  editable,
  onChange,
  t = translateZhCN,
}: {
  declaration: VariableDeclaration;
  editable: boolean;
  onChange: (declaration: VariableDeclaration) => void;
  t?: StudioTranslator;
}) {
  const bounded = declaration.min != null || declaration.max != null;
  return (
    <Field
      label={t("script.state.range")}
      hint={bounded
        ? t("script.state.range.boundedHint")
        : t("script.state.range.unboundedHint")}
      error={declaration.min != null && declaration.max != null && declaration.min > declaration.max
        ? t("script.state.range.invalid")
        : undefined}
    >
      {() => (
        <div className="gs-range-fields">
          <Switch
            aria-label={t("script.state.range.limitAria")}
            disabled={!editable}
            checked={bounded}
            label={t("script.state.range.limit")}
            onChange={(checked) => onChange(checked
              ? { ...declaration, min: 0, max: 100 }
              : { ...declaration, min: undefined, max: undefined, bands: undefined })}
          />
          {bounded && (
            <>
              <NumberInput
                aria-label={t("script.state.range.minimum")}
                disabled={!editable}
                value={declaration.min ?? 0}
                onChange={(value) => onChange({ ...declaration, min: value })}
              />
              <span className="gs-sentence__word">{t("script.state.range.to")}</span>
              <NumberInput
                aria-label={t("script.state.range.maximum")}
                disabled={!editable}
                value={declaration.max ?? 100}
                onChange={(value) => onChange({ ...declaration, max: value })}
              />
            </>
          )}
        </div>
      )}
    </Field>
  );
}

function OptionsField({
  declaration,
  editable,
  onChange,
  t = translateZhCN,
}: {
  declaration: VariableDeclaration;
  editable: boolean;
  onChange: (declaration: VariableDeclaration) => void;
  t?: StudioTranslator;
}) {
  const options = declaration.options ?? [];
  const setOptions = (next: NonNullable<VariableDeclaration["options"]>) => onChange({
    ...declaration,
    options: next,
    // 默认值必须始终是可选值之一，否则契约校验会失败。
    default: next.some((option) => option.id === declaration.default) ? declaration.default : next[0]?.id ?? "",
  });
  return (
    <Field label={t("script.state.options")} hint={t("script.state.optionsHint")}>
      {() => (
        <div className="gs-options-field">
          {options.map((option, index) => (
            <div key={option.id} className="gs-options-field__row">
              <TextInput
                aria-label={t("script.state.optionName", { number: index + 1 })}
                disabled={!editable}
                value={option.label}
                onChange={(label) => setOptions(options.map((item, at) => at === index ? { ...item, label } : item))}
              />
              {editable && (
                <IconButton
                  aria-label={t("script.state.optionDelete", { label: option.label })}
                  onClick={() => setOptions(options.filter((_, at) => at !== index))}
                >
                  ×
                </IconButton>
              )}
            </div>
          ))}
          {editable && (
            <Button onClick={() => setOptions([
              ...options,
              {
                id: nextOptionId(options),
                label: `状态 ${options.length + 1}`,
              },
            ])}>
              {t("script.state.optionAdd")}
            </Button>
          )}
        </div>
      )}
    </Field>
  );
}

// ── 新建 ───────────────────────────────────────────────────────────────

/**
 * 新建时先问用途，再由名称生成内部标识。
 *
 * 原实现直接生成 `variable_1` 且在 Studio 里无法重命名，于是真实项目里的条件
 * 长成 `variable_1 >= 50`。这里把「这是记什么」作为第一个问题。
 */
export function NewStateForm({
  existingNames,
  onCreate,
  onCancel,
  t = translateZhCN,
}: {
  existingNames: Set<string>;
  onCreate: (name: string, declaration: VariableDeclaration) => void;
  onCancel: () => void;
  t?: StudioTranslator;
}) {
  const [kind, setKind] = useState<VariableKind>("flag");
  const [label, setLabel] = useState("");
  const name = uniqueName(slugify(label), existingNames);

  return (
    <form
      className="gs-state-new"
      onSubmit={(event) => {
        event.preventDefault();
        if (!label.trim()) return;
        onCreate(name, declarationForKind(kind, label.trim()));
      }}
    >
      <Field label={t("script.state.newPurpose")} hint={kindHint(kind, t)}>
        {() => (
          <SegmentedControl<VariableKind>
            aria-label={t("script.state.newPurposeAria")}
            value={kind}
            options={KIND_ORDER.map((item) => ({ value: item, label: kindLabel(item, t) }))}
            onChange={setKind}
          />
        )}
      </Field>
      <Field
        label={t("script.state.newName")}
        hint={label.trim()
          ? t("script.state.newInternalId", { name })
          : t("script.state.newNameExamples")}
      >
        {({ id }) => (
          <TextInput
            id={id}
            value={label}
            onChange={setLabel}
            placeholder={t("script.state.newNamePlaceholder")}
          />
        )}
      </Field>
      <div className="gs-state-new__actions">
        <Button variant="primary" type="submit" disabled={!label.trim()}>{t("script.state.create")}</Button>
        <Button onClick={onCancel}>{t("script.state.cancel")}</Button>
      </div>
    </form>
  );
}

export function declarationForKind(
  kind: VariableKind,
  label: string,
): VariableDeclaration {
  const type = variableTypeForKind(kind);
  const base = { kind, label, type, nullable: false, scope: "run" as const };
  if (kind === "flag") return { ...base, type: "boolean", default: false };
  if (kind === "meter") {
    return {
      ...base,
      type: "number",
      default: 0,
      min: 0,
      max: 100,
      bands: [
        { id: "low", label: "低", upTo: 29 },
        { id: "mid", label: "中", upTo: 59 },
        { id: "high", label: "高" },
      ],
    };
  }
  if (kind === "counter") return { ...base, type: "number", default: 0, min: 0 };
  if (kind === "state") {
    return {
      ...base,
      type: "string",
      default: "state_1",
      options: [{ id: "state_1", label: "状态 1" }],
    };
  }
  return { ...base, type: "string", default: "" };
}

/**
 * 由显示名生成内部标识。中文没有可用的音译，退回带序号的 `state_N`；
 * 关键是作者永远不必自己面对这个字符串（要改也有安全重命名）。
 */
export function slugify(label: string): string {
  const ascii = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[a-z_]/.test(ascii) ? ascii : "";
}

export function uniqueName(base: string, existing: Set<string>): string {
  const seed = base || "state";
  if (!existing.has(seed)) return seed;
  let index = 2;
  while (existing.has(`${seed}_${index}`)) index += 1;
  return `${seed}_${index}`;
}

/** 静态分析推断出的旧变量转成正式声明。保留原有行为，只补上 kind。 */
export function registerInferredVariable(registry: VariableRegistry, name: string, inferred: string[]): VariableRegistry {
  if (registry.variables[name]) return registry;
  const type = inferred.length === 1 && ["string", "number", "boolean"].includes(inferred[0])
    ? inferred[0] as VariableDeclaration["type"]
    : "string";
  const kind: VariableKind = type === "boolean" ? "flag" : type === "number" ? "meter" : "text";
  return {
    ...registry,
    variables: {
      ...registry.variables,
      [name]: { kind, type, default: type === "number" ? 0 : type === "boolean" ? false : "", nullable: false, scope: "run" },
    },
  };
}

function describeUsage(
  writes: number,
  reads: number,
  displayOnly?: boolean,
  t: StudioTranslator = translateZhCN,
): string {
  if (writes === 0 && reads === 0) {
    return t("script.state.usage.unused");
  }
  const parts: string[] = [];
  parts.push(writes === 0
    ? t("script.state.usage.noWrites")
    : t("script.state.usage.writes", { count: writes }));
  if (reads > 0) {
    parts.push(t("script.state.usage.reads", { count: reads }));
  } else if (!displayOnly) {
    parts.push(t("script.state.usage.noReads"));
  }
  return parts.join(" · ");
}

function nextOptionId(options: NonNullable<VariableDeclaration["options"]>): string {
  let index = options.length + 1;
  const taken = new Set(options.map((option) => option.id));
  while (taken.has(`state_${index}`)) index += 1;
  return `state_${index}`;
}
