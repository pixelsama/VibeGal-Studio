import { useEffect, useMemo, useState } from "react";
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  ControlButton,
  Controls,
  MiniMap,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeTypes,
  type ReactFlowInstance,
} from "@xyflow/react";
import type { GraphReport, NodeEntry, ProjectGraph } from "../../lib/types";
import { findNodeData, mapGraphToFlow, NODE_TYPE } from "./graphMapping";
import { GraphNodeView, type GraphCanvasNodeData } from "./GraphNodeView";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { flowPositionFromClientPoint } from "./canvasMenu";

interface GraphCanvasProps {
  graph: ProjectGraph;
  graphReport?: GraphReport;
  nodeEntries?: NodeEntry[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  onSelect: (id: string) => void;
  onSelectEdge: (id: string) => void;
  onEnter: (id: string) => void;
  onMoveNode: (id: string, position: { x: number; y: number }) => void;
  onConnect: (from: string, to: string) => void;
  onDeleteNodes: (ids: string[]) => void;
  onDeleteEdge: (id: string) => void;
  /** Phase 7：在指定画布坐标创建节点。 */
  onCreateNodeAt?: (position: { x: number; y: number }) => void;
  /** Phase 7：节点右键 - 复制。 */
  onDuplicateNode?: (id: string) => void;
  /** Phase 7：节点右键 - 创建后续节点。 */
  onCreateSuccessor?: (id: string) => void;
  /** Phase 7：节点右键 - 重命名（走 PromptDialog）。 */
  onRenameNode?: (id: string) => void;
  /** Phase 7：节点右键 - 设为入口。 */
  onSetEntry?: (id: string) => void;
  /** Phase 7：空白右键 - 自动排布。 */
  onAutoLayout?: () => void;
}

type GraphCanvasFlowNode = Node<GraphCanvasNodeData, typeof NODE_TYPE>;

const nodeTypes = { [NODE_TYPE]: GraphNodeView } satisfies NodeTypes;

interface CanvasMenuState {
  anchor: { x: number; y: number };
  items: ContextMenuItem[];
}

export function GraphCanvas({
  graph,
  graphReport,
  nodeEntries,
  selectedNodeId,
  selectedEdgeId,
  onSelect,
  onSelectEdge,
  onEnter,
  onMoveNode,
  onConnect,
  onDeleteNodes,
  onDeleteEdge,
  onCreateNodeAt,
  onDuplicateNode,
  onCreateSuccessor,
  onRenameNode,
  onSetEntry,
  onAutoLayout,
}: GraphCanvasProps) {
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<GraphCanvasFlowNode, Edge> | null>(null);
  const [flowNodes, setFlowNodes] = useState<GraphCanvasFlowNode[]>([]);
  const [flowEdges, setFlowEdges] = useState<Edge[]>([]);
  const [menu, setMenu] = useState<CanvasMenuState | null>(null);

  const flow = useMemo(() => {
    const baseFlow = mapGraphToFlow(graph, graphReport, nodeEntries);

    const nodes: GraphCanvasFlowNode[] = baseFlow.nodes.map((node) => {
      return {
        ...node,
        selected: node.id === selectedNodeId,
        data: {
          ...node.data,
          hasContent: findNodeData(nodeEntries, node.data.fileId) != null,
        },
      };
    });

    const edges = baseFlow.edges.map((edge) => {
      const suspicious = Boolean(edge.data?.suspicious);
      const selected = edge.id === selectedEdgeId;
      return {
        ...edge,
        selected,
        animated: suspicious,
        style: {
          stroke: suspicious ? "var(--status-error)" : selected ? "var(--accent-bright)" : "var(--accent)",
          strokeWidth: suspicious || selected ? 2.5 : 1.5,
          strokeDasharray: suspicious ? "6 4" : undefined,
        },
      };
    });

    return { nodes, edges };
  }, [graph, graphReport, nodeEntries, selectedEdgeId, selectedNodeId]);

  useEffect(() => {
    setFlowNodes(flow.nodes);
    setFlowEdges(flow.edges);
  }, [flow.edges, flow.nodes]);

  // 定位到选中节点（保留原有行为）
  useEffect(() => {
    if (!flowInstance || !selectedNodeId) return;
    const node = flowNodes.find((candidate) => candidate.id === selectedNodeId);
    if (!node) return;

    void flowInstance.setCenter(node.position.x + 120, node.position.y + 48, {
      zoom: Math.max(flowInstance.getZoom(), 0.85),
      duration: 250,
    });
  }, [flowInstance, flowNodes, selectedNodeId]);

  const handleNodesChange = (changes: NodeChange<GraphCanvasFlowNode>[]) => {
    setFlowNodes((current) => applyNodeChanges(changes.filter((change) => change.type !== "remove"), current));

    for (const change of changes) {
      if (change.type === "select" && change.selected) {
        onSelect(change.id);
      }
      if (change.type === "position" && change.position && change.dragging === false) {
        onMoveNode(change.id, change.position);
      }
    }
  };

  const handleEdgesChange = (changes: EdgeChange<Edge>[]) => {
    setFlowEdges((current) => applyEdgeChanges(changes.filter((change) => change.type !== "remove"), current));
  };

  const handleConnect = (connection: Connection) => {
    if (!connection.source || !connection.target) return;
    onConnect(connection.source, connection.target);
  };

  // Phase 7：空白处右键 → 新建节点 / 自动排布 / 重置视图
  const handlePaneContextMenu = (event: React.MouseEvent | MouseEvent) => {
    event.preventDefault();
    if (!flowInstance) return;
    const clientX = "clientX" in event ? event.clientX : 0;
    const clientY = "clientY" in event ? event.clientY : 0;
    // 屏幕坐标 → 画布坐标，新建节点落在右键处
    const canvasPos = flowPositionFromClientPoint(
      { x: clientX, y: clientY },
      flowInstance.screenToFlowPosition,
    );

    const items: ContextMenuItem[] = [];
    if (onCreateNodeAt) {
      items.push({
        key: "create",
        label: "在此新建节点",
        onSelect: () => onCreateNodeAt({ x: Math.round(canvasPos.x), y: Math.round(canvasPos.y) }),
      });
    }
    if (onAutoLayout) {
      items.push({
        key: "auto-layout",
        label: "自动排布",
        onSelect: () => onAutoLayout(),
      });
    }
    items.push({ key: "fit", label: "重置视图", onSelect: () => flowInstance.fitView({ duration: 250 }) });

    setMenu({ anchor: { x: clientX, y: clientY }, items });
  };

  // Phase 7：节点右键 → 进入 / 重命名 / 复制 / 后续 / 删除
  const handleNodeContextMenu = (event: React.MouseEvent, node: GraphCanvasFlowNode) => {
    event.preventDefault();
    const clientX = event.clientX;
    const clientY = event.clientY;

    const items: ContextMenuItem[] = [
      { key: "enter", label: "进入编辑", onSelect: () => onEnter(node.id) },
    ];
    if (onRenameNode) {
      items.push({ key: "rename", label: "重命名", onSelect: () => onRenameNode(node.id) });
    }
    if (onDuplicateNode) {
      items.push({ key: "duplicate", label: "复制节点", onSelect: () => onDuplicateNode(node.id) });
    }
    if (onCreateSuccessor) {
      items.push({ key: "successor", label: "创建后续节点", onSelect: () => onCreateSuccessor(node.id) });
    }
    if (onSetEntry && node.id !== graph.entryNodeId) {
      items.push({ key: "set-entry", label: "设为入口节点", onSelect: () => onSetEntry(node.id) });
    }
    items.push({
      key: "delete",
      label: "删除节点",
      danger: true,
      dividerBefore: true,
      onSelect: () => onDeleteNodes([node.id]),
    });

    setMenu({ anchor: { x: clientX, y: clientY }, items });
  };

  const handleLocateEntry = () => {
    if (!flowInstance || !graph.entryNodeId) return;
    const entry = flowNodes.find((n) => n.id === graph.entryNodeId);
    if (entry) {
      onSelect(entry.id);
      void flowInstance.setCenter(entry.position.x + 120, entry.position.y + 48, {
        zoom: Math.max(flowInstance.getZoom(), 0.85),
        duration: 250,
      });
    }
  };

  return (
    <div style={canvasShellStyle} onContextMenu={(e) => e.preventDefault()}>
      {flowNodes.length === 0 && <div style={emptyStateStyle}>暂无节点</div>}
      <ReactFlow<GraphCanvasFlowNode, Edge>
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        colorMode="dark"
        fitView
        nodesDraggable
        nodesConnectable
        nodeClickDistance={6}
        connectOnClick={false}
        elementsSelectable
        deleteKeyCode={["Backspace", "Delete"]}
        onInit={(instance) => setFlowInstance(instance)}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onNodesDelete={(nodes) => {
          onDeleteNodes(nodes.map((node) => node.id));
        }}
        onEdgesDelete={(edges) => {
          for (const edge of edges) onDeleteEdge(edge.id);
        }}
        onNodeClick={(_, node) => {
          onSelect(node.id);
          setMenu(null);
        }}
        onEdgeClick={(_, edge) => {
          onSelectEdge(edge.id);
          setMenu(null);
        }}
        onPaneClick={() => setMenu(null)}
        onMoveStart={() => setMenu(null)}
        onNodeDoubleClick={(_, node) => onEnter(node.id)}
        onPaneContextMenu={handlePaneContextMenu}
        onNodeContextMenu={handleNodeContextMenu}
        proOptions={{ hideAttribution: false }}
      >
        <Background color="var(--bg-hover)" gap={24} />
        <Controls
          showInteractive={false}
          style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8 }}
        >
          {graph.entryNodeId && (
            <ControlButton
              type="button"
              onClick={handleLocateEntry}
              title="定位入口节点"
              aria-label="定位入口节点"
            >
              <span style={entryLocatorIconStyle}>⌂</span>
            </ControlButton>
          )}
        </Controls>
        <MiniMap
          nodeColor={(node) =>
            node.data.duplicateNodeId ? "var(--status-error)" : node.id === selectedNodeId ? "var(--accent-bright)" : "var(--accent)"
          }
          maskColor="var(--overlay-strong)"
          style={{ background: "var(--bg-inset)", border: "1px solid var(--border)" }}
        />
      </ReactFlow>

      {/* Phase 7：右键菜单 */}
      {menu && <ContextMenu anchor={menu.anchor} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

const canvasShellStyle: React.CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  background: "var(--bg-inset)",
};

const emptyStateStyle: React.CSSProperties = {
  position: "absolute",
  top: 24,
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 2,
  padding: "8px 14px",
  borderRadius: 999,
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
  color: "var(--text-secondary)",
  fontSize: 13,
  pointerEvents: "none",
};

const entryLocatorIconStyle: React.CSSProperties = {
  color: "var(--accent-bright)",
  fontSize: 18,
  lineHeight: 1,
};
