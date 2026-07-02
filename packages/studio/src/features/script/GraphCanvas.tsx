import { useEffect, useMemo, useState } from "react";
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
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
import type { NodeEntry, ProjectGraph } from "../../lib/types";
import { findNodeData, mapGraphToFlow, NODE_TYPE } from "./graphMapping";
import { GraphNodeView, type GraphCanvasNodeData } from "./GraphNodeView";

interface GraphCanvasProps {
  graph: ProjectGraph;
  nodeEntries?: NodeEntry[];
  selectedNodeId: string | null;
  onSelect: (id: string) => void;
  onEnter: (id: string) => void;
  onMoveNode: (id: string, position: { x: number; y: number }) => void;
  onConnect: (from: string, to: string) => void;
  onDeleteNode: (id: string) => void;
  onDeleteEdge: (id: string) => void;
}

type GraphCanvasFlowNode = Node<GraphCanvasNodeData, typeof NODE_TYPE>;

const nodeTypes = { [NODE_TYPE]: GraphNodeView } satisfies NodeTypes;

export function GraphCanvas({
  graph,
  nodeEntries,
  selectedNodeId,
  onSelect,
  onEnter,
  onMoveNode,
  onConnect,
  onDeleteNode,
  onDeleteEdge,
}: GraphCanvasProps) {
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<GraphCanvasFlowNode, Edge> | null>(null);
  const [flowNodes, setFlowNodes] = useState<GraphCanvasFlowNode[]>([]);
  const [flowEdges, setFlowEdges] = useState<Edge[]>([]);

  const flow = useMemo(() => {
    const baseFlow = mapGraphToFlow(graph);

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

    const edges = baseFlow.edges.map((edge) => ({
      ...edge,
      style: { stroke: "#3a6ea5", strokeWidth: 1.5 },
    }));

    return { nodes, edges };
  }, [graph, nodeEntries, selectedNodeId]);

  useEffect(() => {
    setFlowNodes(flow.nodes);
    setFlowEdges(flow.edges);
  }, [flow.edges, flow.nodes]);

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

  return (
    <div style={canvasShellStyle}>
      {flowNodes.length === 0 && <div style={emptyStateStyle}>暂无节点</div>}
      <ReactFlow<GraphCanvasFlowNode, Edge>
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        colorMode="dark"
        fitView
        nodesDraggable
        nodesConnectable
        elementsSelectable
        deleteKeyCode={["Backspace", "Delete"]}
        onInit={(instance) => setFlowInstance(instance)}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onNodesDelete={(nodes) => {
          for (const node of nodes) onDeleteNode(node.id);
        }}
        onEdgesDelete={(edges) => {
          for (const edge of edges) onDeleteEdge(edge.id);
        }}
        onNodeClick={(_, node) => onSelect(node.id)}
        onNodeDoubleClick={(_, node) => onEnter(node.id)}
        proOptions={{ hideAttribution: false }}
      >
        <Background color="#1f2734" gap={24} />
        <Controls
          showInteractive={false}
          style={{ background: "#141922", border: "1px solid #232a38", borderRadius: 8 }}
        />
        <MiniMap
          nodeColor={(node) => (node.id === selectedNodeId ? "#9fc8e3" : "#3a6ea5")}
          maskColor="rgba(0, 0, 0, 0.6)"
          style={{ background: "#10151d", border: "1px solid #232a38" }}
        />
      </ReactFlow>
    </div>
  );
}

const canvasShellStyle: React.CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  background: "#0b0e14",
};

const emptyStateStyle: React.CSSProperties = {
  position: "absolute",
  top: 24,
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 2,
  padding: "8px 14px",
  borderRadius: 999,
  background: "rgba(20, 25, 34, 0.92)",
  border: "1px solid #232a38",
  color: "#a0a8b4",
  fontSize: 13,
  pointerEvents: "none",
};
