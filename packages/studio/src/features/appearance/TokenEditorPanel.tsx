/**
 * TokenEditorPanel —— 当前部件的高频外观属性与折叠高级参数。
 *
 * raw token 留在项目里；未覆盖字段显示 renderer 公开默认值。每个已偏离默认的
 * 字段都可以独立恢复，不触碰同 skin 的其它值。
 */
import { useStudioI18n, type StudioTranslator } from "../../lib/i18n";
import {
  APPEARANCE_TOKEN_GROUPS,
  effectiveTokenValue,
  hexColorOrNull,
  localizedTokenDefaultPlaceholder,
  tokenHasOverride,
  tokenVisibleChecked,
  visibleTokenEditValue,
  type RendererAppearanceDefaults,
  type TokenFieldDef,
  type TokenGroupDef,
} from "./appearanceTokens";

interface TokenEditorPanelProps {
  tokens: Record<string, string | number>;
  defaults?: RendererAppearanceDefaults;
  fontFamilies: string[];
  disabled?: boolean;
  groups?: TokenGroupDef[];
  onEdit: (key: string, value: string | number | undefined) => void;
}

const FONT_DATALIST_ID = "appearance-font-family-options";
const GEOMETRY_FIELDS = new Set(["x", "y", "width", "height"]);

export function TokenEditorPanel({
  tokens,
  defaults,
  fontFamilies,
  disabled = false,
  groups = APPEARANCE_TOKEN_GROUPS,
  onEdit,
}: TokenEditorPanelProps) {
  const { t } = useStudioI18n();

  return (
    <div style={panelStyle}>
      <datalist id={FONT_DATALIST_ID}>
        {fontFamilies.map((family) => (
          <option key={family} value={family} />
        ))}
      </datalist>
      {groups.map((group) => {
        const primary = group.fields.filter((field) => !isAdvancedField(field));
        const advanced = group.fields.filter(isAdvancedField);
        return (
          <section key={group.id} style={groupStyle} aria-label={group.title}>
            <div style={groupTitleStyle}>{group.title}</div>
            {primary.map((field) => (
              <TokenField
                key={field.key}
                field={field}
                rawValue={tokens[field.key]}
                effectiveValue={effectiveTokenValue(tokens, field.key, defaults)}
                checked={field.kind === "checkbox" ? tokenVisibleChecked(tokens, field.key) : undefined}
                canReset={tokenHasOverride(tokens, field.key, defaults)}
                disabled={disabled}
                defaults={defaults}
                onEdit={onEdit}
                t={t}
              />
            ))}
            {advanced.length > 0 && (
              <details style={advancedStyle}>
                <summary style={advancedSummaryStyle}>{t("appearance.tokens.advanced")}</summary>
                <div style={advancedFieldsStyle}>
                  {advanced.map((field) => (
                    <TokenField
                      key={field.key}
                      field={field}
                      rawValue={tokens[field.key]}
                      effectiveValue={effectiveTokenValue(tokens, field.key, defaults)}
                      checked={field.kind === "checkbox" ? tokenVisibleChecked(tokens, field.key) : undefined}
                      canReset={tokenHasOverride(tokens, field.key, defaults)}
                      disabled={disabled}
                      defaults={defaults}
                      onEdit={onEdit}
                      t={t}
                    />
                  ))}
                </div>
              </details>
            )}
          </section>
        );
      })}
    </div>
  );
}

function TokenField({
  field,
  rawValue,
  effectiveValue,
  checked,
  canReset,
  disabled,
  defaults,
  onEdit,
  t,
}: {
  field: TokenFieldDef;
  rawValue: string | number | undefined;
  effectiveValue: string | number | undefined;
  checked?: boolean;
  canReset: boolean;
  disabled: boolean;
  defaults: RendererAppearanceDefaults | undefined;
  onEdit: (key: string, value: string | number | undefined) => void;
  t: StudioTranslator;
}) {
  return (
    <div style={fieldRowStyle}>
      <span style={fieldLabelStyle} title={field.key}>{field.label}</span>
      <div style={fieldControlStyle}>
        {field.kind === "color" && (
          <ColorField
            field={field}
            rawValue={rawValue}
            effectiveValue={effectiveValue}
            disabled={disabled}
            defaults={defaults}
            onEdit={onEdit}
            t={t}
          />
        )}
        {field.kind === "number" && (
          <input
            aria-label={field.label}
            type="number"
            style={inputStyle}
            value={rawValue === undefined ? "" : String(rawValue)}
            placeholder={localizedTokenDefaultPlaceholder(field.key, defaults, t)}
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
              if (Number.isFinite(parsed)) onEdit(field.key, parsed);
            }}
          />
        )}
        {field.kind === "checkbox" && (
          <input
            aria-label={field.label}
            type="checkbox"
            checked={checked ?? true}
            disabled={disabled}
            onChange={(event) => onEdit(field.key, visibleTokenEditValue(event.target.checked))}
          />
        )}
        {field.kind === "font" && (
          <input
            aria-label={field.label}
            type="text"
            style={inputStyle}
            value={rawValue === undefined ? "" : String(rawValue)}
            placeholder={localizedTokenDefaultPlaceholder(field.key, defaults, t)}
            list={FONT_DATALIST_ID}
            disabled={disabled}
            onChange={(event) => onEdit(field.key, event.target.value === "" ? undefined : event.target.value)}
          />
        )}
        {field.kind === "text" && (
          <input
            aria-label={field.label}
            type="text"
            style={inputStyle}
            value={rawValue === undefined ? "" : String(rawValue)}
            placeholder={localizedTokenDefaultPlaceholder(field.key, defaults, t)}
            disabled={disabled}
            onChange={(event) => onEdit(field.key, event.target.value === "" ? undefined : event.target.value)}
          />
        )}
        <button
          type="button"
          data-reset-token={field.key}
          title={t("appearance.tokens.resetTitle", { label: field.label })}
          style={resetStyle}
          disabled={disabled || !canReset}
          onClick={() => onEdit(field.key, undefined)}
        >
          {t("appearance.tokens.reset")}
        </button>
      </div>
    </div>
  );
}

function ColorField({
  field,
  rawValue,
  effectiveValue,
  disabled,
  defaults,
  onEdit,
  t,
}: {
  field: TokenFieldDef;
  rawValue: string | number | undefined;
  effectiveValue: string | number | undefined;
  disabled: boolean;
  defaults: RendererAppearanceDefaults | undefined;
  onEdit: (key: string, value: string | number | undefined) => void;
  t: StudioTranslator;
}) {
  const effectiveHex = hexColorOrNull(effectiveValue);
  return (
    <span style={colorRowStyle}>
      <span
        aria-label={t("appearance.tokens.currentColor", { label: field.label })}
        title={effectiveValue === undefined
          ? t("appearance.tokens.defaultUnavailable")
          : String(effectiveValue)}
        style={{
          ...colorPreviewStyle,
          background: effectiveValue === undefined ? "transparent" : String(effectiveValue),
        }}
      />
      {effectiveHex && (
        <input
          aria-label={t("appearance.tokens.colorPicker", { label: field.label })}
          type="color"
          style={colorSwatchStyle}
          value={effectiveHex}
          disabled={disabled}
          onChange={(event) => onEdit(field.key, event.target.value)}
        />
      )}
      <input
        aria-label={field.label}
        type="text"
        style={{ ...inputStyle, flex: 1 }}
        value={rawValue === undefined ? "" : String(rawValue)}
        placeholder={localizedTokenDefaultPlaceholder(field.key, defaults, t)}
        disabled={disabled}
        onChange={(event) => onEdit(field.key, event.target.value === "" ? undefined : event.target.value)}
      />
    </span>
  );
}

function isAdvancedField(field: TokenFieldDef): boolean {
  return GEOMETRY_FIELDS.has(field.key.split(".").at(-1) ?? "");
}

const panelStyle: React.CSSProperties = { padding: "var(--space-3)" };
const groupStyle: React.CSSProperties = { marginBottom: "var(--space-4)" };
const groupTitleStyle: React.CSSProperties = { marginBottom: "var(--space-2)", paddingBottom: "var(--space-1)", borderBottom: "1px solid var(--border)", color: "var(--text-primary)", fontSize: "var(--text-sm)", fontWeight: 650 };
const fieldRowStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "72px minmax(0, 1fr)", alignItems: "start", gap: "var(--space-2)", marginBottom: "var(--space-2)", fontSize: "var(--text-sm)" };
const fieldLabelStyle: React.CSSProperties = { paddingTop: 5, overflow: "hidden", color: "var(--text-primary)", fontWeight: 550, textOverflow: "ellipsis", whiteSpace: "nowrap" };
const fieldControlStyle: React.CSSProperties = { minWidth: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", gap: "var(--space-1)" };
const inputStyle: React.CSSProperties = { width: "100%", minWidth: 0, padding: "4px 6px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-input)", background: "var(--bg-app)", color: "var(--text-primary)", fontSize: "var(--text-sm)" };
const resetStyle: React.CSSProperties = { minHeight: 26, padding: "3px 7px", border: "1px solid var(--border)", borderRadius: "var(--radius-pill)", background: "transparent", color: "var(--text-secondary)", fontSize: "var(--text-xs)", whiteSpace: "nowrap", cursor: "pointer" };
const colorRowStyle: React.CSSProperties = { minWidth: 0, display: "flex", alignItems: "center", gap: "var(--space-1)" };
const colorPreviewStyle: React.CSSProperties = { width: 28, height: 24, flex: "0 0 28px", border: "1px solid var(--border-input)", borderRadius: "var(--radius-sm)", backgroundImage: "linear-gradient(45deg, #bbb 25%, transparent 25%), linear-gradient(-45deg, #bbb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #bbb 75%), linear-gradient(-45deg, transparent 75%, #bbb 75%)", backgroundPosition: "0 0, 0 6px, 6px -6px, -6px 0", backgroundSize: "12px 12px" };
const colorSwatchStyle: React.CSSProperties = { width: 28, height: 24, padding: 0, border: "1px solid var(--border-input)", borderRadius: "var(--radius-sm)", background: "var(--bg-app)", flexShrink: 0 };
const advancedStyle: React.CSSProperties = { marginTop: "var(--space-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", background: "var(--bg-inset)" };
const advancedSummaryStyle: React.CSSProperties = { padding: "var(--space-2)", color: "var(--text-secondary)", fontSize: "var(--text-xs)", fontWeight: 600, cursor: "pointer" };
const advancedFieldsStyle: React.CSSProperties = { padding: "0 var(--space-2) var(--space-2)" };
