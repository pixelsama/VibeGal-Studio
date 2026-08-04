/**
 * 故事状态视图 —— 剧情工作台的一级视图，与「剧情流程」平级。
 *
 * Spec 24 把面板内容重写了，却仍留在「分析」tab 里往下滚，于是故事状态在信息
 * 架构上依然是一份分析报告而不是创作对象，用户因此几乎感受不到变化。这里把它
 * 提为主从页面：左列是状态清单，右列是详情，详情的重点是「在故事里的哪些位置」
 * —— 作者打开这个页面多半就是为了回答这个问题。
 */
import { useEffect, useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { variableKind, type Manifest, type VariableDeclaration, type VariableKind, type VariableRegistry } from "@vibegal/engine";
import type { NodeEntry, ProjectGraph } from "../../lib/types";
import { Button } from "../common/Button";
import { EmptyState } from "../common/EmptyState";
import { StateCard, NewStateForm, registerInferredVariable } from "./StoryStatePanel";
import { analyzeGraphVariables, type VariableEntry } from "./variableAnalysis";
import { describeVariableIssue, variableLabel } from "./storyState";
import { useStudioI18n, type StudioTranslator } from "../../lib/i18n";

const KIND_ORDER: VariableKind[] = ["flag", "meter", "state", "counter", "text"];

const KIND_MESSAGE_KEY = {
  flag: "script.state.kind.flag",
  meter: "script.state.kind.meter",
  state: "script.state.kind.state",
  counter: "script.state.kind.counter",
  text: "script.state.kind.text",
} as const;

function kindLabel(kind: VariableKind, t: StudioTranslator): string {
  return t(KIND_MESSAGE_KEY[kind]);
}

export interface StoryStateViewProps {
  registry?: VariableRegistry;
  graph: ProjectGraph;
  nodes?: NodeEntry[];
  manifest?: Manifest;
  onChange?: (registry: VariableRegistry) => void;
  onRename?: (from: string, to: string) => void;
  /** 跳到改变它的节点；带指令下标时进一步聚焦到那一条。 */
  onOpenNode?: (nodeId: string, instructionIndex?: number) => void;
  onSelectEdge?: (edgeId: string) => void;
}

export function StoryStateView({
  registry,
  graph,
  nodes,
  manifest,
  onChange,
  onRename,
  onOpenNode,
  onSelectEdge,
}: StoryStateViewProps) {
  const { t } = useStudioI18n();
  const effectiveRegistry = registry ?? { version: 1 as const, variables: {} };
  const analysis = useMemo(
    () => analyzeGraphVariables(graph, nodes, effectiveRegistry),
    [graph, nodes, effectiveRegistry],
  );
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const usageByName = useMemo(
    () => new Map(analysis.variables.map((entry) => [entry.name, entry])),
    [analysis.variables],
  );

  const items = useMemo(() => Object.entries(effectiveRegistry.variables)
    .map(([name, declaration]) => ({ name, declaration, kind: variableKind(declaration) }))
    .filter(({ name, declaration }) => matches(query, [name, declaration.label, declaration.description]))
    .sort((left, right) => KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind)
      || left.name.localeCompare(right.name)),
    [effectiveRegistry.variables, query]);

  const undeclared = analysis.variables.filter((entry) => !effectiveRegistry.variables[entry.name]);

  // 选中项被删除或改名后自动落到第一项，避免右栏空白。
  useEffect(() => {
    if (selected && effectiveRegistry.variables[selected]) return;
    setSelected(items[0]?.name ?? null);
  }, [selected, items, effectiveRegistry.variables]);

  const active = selected ? effectiveRegistry.variables[selected] : undefined;

  const update = (name: string, declaration: VariableDeclaration) => onChange?.({
    ...effectiveRegistry,
    variables: { ...effectiveRegistry.variables, [name]: declaration },
  });

  const remove = (name: string) => {
    const variables = { ...effectiveRegistry.variables };
    delete variables[name];
    onChange?.({ ...effectiveRegistry, variables });
  };

  const isEmpty = items.length === 0 && undeclared.length === 0 && !query.trim();

  return (
    <div className="gs-state-view">
      <aside className="gs-state-view__list">
        <div className="gs-state-view__list-head">
          <div className="gs-story-state__search">
            <Search size={14} aria-hidden="true" />
            <input
              className="gs-input"
              aria-label={t("script.state.searchLabel")}
              placeholder={t("script.state.searchPlaceholder")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {onChange && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus size={14} aria-hidden="true" />
              {t("script.state.newState")}
            </Button>
          )}
        </div>

        <div className="gs-state-view__groups">
          {KIND_ORDER.map((kind) => {
            const group = items.filter((item) => item.kind === kind);
            if (group.length === 0) return null;
            return (
              <section key={kind} className="gs-state-view__group">
                <h4>{kindLabel(kind, t)}</h4>
                {group.map((item) => {
                  const usage = usageByName.get(item.name);
                  const problems = usage?.issues.length ?? 0;
                  return (
                    <button
                      key={item.name}
                      type="button"
                      className={item.name === selected ? "gs-state-view__item gs-state-view__item--active" : "gs-state-view__item"}
                      aria-current={item.name === selected ? "true" : undefined}
                      onClick={() => setSelected(item.name)}
                    >
                      <span className="gs-state-view__item-name">
                        {variableLabel(item.name, item.declaration, manifest)}
                      </span>
                      {problems > 0 && (
                        <span
                          className="gs-state-view__item-flag"
                          title={t("script.stateView.problem")}
                        >
                          ⚠
                        </span>
                      )}
                    </button>
                  );
                })}
              </section>
            );
          })}

          {undeclared.length > 0 && (
            <section className="gs-state-view__group">
              <h4>{t("script.stateView.undeclared")}</h4>
              {undeclared.map((entry) => (
                <div key={entry.name} className="gs-story-state__undeclared-row">
                  <span>{entry.name}</span>
                  {onChange && (
                    <Button onClick={() => onChange(registerInferredVariable(effectiveRegistry, entry.name, entry.types))}>
                      {t("script.state.register")}
                    </Button>
                  )}
                </div>
              ))}
            </section>
          )}
        </div>
      </aside>

      <div className="gs-state-view__detail">
        {creating && onChange ? (
          <NewStateForm
            existingNames={new Set(Object.keys(effectiveRegistry.variables))}
            t={t}
            onCancel={() => setCreating(false)}
            onCreate={(name, declaration) => {
              onChange({ ...effectiveRegistry, variables: { ...effectiveRegistry.variables, [name]: declaration } });
              setCreating(false);
              setSelected(name);
            }}
          />
        ) : isEmpty ? (
          <EmptyState
            icon={Plus}
            title={t("script.stateView.empty.title")}
            description={t("script.stateView.empty.description")}
            action={onChange
              ? <Button variant="primary" onClick={() => setCreating(true)}>{t("script.stateView.empty.action")}</Button>
              : undefined}
          />
        ) : active && selected ? (
          <>
            <StateCard
              name={selected}
              declaration={active}
              kind={variableKind(active)}
              usage={usageByName.get(selected)}
              manifest={manifest}
              editable={Boolean(onChange)}
              onChange={(next) => update(selected, next)}
              onRename={onRename}
              onRemove={() => remove(selected)}
              t={t}
            />
            <StateUsage
              name={selected}
              declaration={active}
              usage={usageByName.get(selected)}
              graph={graph}
              registry={effectiveRegistry}
              manifest={manifest}
              onOpenNode={onOpenNode}
              onSelectEdge={onSelectEdge}
              t={t}
            />
          </>
        ) : (
          <p className="gs-story-state__empty">{t("script.stateView.noMatches")}</p>
        )}
      </div>
    </div>
  );
}

/**
 * 「在故事里」—— 这一块是本页面存在的理由。
 * 每条都能点开到真正该改的位置，而不是只报个计数。
 */
function StateUsage({
  name,
  declaration,
  usage,
  graph,
  registry,
  manifest,
  onOpenNode,
  onSelectEdge,
  t,
}: {
  name: string;
  declaration: VariableDeclaration;
  usage?: VariableEntry;
  graph: ProjectGraph;
  registry: VariableRegistry;
  manifest?: Manifest;
  onOpenNode?: (nodeId: string, instructionIndex?: number) => void;
  onSelectEdge?: (edgeId: string) => void;
  t: StudioTranslator;
}) {
  const nodeTitle = (nodeId?: string) => graph.nodes.find((node) => node.id === nodeId)?.title
    || nodeId
    || t("script.stateView.unknownNode");
  const writes = usage?.writes ?? [];
  const reads = usage?.reads ?? [];
  const issues = (usage?.issues ?? []).map((issue) => describeVariableIssue(issue, name, registry, manifest, t));

  return (
    <section className="gs-state-usage">
      <h3>{t("script.stateView.inStory")}</h3>

      {issues.length > 0 && (
        <div className="gs-state-usage__issues">
          {issues.map((issue) => (
            <p key={issue.code} className="gs-branch__problem">
              {issue.message}
              {issue.fix && <span className="gs-state-usage__fix">{issue.fix}</span>}
            </p>
          ))}
        </div>
      )}

      <div className="gs-state-usage__block">
        <h4>{writes.length === 0
          ? t("script.stateView.noWrites")
          : t("script.stateView.writes", { count: writes.length })}</h4>
        {writes.map((point, index) => (
          <button
            key={`${point.nodeId}:${point.instructionIndex}:${index}`}
            type="button"
            className="gs-state-usage__row"
            onClick={() => point.nodeId && onOpenNode?.(point.nodeId, point.instructionIndex)}
          >
            <span>{nodeTitle(point.nodeId)}</span>
            <span className="gs-state-usage__hint">
              {t("script.stateView.instruction", { number: (point.instructionIndex ?? 0) + 1 })}
            </span>
          </button>
        ))}
      </div>

      <div className="gs-state-usage__block">
        <h4>
          {reads.length === 0
            ? declaration.displayOnly
              ? t("script.stateView.displayOnly")
              : t("script.stateView.noReads")
            : t("script.stateView.reads", { count: reads.length })}
        </h4>
        {reads.map((point, index) => (
          <button
            key={`${point.edgeId}:${index}`}
            type="button"
            className="gs-state-usage__row"
            onClick={() => point.edgeId && onSelectEdge?.(point.edgeId)}
          >
            <span>{t("script.stateView.branchAt", { title: nodeTitle(point.nodeId) })}</span>
            <span className="gs-state-usage__hint">{t("script.stateView.open")}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function matches(query: string, fields: Array<string | undefined>): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return fields.some((field) => field?.toLowerCase().includes(normalized));
}
