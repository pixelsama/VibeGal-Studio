import { Check, Circle, X } from "lucide-react";
import { useStudioI18n, type StudioMessageKey, type StudioTranslator } from "../../lib/i18n";

interface BlankProjectGuideProps {
  written: boolean;
  backgroundImported: boolean;
  previewConfirmed: boolean;
  onWrite: () => void;
  onImportBackground: () => void;
  onPreview: () => void;
  onSkip: () => void;
}

export function BlankProjectGuide({
  written,
  backgroundImported,
  previewConfirmed,
  onWrite,
  onImportBackground,
  onPreview,
  onSkip,
}: BlankProjectGuideProps) {
  const { t } = useStudioI18n();
  return (
    <aside aria-label={t("onboarding.ariaLabel")} style={panelStyle}>
      <div style={headerStyle}>
        <div>
          <div style={eyebrowStyle}>{t("onboarding.eyebrow")}</div>
          <div style={titleStyle}>{t("onboarding.title")}</div>
        </div>
        <button type="button" aria-label={t("onboarding.skipGuide")} title={t("onboarding.skip")} onClick={onSkip} style={closeButtonStyle}>
          <X size={16} />
        </button>
      </div>
      <div style={stepListStyle}>
        <GuideStep
          done={written}
          titleKey="onboarding.write.title"
          descriptionKey="onboarding.write.description"
          actionKey="onboarding.write.action"
          t={t}
          onClick={onWrite}
        />
        <GuideStep
          done={backgroundImported}
          titleKey="onboarding.background.title"
          descriptionKey="onboarding.background.description"
          actionKey="onboarding.background.action"
          t={t}
          onClick={onImportBackground}
        />
        <GuideStep
          done={previewConfirmed}
          titleKey="onboarding.preview.title"
          descriptionKey="onboarding.preview.description"
          actionKey="onboarding.preview.action"
          t={t}
          onClick={onPreview}
        />
      </div>
      <button type="button" onClick={onSkip} style={skipButtonStyle}>{t("onboarding.skip")}</button>
    </aside>
  );
}

function GuideStep({
  done,
  titleKey,
  descriptionKey,
  actionKey,
  onClick,
  t,
}: {
  done: boolean;
  titleKey: StudioMessageKey;
  descriptionKey: StudioMessageKey;
  actionKey: StudioMessageKey;
  onClick: () => void;
  t: StudioTranslator;
}) {
  const StatusIcon = done ? Check : Circle;
  const action = t(actionKey);
  return (
    <div style={stepStyle}>
      <StatusIcon size={17} style={{ color: done ? "var(--status-ok)" : "var(--text-muted)", marginTop: 2, flexShrink: 0 }} />
      <div style={stepContentStyle}>
        <div style={stepTitleStyle}>{t(titleKey)}</div>
        <div style={stepDescriptionStyle}>{t(descriptionKey)}</div>
        <button type="button" className="gs-btn gs-btn--primary" onClick={onClick} style={stepButtonStyle}>
          {done ? t("onboarding.again", { action }) : action}
        </button>
      </div>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  position: "absolute",
  zIndex: 20,
  top: 52,
  right: 16,
  width: 330,
  padding: "var(--space-4)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-lg)",
  background: "var(--bg-panel)",
  boxShadow: "0 16px 40px rgba(0, 0, 0, 0.32)",
};
const headerStyle: React.CSSProperties = { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--space-3)" };
const eyebrowStyle: React.CSSProperties = { color: "var(--accent-bright)", fontSize: "var(--text-xs)", fontWeight: 700 };
const titleStyle: React.CSSProperties = { marginTop: 3, color: "var(--text-bright)", fontSize: "var(--text-lg)", fontWeight: 700 };
const closeButtonStyle: React.CSSProperties = { width: 28, height: 28, display: "grid", placeItems: "center", border: 0, borderRadius: "var(--radius-sm)", background: "transparent", color: "var(--text-muted)", cursor: "pointer" };
const stepListStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: "var(--space-3)", marginTop: "var(--space-4)" };
const stepStyle: React.CSSProperties = { display: "flex", alignItems: "flex-start", gap: "var(--space-2)" };
const stepContentStyle: React.CSSProperties = { minWidth: 0, flex: 1 };
const stepTitleStyle: React.CSSProperties = { color: "var(--text-primary)", fontWeight: 650 };
const stepDescriptionStyle: React.CSSProperties = { marginTop: 2, color: "var(--text-muted)", fontSize: "var(--text-sm)", lineHeight: 1.45 };
const stepButtonStyle: React.CSSProperties = { marginTop: "var(--space-2)", fontSize: "var(--text-sm)" };
const skipButtonStyle: React.CSSProperties = { marginTop: "var(--space-4)", padding: 0, border: 0, background: "transparent", color: "var(--text-muted)", fontSize: "var(--text-sm)", cursor: "pointer" };
