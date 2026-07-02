import { useEffect, useMemo, useState } from "react";
import type { ProjectData } from "../../lib/types";
import { Breadcrumb } from "./Breadcrumb";
import { GraphCanvas } from "./GraphCanvas";
import { NodeInspector } from "./NodeInspector";
import { NodeEditor } from "./NodeEditor";
import { NodeOutline } from "./NodeOutline";
import { findNode, findNodeData } from "./graphMapping";
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

export function ScriptWorkspace({ project, rendererId, refreshKey: _refreshKey, onSaved }: Props) {
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
          selectedNode && (
            <NodeEditor
              key={selectedNode.id}
              project={project}
              rendererId={rendererId}
              node={selectedNode}
              nodeData={findNodeData(project.nodes, selectedNode.file)}
              onSaved={onSaved}
            />
          )
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
