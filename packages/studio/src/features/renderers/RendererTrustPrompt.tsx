import { Button } from "../common/Button";
import { CenteredMessage } from "../common/CenteredMessage";

export function RendererTrustPrompt({ projectPath, onTrust }: {
  projectPath: string;
  onTrust: () => void;
}) {
  return (
    <CenteredMessage>
      <div style={{ maxWidth: 560, textAlign: "center" }}>
        <p style={{ margin: "0 0 var(--space-3)", lineHeight: 1.6 }}>
          此项目的 renderer 是可执行代码，当前仍会在 Studio 主 WebView 中运行。
          只有在你信任项目来源时才继续。
        </p>
        <p style={{ margin: "0 0 var(--space-4)", color: "var(--text-secondary)", wordBreak: "break-all" }}>
          {projectPath}
        </p>
        <Button variant="primary" onClick={onTrust}>信任并运行项目 renderer</Button>
      </div>
    </CenteredMessage>
  );
}
