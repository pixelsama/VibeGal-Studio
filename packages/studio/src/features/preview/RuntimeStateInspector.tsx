import type { NovelState, VariableRegistry } from "@vibegal/engine";

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
  const dockedBottom = dock === "bottom";
  const frameStyle = dockedBottom ? bottomDockPanelStyle : panelStyle;
  const title = dockedBottom ? null : <div style={titleStyle}>运行状态</div>;

  if (isRuntimeStateEmpty(state)) {
    return (
      <aside style={frameStyle}>
        {title}
        <div style={contentStyle}>
          {currentNodeLabel != null && <Field label="当前节点" value={currentNodeLabel} />}
          <div style={emptyHintStyle}>预览运行后，这里会显示背景、角色、音频与变量状态。</div>
        </div>
      </aside>
    );
  }

  return (
    <aside style={frameStyle}>
      {title}
      <div style={contentStyle}>
        <Field label="当前节点" value={currentNodeLabel ?? "当前预览"} />
        <Field label="背景" value={state.background ?? "无"} />
        <Field label="说话人" value={state.speaker?.name ?? "无"} />
        <Field label="选项" value={state.choice ? `${state.choice.choices.length} 个选项` : "无"} />
        <Field label="背景音乐" value={state.audio.bgm?.id ?? "无"} />
        <Field label="语音" value={state.audio.voice?.id ?? "无"} />
        <Field
          label="角色立绘"
          value={state.sprites.length > 0 ? state.sprites.map((sprite) => `${sprite.id}:${sprite.expr}@${sprite.pos}`).join(", ") : "无"}
        />
        <div style={{ ...fieldStyle, minWidth: 0 }}><div style={labelStyle}>变量</div>
          {(["run", "global", "legacy", "system"] as const).map((group) => {
            const entries = Object.entries(state.vars).filter(([name]) => variableGroup(name, registry) === group);
            if (entries.length === 0) return null;
            return <section key={group} style={{ minWidth: 0 }}><strong>{groupLabel(group)}</strong>
              {entries.map(([name, value]) => <RuntimeVariableRow
                key={name}
                name={name}
                value={value}
                declaration={registry?.variables[name]}
                editable={Boolean(onVariableChange) && group !== "system"}
                onChange={(next) => onVariableChange?.(name, next)}
              />)}
            </section>;
          })}
          {onResetVariables && <button type="button" onClick={onResetVariables}>重置变量</button>}
        </div>
      </div>
    </aside>
  );
}

function groupLabel(group: "run" | "global" | "legacy" | "system") {
  return group === "run" ? "本轮变量"
    : group === "global" ? "跨周目变量"
      : group === "legacy" ? "未声明变量"
        : "系统状态";
}

function RuntimeVariableRow({
  name,
  value,
  declaration,
  editable,
  onChange,
}: {
  name: string;
  value: string | number | boolean | null;
  declaration?: VariableRegistry["variables"][string];
  editable: boolean;
  onChange: (value: string | number | boolean | null) => void;
}) {
  const isSystem = name === "system.playthroughCount" || name === "system.lastEndingId";
  const title = name === "system.playthroughCount" ? "通关次数"
    : name === "system.lastEndingId" ? "上次达成结局"
      : declaration?.label ?? name;
  const displayValue = name === "system.lastEndingId" && value === null ? "尚无" : value == null ? "尚无" : String(value);
  return <label style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 8, minWidth: 0 }}>
    <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
      {title}
      <details>
        <summary>技术详情</summary>
        <small style={{ display: "block", overflowWrap: "anywhere" }}>
          {name} · {declaration?.type ?? (value === null ? "null" : typeof value)}
          {declaration ? ` · 默认值 ${String(declaration.default)}` : " · runtime"}
        </small>
      </details>
    </span>
    <input
      style={{ width: "100%", minWidth: 0, boxSizing: "border-box" }}
      disabled={!editable || isSystem}
      value={displayValue}
      onChange={(event) => onChange(parseTypedValue(event.target.value, value))}
    />
  </label>;
}

function variableGroup(name: string, registry?: VariableRegistry): "run" | "global" | "legacy" | "system" {
  if (name.startsWith("system.")) return "system";
  const declaration = registry?.variables[name];
  return declaration ? declaration.scope ?? "run" : "legacy";
}

function parseTypedValue(raw: string, previous: string | number | boolean | null) {
  if (previous === null) return raw === "null" ? null : raw;
  if (typeof previous === "boolean") return raw === "true";
  if (typeof previous === "number") return Number(raw);
  return raw;
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
