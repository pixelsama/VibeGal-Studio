import type { NovelState } from "@vibegal/engine";

interface RuntimeStateInspectorProps {
  state: NovelState;
  currentNodeLabel?: string | null;
  /**
   * right（默认）= 侧栏全高面板，带标题行与左边框（全屏预览页）。
   * bottom = 嵌入沉底折叠面板：无标题/边框，标题交给外层 BottomSheet。
   */
  dock?: "right" | "bottom";
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

export function RuntimeStateInspector({ state, currentNodeLabel, dock = "right" }: RuntimeStateInspectorProps) {
  const dockedBottom = dock === "bottom";
  const frameStyle = dockedBottom ? bottomDockPanelStyle : panelStyle;
  const title = dockedBottom ? null : <div style={titleStyle}>Runtime</div>;

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
        <Field label="Choice" value={state.choice ? `${state.choice.choices.length} 个选项` : "无"} />
        <Field label="BGM" value={state.audio.bgm?.id ?? "无"} />
        <Field label="Voice" value={state.audio.voice?.id ?? "无"} />
        <Field
          label="Sprites"
          value={state.sprites.length > 0 ? state.sprites.map((sprite) => `${sprite.id}:${sprite.expr}@${sprite.pos}`).join(", ") : "无"}
        />
        <Field
          label="Vars"
          value={Object.keys(state.vars).length > 0 ? JSON.stringify(state.vars, null, 2) : "{}"}
          mono
          multiline
        />
      </div>
    </aside>
  );
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
  minWidth: 260,
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
  gap: "var(--space-3)",
  padding: "var(--space-4)",
  overflowY: "auto",
};

const fieldStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
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
