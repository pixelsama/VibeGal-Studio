/**
 * 「改变故事状态」编辑器 —— `set` 指令的作者视角。
 *
 * 原实现让作者先选「赋值方式：类型化值 / 表达式」，选了表达式再手写
 * `affection + 3`。这里改成按状态用途给出直接的动作：数值是「增加 / 减少 /
 * 设为」步进器，旗标是「已发生 / 还没发生」，枚举是下拉。
 *
 * 底层写回的仍是同一条 `set` 指令（增减写成 `expr: "affection + 3"`），
 * 契约和外部 Agent 完全不受影响。
 */
import { variableKind, type SetInstr, type VariableDeclaration, type VariableRegistry } from "@vibegal/engine";
import { NumberInput, SegmentedControl, Select, SentenceRow, SentenceWord, Switch, TextInput } from "../common/Form";
import { useStudioI18n } from "../../lib/i18n";
import { variableLabel } from "./storyState";

export type StateChangeMode = "increase" | "decrease" | "assign";

export interface StateChangeEditorProps {
  instruction: SetInstr;
  variables?: VariableRegistry;
  onChange: (instruction: SetInstr) => void;
}

export function StateChangeEditor({ instruction, variables, onChange }: StateChangeEditorProps) {
  const { t } = useStudioI18n();
  const declaration = variables?.variables[instruction.key];
  const kind = declaration ? variableKind(declaration) : undefined;
  const mode = readMode(instruction);

  const names = Object.entries(variables?.variables ?? {});

  return (
    <div className="gs-state-change">
      <SentenceRow lead={t("script.stateChange.lead")}>
        {names.length > 0 ? (
          <Select
            aria-label={t("script.stateChange.target")}
            value={instruction.key}
            options={names.map(([name, item]) => ({ value: name, label: variableLabel(name, item) }))}
            onChange={(key) => onChange(resetForVariable(instruction, key, variables?.variables[key]))}
          />
        ) : (
          <TextInput
            aria-label={t("script.stateChange.target")}
            value={instruction.key}
            onChange={(key) => onChange({ ...instruction, key })}
          />
        )}
      </SentenceRow>

      {kind === "meter" || kind === "counter" ? (
        <SentenceRow>
          <SegmentedControl<StateChangeMode>
            aria-label={t("script.stateChange.modeLabel")}
            value={mode}
            options={[
              { value: "increase", label: t("script.stateChange.increase") },
              { value: "decrease", label: t("script.stateChange.decrease") },
              { value: "assign", label: t("script.stateChange.assign") },
            ]}
            onChange={(next) => onChange(writeMode(instruction, next, readAmount(instruction)))}
          />
          <NumberInput
            aria-label={t("script.stateChange.amount")}
            value={readAmount(instruction)}
            min={mode === "assign" ? declaration?.min : 0}
            max={mode === "assign" ? declaration?.max : undefined}
            onChange={(amount) => onChange(writeMode(instruction, mode, amount))}
          />
          {mode !== "assign" && declaration?.max != null && (
            <SentenceWord>
              {t("script.stateChange.rangeHint", {
                minimum: declaration.min ?? 0,
                maximum: declaration.max,
              })}
            </SentenceWord>
          )}
        </SentenceRow>
      ) : kind === "flag" ? (
        <SentenceRow lead={t("script.stateChange.markAs")}>
          <Switch
            aria-label={t("script.stateChange.markAs")}
            checked={instruction.value === true}
            label={instruction.value === true
              ? t("script.stateChange.happened")
              : t("script.stateChange.notHappened")}
            onChange={(checked) => onChange({ t: "set", key: instruction.key, id: instruction.id, value: checked })}
          />
        </SentenceRow>
      ) : kind === "state" && declaration?.options?.length ? (
        <SentenceRow lead={t("script.stateChange.assign")}>
          <Select
            aria-label={t("script.stateChange.assignState")}
            value={typeof instruction.value === "string" ? instruction.value : ""}
            options={declaration.options.map((option) => ({ value: option.id, label: option.label }))}
            onChange={(value) => onChange({ t: "set", key: instruction.key, id: instruction.id, value })}
          />
        </SentenceRow>
      ) : (
        <SentenceRow lead={t("script.stateChange.assign")}>
          <TextInput
            aria-label={t("script.stateChange.assignValue")}
            value={typeof instruction.value === "string" ? instruction.value : ""}
            onChange={(value) => onChange({ t: "set", key: instruction.key, id: instruction.id, value })}
          />
        </SentenceRow>
      )}

      {/* 手写表达式仍然保留，但降级成高级入口，不再是并列的「赋值方式」之一。 */}
      {(kind === "meter" || kind === "counter") && (
        <details className="gs-state-change__advanced">
          <summary>{t("script.stateChange.expression")}</summary>
          <TextInput
            aria-label={t("script.stateChange.expressionLabel")}
            value={instruction.expr ?? ""}
            onChange={(expr) => onChange({ t: "set", key: instruction.key, id: instruction.id, expr: expr || "0" })}
          />
        </details>
      )}
    </div>
  );
}

/** 从指令反推作者视角的动作。`x + n` 是增加，`x - n` 是减少，其余是设为。 */
export function readMode(instruction: SetInstr): StateChangeMode {
  const expr = instruction.expr?.trim();
  if (!expr) return "assign";
  if (new RegExp(`^${escape(instruction.key)}\\s*\\+\\s*\\d+(?:\\.\\d+)?$`).test(expr)) return "increase";
  if (new RegExp(`^${escape(instruction.key)}\\s*-\\s*\\d+(?:\\.\\d+)?$`).test(expr)) return "decrease";
  return "assign";
}

export function readAmount(instruction: SetInstr): number {
  const expr = instruction.expr?.trim();
  if (expr) {
    const match = /([+-])\s*(\d+(?:\.\d+)?)$/.exec(expr);
    if (match) return Number(match[2]);
    return 0;
  }
  return typeof instruction.value === "number" ? instruction.value : 0;
}

/** 写回：增减用表达式表达，设为用字面量，两者都是既有契约里的合法形态。 */
export function writeMode(instruction: SetInstr, mode: StateChangeMode, amount: number): SetInstr {
  const base = { t: "set" as const, key: instruction.key, id: instruction.id };
  if (mode === "assign") return { ...base, value: amount };
  return { ...base, expr: `${instruction.key} ${mode === "increase" ? "+" : "-"} ${amount}` };
}

function resetForVariable(instruction: SetInstr, key: string, declaration?: VariableDeclaration): SetInstr {
  const base = { t: "set" as const, key, id: instruction.id };
  if (!declaration) return { ...base, value: null };
  const kind = variableKind(declaration);
  // 换了目标状态就用它自己的初始值重置，避免留下类型不符的旧值。
  if (kind === "meter" || kind === "counter") return { ...base, expr: `${key} + 1` };
  return { ...base, value: declaration.default };
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
