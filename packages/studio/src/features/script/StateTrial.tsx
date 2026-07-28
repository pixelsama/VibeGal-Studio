/**
 * 试算面板：假设故事状态是这样，看看会走哪条分支。
 *
 * 原实现在 Node Inspector 里有一套「模拟变量」，预览页里另有一套「注入值」，
 * 两者互不相通；而且布尔值要在文本框里手打 `true`。这里统一成一份值，按用途
 * 换控件，并且只列出当前分流真正用到的状态，避免把整个变量表铺开。
 */
import { RotateCcw } from "lucide-react";
import { variableKind } from "@vibegal/engine";
import { Button } from "../common/Button";
import { NumberInput, Select, SentenceRow, Switch, TextInput } from "../common/Form";
import { useStudioI18n, type StudioTranslator } from "../../lib/i18n";
import { bandLabelForValue, type StateSource } from "./storyState";

export interface StateTrialProps {
  sources: StateSource[];
  values: Record<string, string | number | boolean | null>;
  onChange: (values: Record<string, string | number | boolean | null>) => void;
  /** 只列出这些状态；不传则列出全部可试算项。 */
  only?: string[];
}

export function StateTrial({ sources, values, onChange, only }: StateTrialProps) {
  const { t } = useStudioI18n();
  const visible = sources.filter((source) => {
    if (source.name === "system.lastEndingId") return false;
    return only ? only.includes(source.name) : true;
  });
  if (visible.length === 0) return null;

  const set = (name: string, value: string | number | boolean | null) => onChange({ ...values, [name]: value });

  return (
    <details className="gs-trial">
      <summary>{t("script.trial.summary")}</summary>
      <div className="gs-trial__body">
        {visible.map((source) => (
          <SentenceRow key={source.name} lead={source.label}>
            <TrialControl
              source={source}
              value={values[source.name]}
              t={t}
              onChange={(value) => set(source.name, value)}
            />
          </SentenceRow>
        ))}
        <Button onClick={() => onChange({})}>
          <RotateCcw size={14} aria-hidden="true" />
          {t("script.trial.reset")}
        </Button>
      </div>
    </details>
  );
}

function TrialControl({
  source,
  value,
  t,
  onChange,
}: {
  source: StateSource;
  value: string | number | boolean | null | undefined;
  t: StudioTranslator;
  onChange: (value: string | number | boolean | null) => void;
}) {
  const label = t("script.trial.valueLabel", { label: source.label });
  const declaration = source.declaration;
  const kind = declaration ? variableKind(declaration) : source.kind;

  // 旗标与剧情经历都是是/否，用开关而不是要求手打 true。
  if (kind === "flag" || source.kind === "chose" || source.kind === "seen") {
    const on = value === true;
    return (
      <Switch
        aria-label={label}
        checked={on}
        label={on ? t("script.trial.yes") : t("script.trial.no")}
        onChange={onChange}
      />
    );
  }

  if (kind === "state" && declaration?.options?.length) {
    return (
      <Select
        aria-label={label}
        value={typeof value === "string" ? value : String(declaration.default ?? "")}
        options={declaration.options.map((option) => ({ value: option.id, label: option.label }))}
        onChange={onChange}
      />
    );
  }

  if (kind === "meter" || kind === "counter" || source.name === "system.playthroughCount") {
    const numeric = typeof value === "number" ? value : Number(declaration?.default ?? 0);
    const band = declaration ? bandLabelForValue(declaration, numeric) : undefined;
    return (
      <>
        <NumberInput
          aria-label={label}
          value={numeric}
          min={declaration?.min}
          max={declaration?.max}
          onChange={onChange}
        />
        {band && (
          <span className="gs-sentence__word">
            {t("script.trial.band", { band })}
          </span>
        )}
      </>
    );
  }

  return (
    <TextInput
      aria-label={label}
      value={typeof value === "string" ? value : String(declaration?.default ?? "")}
      onChange={onChange}
    />
  );
}
