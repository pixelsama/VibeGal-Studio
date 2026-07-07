import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { deleteFile, saveFile, saveGraph, saveGraphPositions } from "../../lib/tauri";
import type { GraphIssueFocusRequest, GraphPositionPatch, ProjectData, ProjectGraph } from "../../lib/types";
import { CollapsibleSidebar } from "../common/CollapsibleSidebar";
import { Breadcrumb } from "./Breadcrumb";
import { GraphCanvas } from "./GraphCanvas";
import { NodeInspector } from "./NodeInspector";
import { NodeEditor } from "./NodeEditor";
import { NodeOutline } from "./NodeOutline";
import { ConfirmDialog, PromptDialog } from "../common/Dialogs";
import {
  addNode,
  connectNodes,
  createSuccessor,
  defaultPosition,
  duplicateNode,
  generateNodeId,
  moveNode,
  removeEdge,
  removeNodes,
  renameNode,
  replaceNodeOutgoingEdges,
  setEntryNode,
} from "./graphEditing";
import { findNode, findNodeData } from "./graphMapping";
import { autoLayoutGraph } from "./graphLayout";
import "@xyflow/react/dist/style.css";

interface Props {
  project: ProjectData;
  rendererId: string;
  refreshKey: number;
  outlineCollapsed: boolean;
  onOutlineCollapsedChange: (collapsed: boolean) => void;
  location: ScriptWorkspaceLocation;
  focusRequest?: GraphIssueFocusRequest | null;
  onOpenGraph: () => void;
  onOpenNode: (nodeId: string) => void;
  onReplaceWithGraph: () => void;
  onSaved: () => void;
}

export type ScriptWorkspaceLocation =
  | { view: "graph" }
  | { view: "node"; nodeId: string };

const EMPTY_GRAPH = {
  version: 1,
  entryNodeId: "",
  nodes: [],
  edges: [],
} satisfies ProjectGraph;

export function buildGraphPositionUpdates(before: ProjectGraph, after: ProjectGraph): GraphPositionPatch[] {
  const beforeById = new Map(before.nodes.map((node) => [node.id, node.position]));
  return after.nodes
    .filter((node) => {
      const previous = beforeById.get(node.id);
      return previous && (previous.x !== node.position.x || previous.y !== node.position.y);
    })
    .map((node) => ({ id: node.id, position: node.position }));
}

export function ScriptWorkspace({
  project,
  rendererId,
  refreshKey: _refreshKey,
  outlineCollapsed,
  onOutlineCollapsedChange,
  location,
  focusRequest,
  onOpenGraph,
  onOpenNode,
  onReplaceWithGraph,
  onSaved,
}: Props) {
  const view = location.view;
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const incomingGraph = useMemo(() => project.graph ?? EMPTY_GRAPH, [project.graph]);
  const graphReport = useMemo(() => project.graphReport ?? { graphIssues: [] }, [project.graphReport]);
  const [graph, setGraph] = useState<ProjectGraph>(incomingGraph);
  const [savingGraph, setSavingGraph] = useState(false);
  const [graphStatus, setGraphStatus] = useState("");
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [prompt, setPrompt] = useState<{ title: string; label?: string; initialValue?: string; onConfirm: (v: string) => void } | null>(null);
  const positionSaveTimerRef = useRef<number | null>(null);
  const pendingPositionUpdatesRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const activeNodeId = location.view === "node" ? location.nodeId : selectedNodeId;
  const selectedNode = useMemo(() => findNode(graph, activeNodeId), [activeNodeId, graph]);

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
    if (location.view === "node") {
      if (findNode(graph, location.nodeId)) {
        setSelectedNodeId(location.nodeId);
        return;
      }
      setSelectedNodeId(null);
      onReplaceWithGraph();
      return;
    }

    if (!selectedNodeId) return;
    if (findNode(graph, selectedNodeId)) return;
    setSelectedNodeId(null);
  }, [graph, location, onReplaceWithGraph, selectedNodeId]);

  useEffect(() => {
    if (!focusRequest) return;
    if (focusRequest.nodeId && findNode(graph, focusRequest.nodeId)) {
      setSelectedNodeId(focusRequest.nodeId);
      setSelectedEdgeId(null);
      return;
    }
    if (focusRequest.edgeId && graph.edges.some((edge) => edge.id === focusRequest.edgeId)) {
      setSelectedNodeId(graph.edges.find((edge) => edge.id === focusRequest.edgeId)?.from ?? null);
      setSelectedEdgeId(focusRequest.edgeId);
    }
  }, [focusRequest, graph]);

  const persistGraph = useCallback(
    async (next: ProjectGraph) => {
      setGraph(next);
      setSavingGraph(true);
      setGraphStatus("");
      try {
        await saveGraph(project.path, next, project.graphRevision);
        setGraphStatus("图结构已保存");
        onSaved();
        return true;
      } catch (error) {
        setGraphStatus(`保存图结构失败: ${error instanceof Error ? error.message : String(error)}`);
        return false;
      } finally {
        setSavingGraph(false);
      }
    },
    [onSaved, project.graphRevision, project.path],
  );

  const persistGraphPositions = useCallback(
    async (updates: GraphPositionPatch[]) => {
      if (updates.length === 0) return;
      setSavingGraph(true);
      setGraphStatus("");
      try {
        await saveGraphPositions(project.path, updates, project.graphRevision);
        setGraphStatus("节点位置已保存");
        onSaved();
      } catch (error) {
        setGraphStatus(`保存节点位置失败: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setSavingGraph(false);
      }
    },
    [onSaved, project.graphRevision, project.path],
  );

  const schedulePositionSave = useCallback(
    (updates: GraphPositionPatch[]) => {
      for (const update of updates) {
        pendingPositionUpdatesRef.current.set(update.id, update.position);
      }
      if (positionSaveTimerRef.current != null) {
        window.clearTimeout(positionSaveTimerRef.current);
      }
      positionSaveTimerRef.current = window.setTimeout(() => {
        positionSaveTimerRef.current = null;
        const pending = Array.from(pendingPositionUpdatesRef.current, ([id, position]) => ({ id, position }));
        pendingPositionUpdatesRef.current.clear();
        void persistGraphPositions(pending);
      }, 400);
    },
    [persistGraphPositions],
  );

  const handleSelect = (id: string) => {
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
  };

  const handleSelectEdge = (id: string) => {
    setSelectedEdgeId(id);
    setSelectedNodeId(graph.edges.find((edge) => edge.id === id)?.from ?? null);
  };

  const handleEnter = (id: string) => {
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
    onOpenNode(id);
  };

  const handleCreateNode = async (position?: { x: number; y: number }) => {
    const id = generateNodeId(graph, "node");
    const file = `nodes/${id}.json`;
    setSavingGraph(true);
    setGraphStatus("");
    try {
      await saveFile(project.path, `content/${file}`, "[]");
      const next = addNode(graph, { id, title: id, file, position: position ?? defaultPosition(graph) });
      setSelectedNodeId(id);
      setSelectedEdgeId(null);
      onOpenGraph();
      await persistGraph(next);
    } catch (error) {
      setGraphStatus(`新建节点失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSavingGraph(false);
    }
  };

  const handleRenameNode = (id: string, title: string) => {
    const next = renameNode(graph, id, title);
    void persistGraph(next);
  };

  const handleMoveNode = (id: string, position: { x: number; y: number }) => {
    const next = moveNode(graph, id, position);
    const updates = buildGraphPositionUpdates(graph, next);
    if (updates.length === 0) return;
    setGraph(next);
    schedulePositionSave(updates);
  };

  const handleConnect = (from: string, to: string) => {
    const next = connectNodes(graph, from, to);
    if (next === graph) return;
    void persistGraph(next);
  };

  const handleDeleteNodes = (nodeIds: string[]) => {
    const uniqueIds = Array.from(new Set(nodeIds));
    const nodes = uniqueIds.map((id) => findNode(graph, id)).filter((node) => node != null);
    if (nodes.length === 0) return;

    const label =
      nodes.length === 1
        ? `节点「${nodes[0].title}」`
        : `${nodes.length} 个节点`;
    setConfirm({
      message: `确定删除${label}？节点文件也会被删除。`,
      onConfirm: () => void performDeleteNodes(uniqueIds),
    });
  };

  const performDeleteNodes = async (uniqueIds: string[]) => {
    const { graph: next, removedFiles } = removeNodes(graph, uniqueIds);
    if (next === graph) return;
    setGraph(next);
    if (selectedNodeId && uniqueIds.includes(selectedNodeId)) {
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      onReplaceWithGraph();
    }

    const saved = await persistGraph(next);
    if (!saved) return;

    for (const removedFile of removedFiles) {
      try {
        await deleteFile(project.path, removedFile, project.nodeRevisions?.[removedFile]);
      } catch (error) {
        console.warn("删除节点文件失败（图已更新）:", error);
      }
    }
  };

  const handleDeleteEdge = (edgeId: string) => {
    const next = removeEdge(graph, edgeId);
    if (next.edges.length === graph.edges.length) return;
    if (selectedEdgeId === edgeId) setSelectedEdgeId(null);
    void persistGraph(next);
  };

  const handleUpdateOutgoingEdges = (nodeId: string, edges: ProjectGraph["edges"]) => {
    const next = replaceNodeOutgoingEdges(graph, nodeId, edges);
    void persistGraph(next);
  };

  // Phase 7：复制节点 —— 复制图结构 + 复制源节点文件内容到新文件
  const handleDuplicateNode = async (nodeId: string) => {
    const source = findNode(graph, nodeId);
    if (!source) return;
    const { graph: next, newNode } = duplicateNode(graph, nodeId);
    if (!newNode) return;

    setSavingGraph(true);
    setGraphStatus("");
    try {
      const sourceData = findNodeData(project.nodes, source.file);
      const content = sourceData == null ? "[]" : JSON.stringify(sourceData, null, 2);
      await saveFile(project.path, `content/${newNode.file}`, content);
      setSelectedNodeId(newNode.id);
      setSelectedEdgeId(null);
      await persistGraph(next);
    } catch (error) {
      setGraphStatus(`复制节点失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSavingGraph(false);
    }
  };

  // Phase 7：创建后续节点 —— 建空文件 + 连边
  const handleCreateSuccessor = async (nodeId: string) => {
    const { graph: next, newNode } = createSuccessor(graph, nodeId);
    if (!newNode) return;

    setSavingGraph(true);
    setGraphStatus("");
    try {
      await saveFile(project.path, `content/${newNode.file}`, "[]");
      setSelectedNodeId(newNode.id);
      setSelectedEdgeId(null);
      await persistGraph(next);
    } catch (error) {
      setGraphStatus(`创建后续节点失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSavingGraph(false);
    }
  };

  // Phase 7：重命名（走 PromptDialog）
  const handleRenameNodeDialog = (nodeId: string) => {
    const node = findNode(graph, nodeId);
    if (!node) return;
    setPrompt({
      title: "重命名节点",
      label: "标题",
      initialValue: node.title,
      onConfirm: (value) => {
        const next = renameNode(graph, nodeId, value);
        void persistGraph(next);
      },
    });
  };

  // Phase 8：设为入口节点
  const handleSetEntry = (nodeId: string) => {
    const next = setEntryNode(graph, nodeId);
    if (next === graph) return;
    void persistGraph(next);
  };

  // Phase 9：自动排布（确定性分层）后一次性落盘
  const handleAutoLayout = () => {
    const next = autoLayoutGraph(graph);
    if (
      next.nodes.every((node, idx) => {
        const previous = graph.nodes[idx]?.position;
        return previous && node.position.x === previous.x && node.position.y === previous.y;
      })
    ) {
      return;
    }
    void persistGraph(next);
  };

  return (
    <div style={containerStyle}>
      <Breadcrumb
        view={view}
        selectedNodeTitle={selectedNode?.title ?? null}
        onBackToGraph={onOpenGraph}
      />
      <div style={contentStyle}>
        {view === "graph" ? (
          <div style={graphLayoutStyle}>
            <div style={outlinePaneStyle}>
              <CollapsibleSidebar
                title="节点"
                collapsed={outlineCollapsed}
                onCollapsedChange={onOutlineCollapsedChange}
                expandedWidth={280}
                collapsedLabel="节点"
              >
                <NodeOutline
                  graph={graph}
                  nodeEntries={project.nodes}
                  selectedNodeId={selectedNodeId}
                  onSelect={handleSelect}
                />
              </CollapsibleSidebar>
            </div>
            <div style={canvasPaneStyle}>
              <div style={canvasColumnStyle}>
                <div style={toolbarStyle}>
                  <button type="button" onClick={() => handleCreateNode()} disabled={savingGraph} style={{ ...primaryButtonStyle, display: "inline-flex", alignItems: "center", gap: "var(--space-1)" }}>
                    <Plus size={15} />
                    新建节点
                  </button>
                  <div style={toolbarSpacerStyle} />
                  {graphStatus && (
                    <span
                      style={{
                        ...statusTextStyle,
                        color: graphStatus.includes("失败") ? "var(--status-error-text)" : "var(--status-ok-text)",
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
                  onDeleteNodes={handleDeleteNodes}
                  onDeleteEdge={handleDeleteEdge}
                  onCreateNodeAt={(position) => handleCreateNode(position)}
                  onDuplicateNode={handleDuplicateNode}
                  onCreateSuccessor={handleCreateSuccessor}
                  onRenameNode={handleRenameNodeDialog}
                  onSetEntry={handleSetEntry}
                  onAutoLayout={handleAutoLayout}
                />
              </div>
            </div>
            <div style={inspectorPaneStyle}>
              <NodeInspector
                graph={graph}
                nodeEntries={project.nodes}
                selectedNodeId={selectedNodeId}
                onEnter={handleEnter}
                onRename={handleRenameNode}
                onUpdateOutgoingEdges={handleUpdateOutgoingEdges}
                onSetEntry={handleSetEntry}
                saving={savingGraph}
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
              focusRequest={focusRequest}
              onSaved={onSaved}
            />
          )
        )}
      </div>

      {/* Phase 7：自绘弹窗（替换 window.confirm / prompt） */}
      {confirm && (
        <ConfirmDialog
          message={confirm.message}
          danger
          confirmLabel="删除"
          onConfirm={confirm.onConfirm}
          onClose={() => setConfirm(null)}
        />
      )}
      {prompt && (
        <PromptDialog
          title={prompt.title}
          label={prompt.label}
          initialValue={prompt.initialValue}
          onConfirm={prompt.onConfirm}
          onClose={() => setPrompt(null)}
        />
      )}
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  position: "relative",
  display: "flex",
  flexDirection: "column",
  width: "100%",
  height: "100%",
  background: "var(--bg-inset)",
};

const contentStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
};

const graphLayoutStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto minmax(0, 1fr) minmax(280px, 340px)",
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
  gap: "var(--space-2)",
  minHeight: 48,
  padding: "var(--space-2) var(--space-3)",
  borderBottom: "1px solid var(--border)",
  background: "var(--bg-app)",
};

const primaryButtonStyle: React.CSSProperties = {
  padding: "var(--space-2) var(--space-3)",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--accent)",
  background: "var(--accent)",
  color: "var(--text-on-accent)",
  cursor: "pointer",
  fontSize: "var(--text-base)",
  fontWeight: 600,
};

const toolbarSpacerStyle: React.CSSProperties = {
  flex: 1,
};

const statusTextStyle: React.CSSProperties = {
  fontSize: "var(--text-sm)",
};

const inspectorPaneStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  borderLeft: "1px solid var(--border)",
};
