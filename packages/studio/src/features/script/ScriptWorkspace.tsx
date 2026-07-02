import { useEffect, useMemo, useState } from "react";
import type { ProjectData } from "../../lib/types";
import { Breadcrumb } from "./Breadcrumb";
import { GraphCanvas } from "./GraphCanvas";
import { NodeInspector } from "./NodeInspector";
import { NodeOutline } from "./NodeOutline";
import { findNode } from "./graphMapping";
import "@xyflow/react/dist/style.css";

interface Props {
  project: ProjectData;
  rendererId: string;
  refreshKey: number;
  onSaved: () => void;
}

type ScriptView = "graph" | "node";

const EMPTY_GRAPH = {
  version: 1,
  entryNodeId: "",
  nodes: [],
  edges: [],
};

export function ScriptWorkspace({ project, rendererId: _rendererId, refreshKey: _refreshKey, onSaved: _onSaved }: Props) {
  const [view, setView] = useState<ScriptView>("graph");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const graph = useMemo(() => project.graph ?? EMPTY_GRAPH, [project.graph]);
  const selectedNode = useMemo(() => findNode(graph, selectedNodeId), [graph, selectedNodeId]);

  useEffect(() => {
    if (!selectedNodeId) return;
    if (findNode(graph, selectedNodeId)) return;
    setSelectedNodeId(null);
    setView("graph");
  }, [graph, selectedNodeId]);

  const handleSelect = (id: string) => {
    setSelectedNodeId(id);
  };

  const handleEnter = (id: string) => {
    setSelectedNodeId(id);
    setView("node");
  };

  return (
    <div style={containerStyle}>
      <Breadcrumb
        view={view}
        selectedNodeTitle={selectedNode?.title ?? null}
        onBackToGraph={() => setView("graph")}
      />
      <div style={contentStyle}>
        {view === "graph" ? (
          <div style={graphLayoutStyle}>
            <div style={outlinePaneStyle}>
              <NodeOutline
                graph={graph}
                nodeEntries={project.nodes}
                selectedNodeId={selectedNodeId}
                onSelect={handleSelect}
              />
            </div>
            <div style={canvasPaneStyle}>
              <GraphCanvas
                graph={graph}
                nodeEntries={project.nodes}
                selectedNodeId={selectedNodeId}
                onSelect={handleSelect}
                onEnter={handleEnter}
              />
            </div>
            <div style={inspectorPaneStyle}>
              <NodeInspector
                graph={graph}
                nodeEntries={project.nodes}
                selectedNodeId={selectedNodeId}
                onEnter={handleEnter}
              />
            </div>
          </div>
        ) : (
          <div style={nodeViewStyle}>
            <div style={nodeViewCardStyle}>
              <div style={nodeViewTitleStyle}>{selectedNode?.title ?? "节点编辑器"}</div>
              <div style={nodeViewMetaStyle}>
                {selectedNode ? selectedNode.file : "未选择节点"}
              </div>
              <div style={nodeViewBodyStyle}>
                节点编辑器 · Phase 4
                {selectedNode && project.nodes?.find((entry) => entry.relPath === selectedNode.file)?.data == null && (
                  <div style={nodeWarningStyle}>当前节点文件缺失，Phase 4 将在此处显示只读提示与编辑入口。</div>
                )}
              </div>
              <button type="button" onClick={() => setView("graph")} style={backButtonStyle}>
                返回流程图
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  width: "100%",
  height: "100%",
  background: "#0b0e14",
};

const contentStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
};

const graphLayoutStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(240px, 280px) minmax(0, 1fr) minmax(280px, 340px)",
  width: "100%",
  height: "100%",
};

const outlinePaneStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
};

const canvasPaneStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
};

const inspectorPaneStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  borderLeft: "1px solid #232a38",
};

const nodeViewStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "100%",
  height: "100%",
  padding: 24,
};

const nodeViewCardStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  width: "min(640px, 100%)",
  padding: 24,
  borderRadius: 8,
  background: "#141922",
  border: "1px solid #232a38",
  color: "#d4dae2",
};

const nodeViewTitleStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 600,
  color: "#e8edf5",
};

const nodeViewMetaStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#7a8290",
  wordBreak: "break-all",
};

const nodeViewBodyStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: "18px 0",
  fontSize: 14,
  color: "#a0a8b4",
};

const nodeWarningStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#e0b676",
};

const backButtonStyle: React.CSSProperties = {
  alignSelf: "flex-start",
  padding: "10px 14px",
  borderRadius: 8,
  background: "#1a1f29",
  border: "1px solid #2a3242",
  color: "#d4dae2",
  cursor: "pointer",
};
