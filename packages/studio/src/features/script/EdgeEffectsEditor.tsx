/**
 * 「走这条之后」—— 编辑挂在出口上的状态改变。
 *
 * 为什么挂在出口而不是目标节点：目标节点常常是多个选项汇入的共通场景（「第二天
 * 早上」），把 `set` 放进去会让所有进入者都被加分，作者却以为只有选了某个选项
 * 的人才加。挂在出口上，改变就只属于这条路。
 *
 * 复用 StateChangeEditor，所以「增加 / 减少 / 设为」的句子与节点内完全一致。
 */
import { Plus, X } from "lucide-react";
import { variableKind, type SetInstr, type VariableRegistry } from "@vibegal/engine";
import { Button, IconButton } from "../common/Button";
import { StateChangeEditor } from "./StateChangeEditor";
import { variableLabel } from "./storyState";

export interface EdgeEffectsEditorProps {
  effects?: SetInstr[];
  registry?: VariableRegistry;
  disabled?: boolean;
  onChange: (effects: SetInstr[] | undefined) => void;
}

export function EdgeEffectsEditor({ effects, registry, disabled, onChange }: EdgeEffectsEditorProps) {
  const list = effects ?? [];
  const names = Object.keys(registry?.variables ?? {});

  const update = (index: number, next: SetInstr) =>
    onChange(list.map((item, at) => (at === index ? next : item)));
  // 空数组会在项目文件里留下一个没有意义的 `"effects": []`，统一收敛成缺省。
  const remove = (index: number) => {
    const next = list.filter((_, at) => at !== index);
    onChange(next.length > 0 ? next : undefined);
  };

  if (list.length === 0) {
    if (disabled) return null;
    return (
      <Button
        onClick={() => onChange([defaultEffect(names[0], registry)])}
        disabled={names.length === 0}
        title={names.length === 0 ? "先在「故事状态」里建一个状态" : "走这条出口之后改变故事状态"}
      >
        <Plus size={14} aria-hidden="true" />
        走这条之后…
      </Button>
    );
  }

  return (
    <div className="gs-edge-effects">
      <h5>走这条之后</h5>
      {list.map((effect, index) => (
        <div key={index} className="gs-edge-effects__row">
          <StateChangeEditor
            instruction={effect}
            variables={registry}
            onChange={(next) => update(index, next)}
          />
          {!disabled && (
            <IconButton aria-label={`删除第 ${index + 1} 个状态改变`} onClick={() => remove(index)}>
              <X size={14} aria-hidden="true" />
            </IconButton>
          )}
        </div>
      ))}
      {!disabled && (
        <Button onClick={() => onChange([...list, defaultEffect(names[0], registry)])} disabled={names.length === 0}>
          <Plus size={14} aria-hidden="true" />
          再加一个
        </Button>
      )}
    </div>
  );
}

/** 新建效果的初值：按用途给出一个立刻合法、语义常见的动作。 */
export function defaultEffect(name: string | undefined, registry?: VariableRegistry): SetInstr {
  const key = name ?? "";
  const declaration = key ? registry?.variables[key] : undefined;
  if (!declaration) return { t: "set", key, value: null };
  const kind = variableKind(declaration);
  // 数值/次数最常见的动作是累加，其余是直接设定。
  if (kind === "meter" || kind === "counter") return { t: "set", key, expr: `${key} + 1` };
  if (kind === "flag") return { t: "set", key, value: true };
  return { t: "set", key, value: declaration.default };
}

/** 一句话概述，用于折叠态与只读展示。 */
export function describeEdgeEffects(effects: SetInstr[] | undefined, registry?: VariableRegistry): string {
  if (!effects || effects.length === 0) return "";
  return effects.map((effect) => {
    const label = variableLabel(effect.key, registry?.variables[effect.key]);
    if ("expr" in effect && effect.expr != null) {
      const match = new RegExp(`^${escapeRegExp(effect.key)}\\s*([+-])\\s*(\\d+(?:\\.\\d+)?)$`).exec(effect.expr.trim());
      if (match) return `${label} ${match[1] === "+" ? "增加" : "减少"} ${match[2]}`;
      return `${label} 由表达式计算`;
    }
    if (typeof effect.value === "boolean") return `${label} ${effect.value ? "标记为已发生" : "恢复为未发生"}`;
    return `${label} 设为 ${effect.value ?? "尚无"}`;
  }).join("；");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
