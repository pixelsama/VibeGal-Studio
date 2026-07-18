/**
 * TokenEditorPanel —— 外观工作台左侧的 token 属性编辑器（Spec 17 §6）。
 *
 * 受控原则：输入框显示目标 skin 的 raw token 值，placeholder 显示
 * DEFAULT_UI_TOKENS 的默认值；空输入 = 清除该 token（回退渲染器默认）。
 * 所有编辑经 onEdit 冒泡给 AppearanceWorkspace 走 save_manifest 持久化，
 * 本组件不碰任何异步。
 */
import {
  APPEARANCE_TOKEN_GROUPS,
  hexColorOrNull,
  tokenDefaultPlaceholder,
  tokenVisibleChecked,
  visibleTokenEditValue,
  type TokenFieldDef,
  type TokenGroupDef,
} from "./appearanceTokens";

interface TokenEditorPanelProps {
  /** 编辑目标 skin 的 raw token 表 */
  tokens: Record<string, string | number>;
  /** 字体候选（来自 manifest.fonts 的 family，datalist 用） */
  fontFamilies: string[];
  /** 冲突等状态下锁死编辑 */
  disabled?: boolean;
  /** 展示的分组（缺省 = 全部；选中部件时由父组件过滤后传入） */
  groups?: TokenGroupDef[];
  onEdit: (key: string, value: string | number | undefined) => void;
}

const FONT_DATALIST_ID = "appearance-font-family-options";

export function TokenEditorPanel({ tokens, fontFamilies, disabled = false, groups = APPEARANCE_TOKEN_GROUPS, onEdit }: TokenEditorPanelProps) {
  return (
    <div style={panelStyle}>
      <datalist id={FONT_DATALIST_ID}>
        {fontFamilies.map((family) => (
          <option key={family} value={family} />
        ))}
      </datalist>
      {groups.map((group) => (
        <section key={group.id} style={groupStyle} aria-label={group.title}>
          <div style={groupTitleStyle}>{group.title}</div>
          {group.fields.map((field) => (
            <TokenField
              key={field.key}
              field={field}
              rawValue={tokens[field.key]}
              checked={field.kind === "checkbox" ? tokenVisibleChecked(tokens, field.key) : undefined}
              disabled={disabled}
              onEdit={onEdit}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

function TokenField({
  field,
  rawValue,
  checked,
  disabled,
  onEdit,
}: {
  field: TokenFieldDef;
  rawValue: string | number | undefined;
  checked?: boolean;
  disabled: boolean;
  onEdit: (key: string, value: string | number | undefined) => void;
}) {
  return (
    <label style={fieldRowStyle}>
      <span style={fieldLabelStyle} title={field.key}>{field.label}</span>
      {field.kind === "color" && (
        <ColorField field={field} rawValue={rawValue} disabled={disabled} onEdit={onEdit} />
      )}
      {field.kind === "number" && (
        <input
          type="number"
          style={inputStyle}
          value={rawValue === undefined ? "" : String(rawValue)}
          placeholder={tokenDefaultPlaceholder(field.key)}
          step={field.step}
          min={field.min}
          max={field.max}
          disabled={disabled}
          onChange={(event) => {
            const text = event.target.value;
            if (text === "") {
              onEdit(field.key, undefined);
              return;
            }
            const parsed = Number.parseFloat(text);
            // 中间态（如 "-"、"1."）不落盘，等用户输完
            if (Number.isFinite(parsed)) onEdit(field.key, parsed);
          }}
        />
      )}
      {field.kind === "checkbox" && (
        <input
          type="checkbox"
          checked={checked ?? true}
          disabled={disabled}
          onChange={(event) => onEdit(field.key, visibleTokenEditValue(event.target.checked))}
        />
      )}
      {field.kind === "font" && (
        <input
          type="text"
          style={inputStyle}
          value={rawValue === undefined ? "" : String(rawValue)}
          placeholder={tokenDefaultPlaceholder(field.key)}
          list={FONT_DATALIST_ID}
          disabled={disabled}
          onChange={(event) => onEdit(field.key, event.target.value === "" ? undefined : event.target.value)}
        />
      )}
      {field.kind === "text" && (
        <input
          type="text"
          style={inputStyle}
          value={rawValue === undefined ? "" : String(rawValue)}
          placeholder={tokenDefaultPlaceholder(field.key)}
          disabled={disabled}
          onChange={(event) => onEdit(field.key, event.target.value === "" ? undefined : event.target.value)}
        />
      )}
    </label>
  );
}

/** 颜色字段：色板（#hex）+ 文本框（任意 CSS 颜色；空 = 清除回退默认）。 */
function ColorField({
  field,
  rawValue,
  disabled,
  onEdit,
}: {
  field: TokenFieldDef;
  rawValue: string | number | undefined;
  disabled: boolean;
  onEdit: (key: string, value: string | number | undefined) => void;
}) {
  const hex = hexColorOrNull(rawValue);
  return (
    <span style={colorRowStyle}>
      <input
        type="color"
        style={colorSwatchStyle}
        // rgba()/渐变等非 hex 值色板无法表达，显示占位黑并以 title 说明
        value={hex ?? "#000000"}
        title={hex ? undefined : "当前值不是纯色（如 rgba/渐变），色板为占位显示；文本框里是真实值"}
        disabled={disabled}
        onChange={(event) => onEdit(field.key, event.target.value)}
      />
      <input
        type="text"
        style={{ ...inputStyle, flex: 1 }}
        value={rawValue === undefined ? "" : String(rawValue)}
        placeholder={tokenDefaultPlaceholder(field.key)}
        disabled={disabled}
        onChange={(event) => onEdit(field.key, event.target.value === "" ? undefined : event.target.value)}
      />
    </span>
  );
}

const panelStyle: React.CSSProperties = {
  padding: "var(--space-3)",
};

const groupStyle: React.CSSProperties = {
  marginBottom: "var(--space-4)",
};

const groupTitleStyle: React.CSSProperties = {
  fontSize: "var(--text-sm)",
  fontWeight: 600,
  color: "var(--text-secondary)",
  marginBottom: "var(--space-2)",
  paddingBottom: "var(--space-1)",
  borderBottom: "1px solid var(--border)",
};

const fieldRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "64px minmax(0, 1fr)",
  alignItems: "center",
  gap: "var(--space-2)",
  marginBottom: "var(--space-2)",
  fontSize: "var(--text-sm)",
};

const fieldLabelStyle: React.CSSProperties = {
  color: "var(--text-secondary)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  padding: "4px 6px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-input)",
  background: "var(--bg-app)",
  color: "var(--text-primary)",
  fontSize: "var(--text-sm)",
};

const colorRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  minWidth: 0,
};

const colorSwatchStyle: React.CSSProperties = {
  width: 28,
  height: 24,
  padding: 0,
  border: "1px solid var(--border-input)",
  borderRadius: "var(--radius-sm)",
  background: "var(--bg-app)",
  flexShrink: 0,
};
