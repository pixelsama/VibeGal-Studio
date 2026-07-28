import { useStudioI18n, type StudioMessageKey } from "../../lib/i18n";
import { APPEARANCE_PRESETS, type AppearancePreset } from "./appearanceTokens";

const PRESET_MESSAGE_KEYS: Record<
  AppearancePreset["id"],
  { name: StudioMessageKey; description: StudioMessageKey }
> = {
  "soft-glow": {
    name: "appearance.preset.softGlow.name",
    description: "appearance.preset.softGlow.description",
  },
  nightfall: {
    name: "appearance.preset.nightfall.name",
    description: "appearance.preset.nightfall.description",
  },
  paper: {
    name: "appearance.preset.paper.name",
    description: "appearance.preset.paper.description",
  },
  neon: {
    name: "appearance.preset.neon.name",
    description: "appearance.preset.neon.description",
  },
};

export function AppearancePresetPicker({
  disabled,
  canResetAll,
  onApply,
  onResetAll,
}: {
  disabled: boolean;
  canResetAll: boolean;
  onApply: (preset: AppearancePreset) => void;
  onResetAll: () => void;
}) {
  const { t } = useStudioI18n();

  return (
    <section aria-label={t("appearance.presets.title")} style={sectionStyle}>
      <div style={headerStyle}>
        <div>
          <h2 style={titleStyle}>{t("appearance.presets.title")}</h2>
          <p style={descriptionStyle}>{t("appearance.presets.description")}</p>
        </div>
        <button type="button" style={resetStyle} disabled={disabled || !canResetAll} onClick={onResetAll}>
          {t("appearance.presets.resetAll")}
        </button>
      </div>
      <div style={gridStyle}>
        {APPEARANCE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            data-appearance-preset={preset.id}
            disabled={disabled}
            onClick={() => onApply(preset)}
            style={cardStyle(preset)}
          >
            <span aria-hidden="true" style={swatchesStyle}>
              <span style={{ ...swatchStyle, background: preset.tokens["dialogueBox.bgColor"] }} />
              <span style={{ ...swatchStyle, background: preset.tokens["choiceButton.hoverColor"] }} />
              <span style={{ ...swatchStyle, background: preset.tokens["titleScreen.titleColor"] }} />
            </span>
            <strong style={nameStyle}>{t(PRESET_MESSAGE_KEYS[preset.id].name)}</strong>
            <span style={copyStyle}>{t(PRESET_MESSAGE_KEYS[preset.id].description)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function cardStyle(preset: AppearancePreset): React.CSSProperties {
  return {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    gridTemplateRows: "auto auto",
    columnGap: "var(--space-2)",
    rowGap: 3,
    padding: "var(--space-2)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    background: "var(--bg-inset)",
    color: "var(--text-primary)",
    textAlign: "left",
    cursor: "pointer",
    boxShadow: `inset 0 2px 0 ${String(preset.tokens["choiceButton.hoverColor"])}`,
  };
}

const sectionStyle: React.CSSProperties = {
  padding: "var(--space-3)",
  borderBottom: "1px solid var(--border)",
};
const headerStyle: React.CSSProperties = { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--space-2)", marginBottom: "var(--space-2)" };
const titleStyle: React.CSSProperties = { margin: 0, color: "var(--text-primary)", fontSize: "var(--text-sm)", fontWeight: 650 };
const descriptionStyle: React.CSSProperties = { margin: "4px 0 0", color: "var(--text-muted)", fontSize: "var(--text-xs)", lineHeight: 1.4 };
const resetStyle: React.CSSProperties = { flex: "0 0 auto", padding: "4px var(--space-2)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-pill)", background: "transparent", color: "var(--text-secondary)", fontSize: "var(--text-xs)", cursor: "pointer" };
const gridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "var(--space-2)" };
const swatchesStyle: React.CSSProperties = { gridRow: "1 / span 2", display: "flex", alignItems: "center", alignSelf: "stretch", gap: 3 };
const swatchStyle: React.CSSProperties = { width: 8, height: "100%", minHeight: 40, border: "1px solid rgba(255, 255, 255, 0.2)", borderRadius: 999 };
const nameStyle: React.CSSProperties = { overflow: "hidden", color: "var(--text-primary)", fontSize: "var(--text-sm)", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const copyStyle: React.CSSProperties = { display: "-webkit-box", overflow: "hidden", color: "var(--text-muted)", fontSize: "var(--text-xs)", lineHeight: 1.35, WebkitBoxOrient: "vertical", WebkitLineClamp: 2 };
