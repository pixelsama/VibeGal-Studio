import { Button } from "../common/Button";
import { CenteredMessage } from "../common/CenteredMessage";
import { useStudioI18n } from "../../lib/i18n";

export function RendererTrustPrompt({ projectPath, onTrust }: {
  projectPath: string;
  onTrust: () => void;
}) {
  const { t } = useStudioI18n();
  return (
    <CenteredMessage>
      <div style={{ maxWidth: 560, textAlign: "center" }}>
        <p style={{ margin: "0 0 var(--space-3)", lineHeight: 1.6 }}>
          {t("rendererTrust.description")}
        </p>
        <p style={{ margin: "0 0 var(--space-4)", color: "var(--text-secondary)", wordBreak: "break-all" }}>
          {projectPath}
        </p>
        <Button variant="primary" onClick={onTrust}>{t("rendererTrust.action")}</Button>
      </div>
    </CenteredMessage>
  );
}
