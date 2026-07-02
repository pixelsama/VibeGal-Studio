import { useState } from "react";
import { ProjectList } from "./features/projects/ProjectList";
import { Workspace } from "./Workspace";
import type { ProjectData } from "./lib/types";
import { selfCheck, selfCheckFull } from "./features/renderers/runtimeCompiler";

export default function App() {
  const [project, setProject] = useState<ProjectData | null>(null);
  const [checking, setChecking] = useState(false);
  const [selfcheckResult, setSelfcheckResult] = useState<string | null>(null);
  const showRuntimeChecks = import.meta.env.DEV;

  const runSelfCheck = async () => {
    setChecking(true);
    try {
      const result = await selfCheck();
      setSelfcheckResult(result);
    } catch (e) {
      setSelfcheckResult("SELFCHECK_EXCEPTION: " + String(e));
    } finally {
      setChecking(false);
    }
  };

  const runFullCheck = async () => {
    setChecking(true);
    try {
      // 用当前打开项目的渲染层验证完整编译链路；无项目时提示
      if (!project) {
        setSelfcheckResult("请先打开一个项目再跑完整自检");
        return;
      }
      const result = await selfCheckFull(project.path, project.meta.activeRendererId);
      setSelfcheckResult(result);
    } catch (e) {
      setSelfcheckResult("SELFCHECK_FULL_EXCEPTION: " + String(e));
    } finally {
      setChecking(false);
    }
  };

  if (!project) {
    return (
      <div style={{ position: "relative", width: "100%", height: "100%" }}>
        <ProjectList onOpen={setProject} />
        {showRuntimeChecks && (
          <div style={{ position: "absolute", top: 12, left: 12, zIndex: 100 }}>
            <button
              onClick={runSelfCheck}
              disabled={checking}
              style={debugBtnStyle("#2a3a2a", "#4a6a4a", "#b0e0b0")}
            >
              {checking ? "自检中…" : "运行时自检"}
            </button>
          </div>
        )}
        {showRuntimeChecks && selfcheckResult && (
          <pre style={selfcheckStyle}>{selfcheckResult}</pre>
        )}
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <Workspace
        project={project}
        onBack={() => setProject(null)}
        onProjectChanged={setProject}
      />
      {showRuntimeChecks && (
        <div style={{ position: "absolute", top: 12, left: 12, zIndex: 200 }}>
          <button
            onClick={runFullCheck}
            disabled={checking}
            style={debugBtnStyle("#2a3a4a", "#4a6a8a", "#a0c0e0")}
          >
            {checking ? "编译中…" : "完整编译自检"}
          </button>
        </div>
      )}
      {showRuntimeChecks && selfcheckResult && <pre style={selfcheckStyle}>{selfcheckResult}</pre>}
    </div>
  );
}

function debugBtnStyle(bg: string, border: string, color: string): React.CSSProperties {
  return {
    padding: "6px 12px", background: bg, border: `1px solid ${border}`,
    borderRadius: 6, color, cursor: "pointer", fontSize: 12,
  };
}

const selfcheckStyle: React.CSSProperties = {
  position: "absolute", bottom: 12, left: 12, zIndex: 200, maxWidth: 520,
  margin: 0, padding: 10, background: "rgba(0,0,0,0.8)", border: "1px solid #333",
  borderRadius: 6, fontSize: 11, lineHeight: 1.5, whiteSpace: "pre-wrap",
  maxHeight: 300, overflow: "auto",
};
