import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteFile, saveFile, saveGraph } from "../../lib/tauri";
import type { ProjectData, ProjectGraph } from "../../lib/types";
import { Breadcrumb } from "./Breadcrumb";
import { GraphCanvas } from "./GraphCanvas";
import { GraphIssuesPanel } from "./GraphIssuesPanel";
import { NodeInspector } from "./NodeInspector";
import { NodeEditor } from "./NodeEditor";
import { NodeOutline } from "./NodeOutline";
import {
  addNode,
  connectNodes,
  defaultPosition,
  generateNodeId,
  moveNode,
  removeEdge,
  removeNode,
  renameNode,
} from "./graphEditing";
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
} satisfies ProjectGraph;

export function ScriptWorkspace({ project, rendererId, refreshKey: _refreshKey, onSaved }: Props) {
  const [view, setView] = useState<ScriptView>("graph");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const incomingGraph = useMemo(() => project.graph ?? EMPTY_GRAPH, [project.graph]);
  const graphReport = useMemo(() => project.graphReport ?? { graphIssues: [] }, [project.graphReport]);
  const [graph, setGraph] = useState<ProjectGraph>(incomingGraph);
  const [savingGraph, setSavingGraph] = useState(false);
  const [graphStatus, setGraphStatus] = useState("");
  const positionSaveTimerRef = useRef<number | null>(null);
  const selectedNode = useMemo(() => findNode(graph, selectedNodeId), [graph, selectedNodeId]);

  useEffect(() => {
    setGraph(incomingGraph);
    setGraphStatus("");
  }, [incomingGraph]);

  useEffect(() => {
    return () => {
      if (positionSaveTimerRef.current != null) {
        window.clearTimeout(positionSaveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!selectedNodeId) return;
    if (findNode(graph, selectedNodeId)) return;
    setSelectedNodeId(null);
    setView("graph");
  }, [graph, selectedNodeId]);

  const persistGraph = useCallback(
    async (next: ProjectGraph) => {
      setGraph(next);
      setSavingGraph(true);
      setGraphStatus("");
      try {
        await saveGraph(project.path, next);
        setGraphStatus("图结构已保存");
        onSaved();
      } catch (error) {
        setGraphStatus(`保存图结构失败: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setSavingGraph(false);
      }
    },
    [onSaved, project.path],
  );

  const schedulePositionSave = useCallback(
    (next: ProjectGraph) => {
      if (positionSaveTimerRef.current != null) {
        window.clearTimeout(positionSaveTimerRef.current);
      }
      positionSaveTimerRef.current = window.setTimeout(() => {
        positionSaveTimerRef.current = null;
        void persistGraph(next);
      }, 400);
    },
    [persistGraph],
  );

  const handleSelect = (id: string) => {
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
  };

  const handleSelectEdge = (id: string) => {
    setSelectedEdgeId(id);
    setSelectedNodeId(null);
  };

  const handleEnter = (id: string) => {
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
    setView("node");
  };

  const handleCreateNode = async () => {
    const id = generateNodeId(graph, "node");
    const file = `nodes/${id}.json`;
    setSavingGraph(true);
    setGraphStatus("");
    try {
      await saveFile(project.path, `content/${file}`, "[]");
      const next = addNode(graph, { id, title: id, file, position: defaultPosition(graph) });
      setSelectedNodeId(id);
      setSelectedEdgeId(null);
      setView("graph");
      await persistGraph(next);
    } catch (error) {
      setGraphStatus(`新建节点失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSavingGraph(false);
    }
  };

  const handleMaterialize = async () => {
    await persistGraph({ ...graph, synthetic: false });
  };

  const handleRenameNode = (id: string, title: string) => {
    const next = renameNode(graph, id, title);
    void persistGraph(next);
  };

  const handleMoveNode = (id: string, position: { x: number; y: number }) => {
    const next = moveNode(graph, id, position);
    setGraph(next);
    schedulePositionSave(next);
  };

  const handleConnect = (from: string, to: string) => {
    const next = connectNodes(graph, from, to);
    if (next === graph) return;
    void persistGraph(next);
  };

  const handleDeleteNode = async (nodeId: string) => {
    const node = findNode(graph, nodeId);
    const label = node?.title ?? nodeId;
    if (!window.confirm(`确定删除节点「${label}」？`)) return;

    const { graph: next, removedFile } = removeNode(graph, nodeId);
    if (next === graph) return;
    setGraph(next);
    if (selectedNodeId === nodeId) {
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setView("graph");
    }
    if (removedFile) {
      try {
        await deleteFile(project.path, removedFile);
      } catch (error) {
        console.warn("删除节点文件失败（图已更新）:", error);
      }
    }
    await persistGraph(next);
  };

  const handleDeleteEdge = (edgeId: string) => {
    const next = removeEdge(graph, edgeId);
    if (next.edges.length === graph.edges.length) return;
    if (selectedEdgeId === edgeId) setSelectedEdgeId(null);
    void persistGraph(next);
  };

  const handleCreateAiTask = async () => {
    if (!selectedNode) return;
    const prompt = [
      "# GalStudio AI Task",
      "",
      "请扩展当前选中的叙事节点，保持节点文件为 Instruction[] JSON 格式。",
      "",
      `- nodeId: ${selectedNode.id}`,
      `- title: ${selectedNode.title}`,
      `- file: content/${selectedNode.file}`,
      `- project: ${project.path}`,
      "",
      "要求：",
      "- 只在 content/ 下写入节点或 graph.json 相关文件。",
      "- 不要使用越界路径。",
      "- 节点内容必须是 packages/engine/src/schema.ts 定义的 t 判别联合指令数组。",
      "- 如需新增节点，同时更新 content/graph.json 的 nodes/edges。",
      "",
    ].join("\n");

    setSavingGraph(true);
    setGraphStatus("");
    try {
      await saveFile(project.path, "content/.gal/ai-task.md", prompt);
      setGraphStatus("AI 占位任务已写入 content/.gal/ai-task.md");
    } catch (error) {
      setGraphStatus(`写入 AI 占位任务失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSavingGraph(false);
    }
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
              <div style={canvasColumnStyle}>
                <div style={toolbarStyle}>
                  <button type="button" onClick={handleCreateNode} disabled={savingGraph} style={primaryButtonStyle}>
                    + 新建节点
                  </button>
                  {graph.synthetic && (
                    <button type="button" onClick={handleMaterialize} disabled={savingGraph} style={secondaryButtonStyle}>
                      固化图结构
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleCreateAiTask}
                    disabled={savingGraph || !selectedNode}
                    title={selectedNode ? "写入 content/.gal/ai-task.md，供外部 AI coding agent 接手" : "先选择一个节点"}
                    style={selectedNode ? secondaryButtonStyle : disabledButtonStyle}
                  >
                    让 AI 扩展此节点
                  </button>
                  <div style={toolbarSpacerStyle} />
                  {graphStatus && (
                    <span
                      style={{
                        ...statusTextStyle,
                        color: graphStatus.includes("失败") ? "#e0a0a0" : "#7ab38a",
                      }}
                    >
                      {graphStatus}
                    </span>
                  )}
                </div>
                <GraphCanvas
                  graph={graph}
                  graphReport={graphReport}
                  nodeEntries={project.nodes}
                  selectedNodeId={selectedNodeId}
                  selectedEdgeId={selectedEdgeId}
                  onSelect={handleSelect}
                  onSelectEdge={handleSelectEdge}
                  onEnter={handleEnter}
                  onMoveNode={handleMoveNode}
                  onConnect={handleConnect}
                  onDeleteNode={handleDeleteNode}
                  onDeleteEdge={handleDeleteEdge}
                />
              </div>
            </div>
            <div style={inspectorPaneStyle}>
              <div style={inspectorStackStyle}>
                <div style={inspectorMainStyle}>
                  <NodeInspector
                    graph={graph}
                    nodeEntries={project.nodes}
                    selectedNodeId={selectedNodeId}
                    onEnter={handleEnter}
                    onRename={handleRenameNode}
                    onMaterialize={handleMaterialize}
                    saving={savingGraph}
                  />
                </div>
                <div style={issuesPanelStyle}>
                  <GraphIssuesPanel
                    issues={graphReport.graphIssues}
                    onSelectNode={(id) => {
                      setView("graph");
                      handleSelect(id);
                    }}
                    onSelectEdge={(id) => {
                      setView("graph");
                      handleSelectEdge(id);
                    }}
                  />
                </div>
              </div>
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

const canvasColumnStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  width: "100%",
  height: "100%",
};

const toolbarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  minHeight: 48,
  padding: "8px 12px",
  borderBottom: "1px solid #232a38",
  background: "#0e1116",
};

const primaryButtonStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #3a6ea5",
  background: "#3a6ea5",
  color: "#fff",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #3a6ea5",
  background: "#1a2431",
  color: "#9fc8e3",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};

const disabledButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  borderColor: "#2a3242",
  background: "#141922",
  color: "#596274",
  cursor: "not-allowed",
};

const toolbarSpacerStyle: React.CSSProperties = {
  flex: 1,
};

const statusTextStyle: React.CSSProperties = {
  fontSize: 12,
};

const inspectorPaneStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  borderLeft: "1px solid #232a38",
};

const inspectorStackStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  width: "100%",
  height: "100%",
  minHeight: 0,
};

const inspectorMainStyle: React.CSSProperties = {
  flex: "1 1 52%",
  minHeight: 0,
  overflow: "hidden",
};

const issuesPanelStyle: React.CSSProperties = {
  flex: "1 1 48%",
  minHeight: 180,
  overflow: "hidden",
};
