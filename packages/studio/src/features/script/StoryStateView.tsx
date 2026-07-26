/**
 * 故事状态视图 —— 脚本工作台的一级视图，与「剧情流程」平级。
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
import { KIND_LABEL, SCOPE_LABEL, describeVariableIssue, variableLabel } from "./storyState";

const KIND_ORDER: VariableKind[] = ["flag", "meter", "state", "counter", "text"];

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
              aria-label="搜索故事状态"
              placeholder="搜索"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {onChange && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus size={14} aria-hidden="true" />
              新建状态
            </Button>
          )}
        </div>

        <div className="gs-state-view__groups">
          {KIND_ORDER.map((kind) => {
            const group = items.filter((item) => item.kind === kind);
            if (group.length === 0) return null;
            return (
              <section key={kind} className="gs-state-view__group">
                <h4>{KIND_LABEL[kind]}</h4>
                {group.map((item) => {
                  const usage = usageByName.get(item.name);
                  const problems = usage?.issues.length ?? 0;
                  return (
                    <button
                      key={item.name}
                      type="button"
                      className={item.name === selected ? "gs-state-view__item gs-state-view__item--active" : "gs-state-view__item"}
                      onClick={() => setSelected(item.name)}
                    >
                      <span className="gs-state-view__item-name">
                        {variableLabel(item.name, item.declaration, manifest)}
                      </span>
                      {problems > 0 && <span className="gs-state-view__item-flag" title="有需要处理的问题">⚠</span>}
                    </button>
                  );
                })}
              </section>
            );
          })}

          {undeclared.length > 0 && (
            <section className="gs-state-view__group">
              <h4>剧本里用到、还没登记</h4>
              {undeclared.map((entry) => (
                <div key={entry.name} className="gs-story-state__undeclared-row">
                  <span>{entry.name}</span>
                  {onChange && (
                    <Button onClick={() => onChange(registerInferredVariable(effectiveRegistry, entry.name, entry.types))}>
                      登记
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
            title="还没有故事状态"
            description="玩家的选择本身已经可以直接用在分流条件里。只有需要累积或记住的东西（好感度、拿到钥匙、当前路线）才要在这里建一个。"
            action={onChange ? <Button variant="primary" onClick={() => setCreating(true)}>新建第一个状态</Button> : undefined}
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
            />
          </>
        ) : (
          <p className="gs-story-state__empty">没有匹配的故事状态。</p>
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
}: {
  name: string;
  declaration: VariableDeclaration;
  usage?: VariableEntry;
  graph: ProjectGraph;
  registry: VariableRegistry;
  manifest?: Manifest;
  onOpenNode?: (nodeId: string, instructionIndex?: number) => void;
  onSelectEdge?: (edgeId: string) => void;
}) {
  const nodeTitle = (nodeId?: string) => graph.nodes.find((node) => node.id === nodeId)?.title || nodeId || "未知节点";
  const writes = usage?.writes ?? [];
  const reads = usage?.reads ?? [];
  const issues = (usage?.issues ?? []).map((issue) => describeVariableIssue(issue, name, registry, manifest));

  return (
    <section className="gs-state-usage">
      <h3>在故事里</h3>

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
        <h4>{writes.length === 0 ? "还没有任何地方改变它" : `${writes.length} 处改变它`}</h4>
        {writes.map((point, index) => (
          <button
            key={`${point.nodeId}:${point.instructionIndex}:${index}`}
            type="button"
            className="gs-state-usage__row"
            onClick={() => point.nodeId && onOpenNode?.(point.nodeId, point.instructionIndex)}
          >
            <span>{nodeTitle(point.nodeId)}</span>
            <span className="gs-state-usage__hint">第 {(point.instructionIndex ?? 0) + 1} 条 · 去看看</span>
          </button>
        ))}
      </div>

      <div className="gs-state-usage__block">
        <h4>
          {reads.length === 0
            ? declaration.displayOnly ? "只给界面显示用，不参与分流" : "还没有任何分流用到它"
            : `${reads.length} 处分流用到它`}
        </h4>
        {reads.map((point, index) => (
          <button
            key={`${point.edgeId}:${index}`}
            type="button"
            className="gs-state-usage__row"
            onClick={() => point.edgeId && onSelectEdge?.(point.edgeId)}
          >
            <span>{nodeTitle(point.nodeId)} 的分流</span>
            <span className="gs-state-usage__hint">去看看</span>
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

export { SCOPE_LABEL };
