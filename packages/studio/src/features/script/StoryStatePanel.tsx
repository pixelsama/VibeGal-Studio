/**
 * 故事状态面板 —— 取代原来的 Variable Workbench + Variable Table。
 *
 * 那两块列的是同一批变量：一块能编辑声明，一块显示用量，作者要在两处之间对照。
 * 这里合成一张卡片：一个状态一张卡，声明与用量在同一处，按用途分组。
 *
 * 面板只呈现作者要回答的问题（这是记什么？初始是多少？哪里改它？），实现细节
 * （内部标识、type/nullable、存储作用域）收进「技术详情」。
 */
import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import {
  variableKind,
  variableTypeForKind,
  type Manifest,
  type VariableDeclaration,
  type VariableKind,
  type VariableRegistry,
} from "@vibegal/engine";
import type { NodeEntry, ProjectGraph } from "../../lib/types";
import { Button, IconButton } from "../common/Button";
import { Field, NumberInput, SegmentedControl, Select, Slider, Switch, TextInput } from "../common/Form";
import { analyzeGraphVariables, type VariableEntry } from "./variableAnalysis";
import { KIND_HINT, KIND_LABEL, SCOPE_LABEL, bandLabelForValue, variableLabel } from "./storyState";

const KIND_ORDER: VariableKind[] = ["flag", "meter", "state", "counter", "text"];

export interface StoryStatePanelProps {
  registry: VariableRegistry;
  graph: ProjectGraph;
  nodes?: NodeEntry[];
  manifest?: Manifest;
  onChange?: (registry: VariableRegistry) => void;
  /** 安全重命名走后端原子命令，面板只负责发起。 */
  onRename?: (from: string, to: string) => void;
  onSelectNode?: (nodeId: string) => void;
  onSelectEdge?: (edgeId: string) => void;
}

export function StoryStatePanel({
  registry,
  graph,
  nodes,
  manifest,
  onChange,
  onRename,
  onSelectNode,
  onSelectEdge,
}: StoryStatePanelProps) {
  const analysis = useMemo(() => analyzeGraphVariables(graph, nodes, registry), [graph, nodes, registry]);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  const usageByName = useMemo(
    () => new Map(analysis.variables.map((entry) => [entry.name, entry])),
    [analysis.variables],
  );

  const declared = Object.entries(registry.variables)
    .map(([name, declaration]) => ({ name, declaration, kind: variableKind(declaration) }))
    .filter(({ name, declaration }) => matches(query, [name, declaration.label, declaration.description]))
    .sort((left, right) => KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind)
      || left.name.localeCompare(right.name));

  const undeclared = analysis.variables.filter((entry) => !registry.variables[entry.name]);

  const update = (name: string, declaration: VariableDeclaration) => onChange?.({
    ...registry,
    variables: { ...registry.variables, [name]: declaration },
  });

  const remove = (name: string) => {
    const variables = { ...registry.variables };
    delete variables[name];
    onChange?.({ ...registry, variables });
  };

  return (
    <section className="gs-story-state">
      <div className="gs-story-state__toolbar">
        <div className="gs-story-state__search">
          <Search size={14} aria-hidden="true" />
          <input
            className="gs-input"
            aria-label="搜索故事状态"
            placeholder="搜索"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {onChange && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={14} aria-hidden="true" />
            新建
          </Button>
        )}
      </div>

      {creating && onChange && (
        <NewStateForm
          existingNames={new Set(Object.keys(registry.variables))}
          onCancel={() => setCreating(false)}
          onCreate={(name, declaration) => {
            onChange({ ...registry, variables: { ...registry.variables, [name]: declaration } });
            setCreating(false);
          }}
        />
      )}

      {declared.length === 0 && undeclared.length === 0 && (
        <p className="gs-story-state__empty">
          还没有故事状态。玩家的选择本身已经可以直接用在分流条件里；
          只有需要累积的东西（好感度、次数）才要在这里登记。
        </p>
      )}

      {declared.map(({ name, declaration, kind }) => (
        <StateCard
          key={name}
          name={name}
          declaration={declaration}
          kind={kind}
          usage={usageByName.get(name)}
          manifest={manifest}
          editable={Boolean(onChange)}
          onChange={(next) => update(name, next)}
          onRename={onRename}
          onRemove={() => remove(name)}
          onSelectNode={onSelectNode}
          onSelectEdge={onSelectEdge}
        />
      ))}

      {undeclared.length > 0 && (
        <div className="gs-story-state__undeclared">
          <h4>剧本里用到、但还没登记的状态</h4>
          {undeclared.map((entry) => (
            <div key={entry.name} className="gs-story-state__undeclared-row">
              <span>{entry.name}</span>
              {onChange && (
                <Button onClick={() => onChange(registerInferredVariable(registry, entry.name, entry.types))}>
                  登记
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
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
            {KIND_LABEL[kind]} · {SCOPE_LABEL[declaration.scope ?? "run"]}
          </div>
        </div>
        {editable && onRename && (
          <RenameButton name={name} label={title} onRename={onRename} />
        )}
      </header>

      <Field label="显示名称" hint="故事状态在条件和分流里显示的名字">
        {({ id }) => (
          <TextInput
            id={id}
            disabled={!editable}
            value={declaration.label ?? ""}
            onChange={(value) => onChange({ ...declaration, label: value.trim() === "" ? undefined : value })}
          />
        )}
      </Field>

      <InitialValueField declaration={declaration} kind={kind} editable={editable} onChange={onChange} />

      {(kind === "meter" || kind === "counter") && (
        <RangeFields declaration={declaration} editable={editable} onChange={onChange} />
      )}
      {kind === "state" && (
        <OptionsField declaration={declaration} editable={editable} onChange={onChange} />
      )}

      {/* 详细用量由 StoryStateView 的「在故事里」承担；卡片只给一句概览。 */}
      <div className="gs-state-card__usage">
        <span>{describeUsage(writes, reads, declaration.displayOnly)}</span>
        <div className="gs-state-card__usage-actions">
          {usage?.writes[0]?.nodeId && onSelectNode && (
            <Button onClick={() => onSelectNode(usage.writes[0]!.nodeId!)}>看第一处改动</Button>
          )}
          {usage?.reads[0]?.edgeId && onSelectEdge && (
            <Button onClick={() => onSelectEdge(usage.reads[0]!.edgeId!)}>看第一处判断</Button>
          )}
        </div>
      </div>

      <details className="gs-state-card__details">
        <summary>技术详情</summary>
        <div className="gs-state-card__details-body">
          <div>内部标识：<code>{name}</code></div>
          <div>数据类型：{declaration.type}</div>
          <Field label="存储方式" hint="跨周目保存的状态不会被读档回滚">
            {({ id }) => (
              <Select
                id={id}
                disabled={!editable}
                value={declaration.scope ?? "run"}
                options={[
                  { value: "run", label: SCOPE_LABEL.run },
                  { value: "global", label: SCOPE_LABEL.global },
                ]}
                onChange={(value) => onChange({ ...declaration, scope: value as "run" | "global" })}
              />
            )}
          </Field>
          <Switch
            aria-label={`${title} 仅用于界面显示`}
            disabled={!editable}
            checked={declaration.displayOnly ?? false}
            label="仅用于界面显示（不参与分流判断）"
            onChange={(checked) => onChange({ ...declaration, displayOnly: checked || undefined })}
          />
          {editable && (
            <Button
              variant="danger"
              title={writes + reads > 0 ? `仍有 ${writes + reads} 处引用，删除后会留下未登记状态` : "没有任何引用"}
              onClick={onRemove}
            >
              删除{writes + reads > 0 ? `（还有 ${writes + reads} 处引用）` : ""}
            </Button>
          )}
        </div>
      </details>
    </article>
  );
}

function RenameButton({ name, label, onRename }: { name: string; label: string; onRename: (from: string, to: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft == null) {
    return <Button onClick={() => setDraft(name)} title="同时改写所有引用">改标识</Button>;
  }
  const invalid = !/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(draft)
    || /^(?:system|chose|seen)\./.test(draft);
  return (
    <div className="gs-state-card__rename">
      <Field label={`${label} 的内部标识`} error={invalid ? "只能用字母、数字和下划线，且不能以 system./chose./seen. 开头" : undefined}>
        {({ id, invalid: isInvalid }) => (
          <TextInput id={id} invalid={isInvalid} value={draft} onChange={setDraft} />
        )}
      </Field>
      <Button
        variant="primary"
        disabled={invalid || draft === name}
        onClick={() => { onRename(name, draft); setDraft(null); }}
      >
        改名并更新所有引用
      </Button>
      <Button onClick={() => setDraft(null)}>取消</Button>
    </div>
  );
}

function InitialValueField({
  declaration,
  kind,
  editable,
  onChange,
}: {
  declaration: VariableDeclaration;
  kind: VariableKind;
  editable: boolean;
  onChange: (declaration: VariableDeclaration) => void;
}) {
  if (kind === "flag") {
    return (
      <Field label="开局时">
        {() => (
          <Switch
            aria-label="开局时"
            disabled={!editable}
            checked={declaration.default === true}
            label={declaration.default === true ? "已经发生" : "还没发生"}
            onChange={(checked) => onChange({ ...declaration, default: checked })}
          />
        )}
      </Field>
    );
  }
  if (kind === "state") {
    const options = declaration.options ?? [];
    return (
      <Field label="开局状态">
        {({ id }) => (
          <Select
            id={id}
            disabled={!editable || options.length === 0}
            value={typeof declaration.default === "string" ? declaration.default : ""}
            options={options.map((option) => ({ value: option.id, label: option.label }))}
            placeholder={options.length === 0 ? "先在下方添加可选状态" : undefined}
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
      <Field label="初始值" hint={bounded ? undefined : "没有设定范围，可以是任意数值"}>
        {({ id }) => bounded ? (
          <Slider
            id={id}
            aria-label="初始值"
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
          <NumberInput id={id} aria-label="初始值" disabled={!editable} value={value} onChange={(next) => onChange({ ...declaration, default: next })} />
        )}
      </Field>
    );
  }
  return (
    <Field label="初始文本">
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
}: {
  declaration: VariableDeclaration;
  editable: boolean;
  onChange: (declaration: VariableDeclaration) => void;
}) {
  const bounded = declaration.min != null || declaration.max != null;
  return (
    <Field
      label="取值范围"
      hint={bounded ? "写入时会自动限制在范围内" : "不限制。设定范围后，超出的写入会被自动收进范围"}
      error={declaration.min != null && declaration.max != null && declaration.min > declaration.max ? "上限不能小于下限" : undefined}
    >
      {() => (
        <div className="gs-range-fields">
          <Switch
            aria-label="限制取值范围"
            disabled={!editable}
            checked={bounded}
            label="限制范围"
            onChange={(checked) => onChange(checked
              ? { ...declaration, min: 0, max: 100 }
              : { ...declaration, min: undefined, max: undefined, bands: undefined })}
          />
          {bounded && (
            <>
              <NumberInput
                aria-label="下限"
                disabled={!editable}
                value={declaration.min ?? 0}
                onChange={(value) => onChange({ ...declaration, min: value })}
              />
              <span className="gs-sentence__word">到</span>
              <NumberInput
                aria-label="上限"
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
}: {
  declaration: VariableDeclaration;
  editable: boolean;
  onChange: (declaration: VariableDeclaration) => void;
}) {
  const options = declaration.options ?? [];
  const setOptions = (next: NonNullable<VariableDeclaration["options"]>) => onChange({
    ...declaration,
    options: next,
    // 默认值必须始终是可选值之一，否则契约校验会失败。
    default: next.some((option) => option.id === declaration.default) ? declaration.default : next[0]?.id ?? "",
  });
  return (
    <Field label="可选状态" hint="条件里从这些状态里选，不用手打，也就不会打错">
      {() => (
        <div className="gs-options-field">
          {options.map((option, index) => (
            <div key={option.id} className="gs-options-field__row">
              <TextInput
                aria-label={`第 ${index + 1} 个状态的名称`}
                disabled={!editable}
                value={option.label}
                onChange={(label) => setOptions(options.map((item, at) => at === index ? { ...item, label } : item))}
              />
              {editable && (
                <IconButton
                  aria-label={`删除状态 ${option.label}`}
                  onClick={() => setOptions(options.filter((_, at) => at !== index))}
                >
                  ×
                </IconButton>
              )}
            </div>
          ))}
          {editable && (
            <Button onClick={() => setOptions([...options, { id: nextOptionId(options), label: `状态 ${options.length + 1}` }])}>
              添加状态
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
}: {
  existingNames: Set<string>;
  onCreate: (name: string, declaration: VariableDeclaration) => void;
  onCancel: () => void;
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
      <Field label="这个状态用来记什么？" hint={KIND_HINT[kind]}>
        {() => (
          <SegmentedControl<VariableKind>
            aria-label="用途"
            value={kind}
            options={KIND_ORDER.map((item) => ({ value: item, label: KIND_LABEL[item] }))}
            onChange={setKind}
          />
        )}
      </Field>
      <Field label="叫什么名字？" hint={label.trim() ? `内部标识会是 ${name}` : "比如「拿到钥匙」「雪的好感度」"}>
        {({ id }) => <TextInput id={id} value={label} onChange={setLabel} placeholder="拿到钥匙" />}
      </Field>
      <div className="gs-state-new__actions">
        <Button variant="primary" type="submit" disabled={!label.trim()}>创建</Button>
        <Button onClick={onCancel}>取消</Button>
      </div>
    </form>
  );
}

export function declarationForKind(kind: VariableKind, label: string): VariableDeclaration {
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
    return { ...base, type: "string", default: "state_1", options: [{ id: "state_1", label: "状态 1" }] };
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

function describeUsage(writes: number, reads: number, displayOnly?: boolean): string {
  if (writes === 0 && reads === 0) return "剧本里还没有用到它";
  const parts: string[] = [];
  parts.push(writes === 0 ? "没有任何地方改变它" : `被 ${writes} 处改变`);
  if (reads > 0) parts.push(`被 ${reads} 处判断用到`);
  else if (!displayOnly) parts.push("还没有任何分流用到它");
  return parts.join(" · ");
}

function matches(query: string, fields: Array<string | undefined>): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return fields.some((field) => field?.toLowerCase().includes(normalized));
}

function nextOptionId(options: NonNullable<VariableDeclaration["options"]>): string {
  let index = options.length + 1;
  const taken = new Set(options.map((option) => option.id));
  while (taken.has(`state_${index}`)) index += 1;
  return `state_${index}`;
}
