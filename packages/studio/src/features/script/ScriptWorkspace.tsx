import { ScriptEditor } from "../editor/ScriptEditor";
import { Preview } from "../preview/Preview";
import type { ProjectData } from "../../lib/types";

interface Props {
  project: ProjectData;
  rendererId: string;
  refreshKey: number;
  onSaved: () => void;
}

export function ScriptWorkspace({ project, rendererId, refreshKey, onSaved }: Props) {
  return (
    <div style={containerStyle}>
      <div style={editorPaneStyle}>
        <ScriptEditor project={project} onSaved={onSaved} />
      </div>
      <div style={previewPaneStyle}>
        <Preview key={`${rendererId}-${refreshKey}`} project={project} rendererId={rendererId} />
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(440px, 1.1fr) minmax(360px, 0.9fr)",
  width: "100%",
  height: "100%",
  background: "#0b0e14",
};

const editorPaneStyle: React.CSSProperties = {
  minWidth: 0,
  borderRight: "1px solid #232a38",
  overflow: "hidden",
};

const previewPaneStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
};
