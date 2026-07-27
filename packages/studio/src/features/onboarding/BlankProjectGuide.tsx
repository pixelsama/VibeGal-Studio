import { Check, Circle, X } from "lucide-react";

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
  return (
    <aside aria-label="新项目三步引导" style={panelStyle}>
      <div style={headerStyle}>
        <div>
          <div style={eyebrowStyle}>开始创作</div>
          <div style={titleStyle}>用三步跑通第一个片段</div>
        </div>
        <button type="button" aria-label="跳过新项目引导" title="暂时跳过" onClick={onSkip} style={closeButtonStyle}>
          <X size={16} />
        </button>
      </div>
      <div style={stepListStyle}>
        <GuideStep
          done={written}
          title="写第一个节点"
          description="把起始节点的示例句改成你的故事。"
          action="打开起始节点"
          onClick={onWrite}
        />
        <GuideStep
          done={backgroundImported}
          title="导入一张背景"
          description="登记第一张场景背景，之后可直接在剧本中选择。"
          action="导入背景"
          onClick={onImportBackground}
        />
        <GuideStep
          done={previewConfirmed}
          title="试演"
          description="进入预览，确认这段故事可以运行。"
          action="开始试演"
          onClick={onPreview}
        />
      </div>
      <button type="button" onClick={onSkip} style={skipButtonStyle}>暂时跳过</button>
    </aside>
  );
}

function GuideStep({
  done,
  title,
  description,
  action,
  onClick,
}: {
  done: boolean;
  title: string;
  description: string;
  action: string;
  onClick: () => void;
}) {
  const StatusIcon = done ? Check : Circle;
  return (
    <div style={stepStyle}>
      <StatusIcon size={17} style={{ color: done ? "var(--status-ok)" : "var(--text-muted)", marginTop: 2, flexShrink: 0 }} />
      <div style={stepContentStyle}>
        <div style={stepTitleStyle}>{title}</div>
        <div style={stepDescriptionStyle}>{description}</div>
        <button type="button" className="gs-btn gs-btn--primary" onClick={onClick} style={stepButtonStyle}>
          {done ? `再次${action}` : action}
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
