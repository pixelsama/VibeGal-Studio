import type { NovelState, VariableRegistry } from "@vibegal/engine";
import { NumberInput, Select, Switch, TextInput } from "../common/Form";
import { bandLabelForValue } from "../script/storyState";
import { useStudioI18n, type StudioMessageKey, type StudioTranslator } from "../../lib/i18n";

const SYSTEM_TITLE_KEY: Record<string, StudioMessageKey> = {
  "system.playthroughCount": "preview.runtime.system.playthroughCount",
  "system.lastEndingId": "preview.runtime.system.lastEnding",
};
const EXPERIENCE_TITLE: Record<string, string> = {};

interface RuntimeStateInspectorProps {
  state: NovelState;
  currentNodeLabel?: string | null;
  /**
   * right（默认）= 侧栏全高面板，带标题行与左边框（全屏预览页）。
   * bottom = 嵌入沉底折叠面板：无标题/边框，标题交给外层 BottomSheet。
   */
  dock?: "right" | "bottom";
  onVariableChange?: (name: string, value: string | number | boolean | null) => void;
  onResetVariables?: () => void;
  registry?: VariableRegistry;
}

/** 预览尚未产生任何可见状态（背景/角色/音频/变量全空）时为 true。 */
export function isRuntimeStateEmpty(state: NovelState): boolean {
  return state.background == null
    && state.speaker == null
    && state.choice == null
    && state.audio.bgm == null
    && state.audio.voice == null
    && state.audio.sfx.length === 0
    && state.sprites.length === 0
    && Object.keys(state.vars).length === 0;
}

export function RuntimeStateInspector({ state, currentNodeLabel, dock = "right", onVariableChange, onResetVariables, registry }: RuntimeStateInspectorProps) {
  const { t } = useStudioI18n();
  const dockedBottom = dock === "bottom";
  const frameStyle = dockedBottom ? bottomDockPanelStyle : panelStyle;
  const title = dockedBottom ? null : <div style={titleStyle}>{t("preview.runtime.title")}</div>;

  if (isRuntimeStateEmpty(state)) {
    return (
      <aside style={frameStyle}>
        {title}
        <div style={contentStyle}>
          {currentNodeLabel != null && <Field label={t("preview.runtime.currentNode")} value={currentNodeLabel} />}
          <div style={emptyHintStyle}>{t("preview.runtime.emptyHint")}</div>
        </div>
      </aside>
    );
  }

  return (
    <aside style={frameStyle}>
      {title}
      <div style={contentStyle}>
        <Field label={t("preview.runtime.currentNode")} value={currentNodeLabel ?? t("preview.runtime.currentPreview")} />
        <Field label={t("preview.runtime.background")} value={state.background ?? t("preview.runtime.none")} />
        <Field label={t("preview.runtime.speaker")} value={state.speaker?.name ?? t("preview.runtime.none")} />
        <Field label={t("preview.runtime.choice")} value={state.choice ? t("preview.runtime.choiceCount", { count: state.choice.choices.length }) : t("preview.runtime.none")} />
        <Field label={t("preview.runtime.bgm")} value={state.audio.bgm?.id ?? t("preview.runtime.none")} />
        <Field label={t("preview.runtime.voice")} value={state.audio.voice?.id ?? t("preview.runtime.none")} />
        <Field
          label={t("preview.runtime.sprites")}
          value={state.sprites.length > 0 ? state.sprites.map((sprite) => `${sprite.id}:${sprite.expr}@${sprite.pos}`).join(", ") : t("preview.runtime.none")}
        />
        <div style={{ ...fieldStyle, minWidth: 0 }}><div style={labelStyle}>{t("preview.runtime.variables")}</div>
          {(["run", "global", "legacy", "system"] as const).map((group) => {
            const entries = Object.entries(state.vars).filter(([name]) => variableGroup(name, registry) === group);
            if (entries.length === 0) return null;
            return <section key={group} style={{ minWidth: 0 }}><strong>{groupLabel(group, t)}</strong>
              {entries.map(([name, value]) => <RuntimeVariableRow
                key={name}
                name={name}
                value={value}
                declaration={registry?.variables[name]}
                editable={Boolean(onVariableChange) && group !== "system"}
                onChange={(next) => onVariableChange?.(name, next)}
                t={t}
              />)}
            </section>;
          })}
          {onResetVariables && <button type="button" onClick={onResetVariables}>{t("preview.runtime.resetVariables")}</button>}
        </div>
      </div>
    </aside>
  );
}

function groupLabel(
  group: "run" | "global" | "legacy" | "experience" | "system",
  t: StudioTranslator,
) {
  return t(`preview.runtime.group.${group}` as StudioMessageKey);
}

function RuntimeVariableRow({
  name,
  value,
  declaration,
  editable,
  onChange,
  t,
}: {
  name: string;
  value: string | number | boolean | null;
  declaration?: VariableRegistry["variables"][string];
  editable: boolean;
  onChange: (value: string | number | boolean | null) => void;
  t: StudioTranslator;
}) {
  const systemTitleKey = SYSTEM_TITLE_KEY[name];
  const title = EXPERIENCE_TITLE[name] ?? (systemTitleKey ? t(systemTitleKey) : undefined) ?? declaration?.label ?? name;
  const band = declaration && typeof value === "number" ? bandLabelForValue(declaration, value) : undefined;

  return (
    <label style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 8, minWidth: 0 }}>
      <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
        {title}
        <details>
          <summary>{t("preview.runtime.technical")}</summary>
          <small style={{ display: "block", overflowWrap: "anywhere" }}>
            {name} · {declaration?.type ?? (value === null ? "null" : typeof value)}
            {declaration
              ? t("preview.runtime.initialValue", { value: String(declaration.default) })
              : t("preview.runtime.provided")}
          </small>
        </details>
      </span>
      <RuntimeVariableControl
        name={name}
        title={title}
        value={value}
        band={band}
        declaration={declaration}
        editable={editable}
        onChange={onChange}
        t={t}
      />
    </label>
  );
}

/** 按状态用途换控件：是/否用开关，枚举用下拉，数值用数字框。 */
function RuntimeVariableControl({
  name,
  title,
  value,
  band,
  declaration,
  editable,
  onChange,
  t,
}: {
  name: string;
  title: string;
  value: string | number | boolean | null;
  band?: string;
  declaration?: VariableRegistry["variables"][string];
  editable: boolean;
  onChange: (value: string | number | boolean | null) => void;
  t: StudioTranslator;
}) {
  // 剧情经历是决策日志的派生值，改它没有意义，只读显示。
  if (name.startsWith("chose.") || name.startsWith("seen.")) {
    return <span style={valueStyle}>{value === true ? t("common.yes") : t("common.no")}</span>;
  }
  if (typeof value === "boolean") {
    return <Switch aria-label={title} disabled={!editable} checked={value} label={value ? t("common.yes") : t("common.no")} onChange={onChange} />;
  }
  if (declaration?.options?.length && typeof value === "string") {
    return (
      <Select
        aria-label={title}
        disabled={!editable}
        value={value}
        options={declaration.options.map((option) => ({ value: option.id, label: option.label }))}
        onChange={onChange}
      />
    );
  }
  if (typeof value === "number") {
    return (
      <span style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
        <NumberInput
          aria-label={title}
          disabled={!editable}
          value={value}
          min={declaration?.min}
          max={declaration?.max}
          onChange={onChange}
        />
        {band && <small>{t("preview.runtime.valueWithBand", { band })}</small>}
      </span>
    );
  }
  return (
    <TextInput
      aria-label={title}
      disabled={!editable}
      value={value == null ? "" : String(value)}
      onChange={(next) => onChange(next === "" && value === null ? null : next)}
    />
  );
}

function variableGroup(name: string, registry?: VariableRegistry): "run" | "global" | "legacy" | "experience" | "system" {
  if (name.startsWith("chose.") || name.startsWith("seen.")) return "experience";
  if (name.startsWith("system.")) return "system";
  const declaration = registry?.variables[name];
  return declaration ? declaration.scope ?? "run" : "legacy";
}

function Field({ label, value, mono = false, multiline = false }: { label: string; value: string; mono?: boolean; multiline?: boolean }) {
  return (
    <div style={fieldStyle}>
      <div style={labelStyle}>{label}</div>
      <div style={{
        ...valueStyle,
        whiteSpace: multiline ? "pre-wrap" : "normal",
        fontFamily: mono ? "ui-monospace, SFMono-Regular, Menlo, monospace" : undefined,
      }}
      >
        {value}
      </div>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  maxWidth: 320,
  height: "100%",
  borderLeft: "1px solid var(--border)",
  background: "var(--bg-app)",
};

/** dock="bottom"：去掉侧栏边框与宽度限制，撑满 BottomSheet 内容区。 */
const bottomDockPanelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  height: "100%",
  background: "var(--bg-app)",
};

const titleStyle: React.CSSProperties = {
  padding: "var(--space-3) var(--space-4)",
  borderBottom: "1px solid var(--border)",
  fontSize: "var(--text-base)",
  fontWeight: 600,
  color: "var(--text-primary)",
};

const contentStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  gap: "var(--space-3)",
  padding: "var(--space-4)",
  overflowY: "auto",
};

const fieldStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  gap: "var(--space-1)",
};

const labelStyle: React.CSSProperties = {
  fontSize: "var(--text-xs)",
  color: "var(--text-muted)",
  textTransform: "uppercase",
};

const valueStyle: React.CSSProperties = {
  fontSize: "var(--text-sm)",
  color: "var(--text-primary)",
  wordBreak: "break-word",
};

const emptyHintStyle: React.CSSProperties = {
  fontSize: "var(--text-sm)",
  color: "var(--text-muted)",
  lineHeight: 1.6,
};
