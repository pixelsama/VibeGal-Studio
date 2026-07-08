/**
 * 预览面板 —— 用引擎跑项目，挂载当前选中的渲染层。
 */
import type { ProjectData } from "../../lib/types";
import { RuntimeStateInspector } from "./RuntimeStateInspector";
import { useProjectPlayer } from "./useProjectPlayer";
import { useRendererComponent } from "./useRendererComponent";
import { StageFrame } from "./StageFrame";

interface Props {
  project: ProjectData;
  rendererId: string;
}

export function Preview({ project, rendererId }: Props) {
  const player = useProjectPlayer(project);
  const { renderer, loadError } = useRendererComponent(project.path, rendererId);

  if (player.error) {
    return <Centered mono>{`引擎错误：\n\n${player.error}`}</Centered>;
  }
  if (loadError) {
    return <Centered mono>{`渲染层加载失败（${rendererId}）：\n\n${loadError}\n\n请确认项目 renderers/${rendererId}/index.tsx 存在，且渲染层源码没有未支持的 import。`}</Centered>;
  }
  if (!renderer) {
    return <Centered>加载渲染层中…</Centered>;
  }

  const Renderer = renderer.Component;
  return (
    <div style={layoutStyle}>
      <div style={stagePaneStyle}>
        <StageFrame stage={player.rendererProps.stage}>
          <Renderer {...player.rendererProps} />
        </StageFrame>
      </div>
      <RuntimeStateInspector state={player.state} />
    </div>
  );
}

function Centered({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <div style={{
      width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
      color: "var(--text-primary)", fontFamily: mono ? "ui-monospace, monospace" : "inherit",
      whiteSpace: "pre-wrap", textAlign: "center", padding: "var(--space-8)", lineHeight: 1.8, fontSize: "var(--text-md)",
    }}>
      {children}
    </div>
  );
}

const layoutStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(260px, 320px)",
  width: "100%",
  height: "100%",
};

const stagePaneStyle: React.CSSProperties = {
  minWidth: 0,
  height: "100%",
};
