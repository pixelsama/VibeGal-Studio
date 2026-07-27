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
          此项目的界面风格包含可执行代码，当前仍会在 Studio 主窗口中运行。
          只有在你信任项目来源时才继续；界面风格源码变化后会再次询问。
        </p>
        <p style={{ margin: "0 0 var(--space-4)", color: "var(--text-secondary)", wordBreak: "break-all" }}>
          {projectPath}
        </p>
        <Button variant="primary" onClick={onTrust}>信任并运行项目界面风格</Button>
      </div>
    </CenteredMessage>
  );
}
