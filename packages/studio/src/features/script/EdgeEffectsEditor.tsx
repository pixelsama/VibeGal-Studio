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
import { translateZhCN, useStudioI18n, type StudioTranslator } from "../../lib/i18n";
import { StateChangeEditor } from "./StateChangeEditor";
import { variableLabel } from "./storyState";

export interface EdgeEffectsEditorProps {
  effects?: SetInstr[];
  registry?: VariableRegistry;
  disabled?: boolean;
  onChange: (effects: SetInstr[] | undefined) => void;
}

export function EdgeEffectsEditor({ effects, registry, disabled, onChange }: EdgeEffectsEditorProps) {
  const { t } = useStudioI18n();
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
        title={names.length === 0
          ? t("script.edgeEffects.addHint.empty")
          : t("script.edgeEffects.addHint.ready")}
      >
        <Plus size={14} aria-hidden="true" />
        {t("script.edgeEffects.add")}
      </Button>
    );
  }

  return (
    <div className="gs-edge-effects">
      <h5>{t("script.edgeEffects.title")}</h5>
      {list.map((effect, index) => (
        <div key={index} className="gs-edge-effects__row">
          <StateChangeEditor
            instruction={effect}
            variables={registry}
            onChange={(next) => update(index, next)}
          />
          {!disabled && (
            <IconButton
              aria-label={t("script.edgeEffects.remove", { number: index + 1 })}
              onClick={() => remove(index)}
            >
              <X size={14} aria-hidden="true" />
            </IconButton>
          )}
        </div>
      ))}
      {!disabled && (
        <Button onClick={() => onChange([...list, defaultEffect(names[0], registry)])} disabled={names.length === 0}>
          <Plus size={14} aria-hidden="true" />
          {t("script.edgeEffects.addAnother")}
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
export function describeEdgeEffects(
  effects: SetInstr[] | undefined,
  registry?: VariableRegistry,
  t: StudioTranslator = translateZhCN,
): string {
  if (!effects || effects.length === 0) return "";
  return effects.map((effect) => {
    const label = variableLabel(effect.key, registry?.variables[effect.key]);
    if ("expr" in effect && effect.expr != null) {
      const match = new RegExp(`^${escapeRegExp(effect.key)}\\s*([+-])\\s*(\\d+(?:\\.\\d+)?)$`).exec(effect.expr.trim());
      if (match) {
        return t(
          match[1] === "+"
            ? "script.edgeEffects.summary.increase"
            : "script.edgeEffects.summary.decrease",
          { label, amount: match[2] },
        );
      }
      return t("script.edgeEffects.summary.expression", { label });
    }
    if (typeof effect.value === "boolean") {
      return t(
        effect.value
          ? "script.edgeEffects.summary.happened"
          : "script.edgeEffects.summary.notHappened",
        { label },
      );
    }
    return t("script.edgeEffects.summary.assign", {
      label,
      value: effect.value ?? t("script.edgeEffects.summary.none"),
    });
  }).join(t("script.edgeEffects.summary.separator"));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
