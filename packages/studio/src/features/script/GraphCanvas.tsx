import { useEffect, useMemo, useRef, useState } from "react";
import { LayoutGrid, Redo2, Scan, Undo2, Workflow } from "lucide-react";
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
import type { VariableRegistry } from "@vibegal/engine";
import type { GraphReport, Manifest, NodeCreatorSummary, NodeEntry, ProjectGraph } from "../../lib/types";
import { mapGraphToFlow, NODE_TYPE } from "./graphMapping";
import { useResolvedTheme } from "../../lib/theme";
import { GraphNodeView, type GraphCanvasNodeData } from "./GraphNodeView";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { flowPositionFromClientPoint, flowPositionFromViewportCenter } from "./canvasMenu";
import { EmptyState } from "../common/EmptyState";
import { Button } from "../common/Button";
import { useStudioI18n } from "../../lib/i18n";

interface GraphCanvasProps {
  graph: ProjectGraph;
  graphReport?: GraphReport;
  nodeEntries?: NodeEntry[];
  nodeSummaries?: NodeCreatorSummary[];
  manifest?: Manifest;
  variables?: VariableRegistry;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  visibleNodeIds?: ReadonlySet<string>;
  /** Increment when a programmatic graph edit should re-locate the current selection. */
  locateSelectedNodeToken?: number;
  canUndo?: boolean;
  canRedo?: boolean;
  onSelect: (id: string) => void;
  onSelectEdge: (id: string) => void;
  onEnter: (id: string) => void;
  onMoveNode: (id: string, position: { x: number; y: number }) => void;
  onConnect: (from: string, to: string) => void;
  onDeleteNodes: (ids: string[]) => void;
  onDeleteEdge: (id: string) => void;
  onUndo?: () => void;
  onRedo?: () => void;
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
  onManageEnding?: (id: string) => void;
  /** Phase 7：空白右键 - 自动排布。 */
  onAutoLayout?: () => void;
  /** Spec 33 E6：唤出快捷键与命令帮助（画布右键菜单入口）。 */
  onOpenShortcutsHelp?: () => void;
}

type GraphCanvasFlowNode = Node<GraphCanvasNodeData, typeof NODE_TYPE>;

const nodeTypes = { [NODE_TYPE]: GraphNodeView } satisfies NodeTypes;

interface CanvasMenuState {
  anchor: { x: number; y: number };
  items: ContextMenuItem[];
}

export function filterVisibleCanvasElements<
  TNode extends { id: string },
  TEdge extends { source: string; target: string },
>(nodes: TNode[], edges: TEdge[], visibleNodeIds?: ReadonlySet<string>): { nodes: TNode[]; edges: TEdge[] } {
  if (!visibleNodeIds) return { nodes, edges };
  return {
    nodes: nodes.filter((node) => visibleNodeIds.has(node.id)),
    edges: edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)),
  };
}

export function shouldLocateSelectedNode(
  selectedNodeId: string | null,
  lastLocatedNodeId: string | null,
  locateRequested: boolean,
): boolean {
  return selectedNodeId != null && (locateRequested || selectedNodeId !== lastLocatedNodeId);
}

export function GraphCanvas({
  graph,
  graphReport,
  nodeEntries,
  nodeSummaries,
  manifest,
  variables,
  selectedNodeId,
  selectedEdgeId,
  visibleNodeIds,
  locateSelectedNodeToken,
  canUndo = false,
  canRedo = false,
  onSelect,
  onSelectEdge,
  onEnter,
  onMoveNode,
  onConnect,
  onDeleteNodes,
  onDeleteEdge,
  onUndo,
  onRedo,
  onCreateNodeAt,
  onDuplicateNode,
  onCreateSuccessor,
  onRenameNode,
  onSetEntry,
  onManageEnding,
  onAutoLayout,
  onOpenShortcutsHelp,
}: GraphCanvasProps) {
  const { t } = useStudioI18n();
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<GraphCanvasFlowNode, Edge> | null>(null);
  const [flowNodes, setFlowNodes] = useState<GraphCanvasFlowNode[]>([]);
  const [flowEdges, setFlowEdges] = useState<Edge[]>([]);
  const [menu, setMenu] = useState<CanvasMenuState | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const colorMode = useResolvedTheme();

  const flow = useMemo(() => {
    const visibleGraph = visibleNodeIds
      ? {
          ...graph,
          nodes: graph.nodes.filter((node) => visibleNodeIds.has(node.id)),
          edges: graph.edges.filter((edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to)),
        }
      : graph;
    const visibleNodeFiles = visibleNodeIds
      ? new Set(visibleGraph.nodes.map((node) => node.file))
      : null;
    const visibleEntries = visibleNodeFiles && nodeEntries
      ? nodeEntries.filter((entry) => visibleNodeFiles.has(entry.relPath))
      : nodeEntries;
    const visibleSummaries = visibleNodeIds
      ? nodeSummaries?.filter((summary) => visibleNodeIds.has(summary.id))
      : nodeSummaries;
    const visibleFlow = mapGraphToFlow(visibleGraph, graphReport, visibleEntries, manifest, variables, visibleSummaries, t);

    const nodes: GraphCanvasFlowNode[] = visibleFlow.nodes.map((node) => ({
      ...node,
      selected: node.id === selectedNodeId,
    }));

    const edges = visibleFlow.edges.map((edge) => {
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
  }, [graph, graphReport, nodeEntries, nodeSummaries, manifest, variables, selectedEdgeId, selectedNodeId, t, visibleNodeIds]);

  useEffect(() => {
    setFlowNodes(flow.nodes);
    setFlowEdges(flow.edges);
  }, [flow.edges, flow.nodes]);

  // 定位到选中节点：使用由 graph 推导的 canonical positions，避免拖动产生的
  // 本地 flowNodes 更新触发画布回弹；程序化布局/撤销通过 token 明确请求重新定位。
  const lastLocatedNodeIdRef = useRef<string | null>(null);
  const lastLocateTokenRef = useRef(locateSelectedNodeToken);
  useEffect(() => {
    if (!flowInstance) return;
    const locateRequested = locateSelectedNodeToken !== lastLocateTokenRef.current;
    if (locateRequested) {
      lastLocateTokenRef.current = locateSelectedNodeToken;
      lastLocatedNodeIdRef.current = null;
    }
    if (!selectedNodeId) {
      lastLocatedNodeIdRef.current = null;
      return;
    }
    // 同一节点已定位过则跳过，这样拖动节点（更新 flowNodes）不会再次触发 setCenter。
    if (!shouldLocateSelectedNode(selectedNodeId, lastLocatedNodeIdRef.current, locateRequested)) return;
    const node = flow.nodes.find((candidate) => candidate.id === selectedNodeId);
    if (!node) return; // 节点尚未载入，等下一次 flowNodes 更新重试
    lastLocatedNodeIdRef.current = selectedNodeId;

    const centerX = node.position.x + 120;
    const centerY = node.position.y + 48;
    // 节点已在视口内则不打扰，避免选中可见节点时画布被拽动。
    const bounds = shellRef.current?.getBoundingClientRect();
    if (bounds) {
      const viewport = flowInstance.getViewport();
      const screenX = centerX * viewport.zoom + viewport.x;
      const screenY = centerY * viewport.zoom + viewport.y;
      const margin = 80;
      const inViewport =
        screenX > margin &&
        screenX < bounds.width - margin &&
        screenY > margin &&
        screenY < bounds.height - margin;
      if (inViewport) return;
    }
    void flowInstance.setCenter(centerX, centerY, {
      zoom: Math.max(flowInstance.getZoom(), 0.85),
      duration: 250,
    });
  }, [flow.nodes, flowInstance, locateSelectedNodeToken, selectedNodeId]);

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
        label: t("script.canvas.createHere"),
        onSelect: () => onCreateNodeAt({ x: Math.round(canvasPos.x), y: Math.round(canvasPos.y) }),
      });
    }
    if (onAutoLayout) {
      items.push({
        key: "auto-layout",
        label: t("script.canvas.autoLayout"),
        onSelect: () => onAutoLayout(),
      });
    }
    items.push({ key: "fit", label: t("script.canvas.fitView"), onSelect: handleFitView });
    if (onOpenShortcutsHelp) {
      items.push({
        key: "shortcuts-help",
        label: t("script.canvas.shortcutsHelp"),
        onSelect: onOpenShortcutsHelp,
      });
    }

    setMenu({ anchor: { x: clientX, y: clientY }, items });
  };

  // Phase 7：节点右键 → 进入 / 重命名 / 复制 / 后续 / 删除
  const handleNodeContextMenu = (event: React.MouseEvent, node: GraphCanvasFlowNode) => {
    event.preventDefault();
    const clientX = event.clientX;
    const clientY = event.clientY;

    const items: ContextMenuItem[] = [
      { key: "enter", label: t("script.nodeInspector.enterEdit"), onSelect: () => onEnter(node.id) },
    ];
    if (onRenameNode) {
      items.push({ key: "rename", label: t("script.canvas.rename"), onSelect: () => onRenameNode(node.id) });
    }
    if (onDuplicateNode) {
      items.push({ key: "duplicate", label: t("script.canvas.duplicate"), onSelect: () => onDuplicateNode(node.id) });
    }
    if (onCreateSuccessor) {
      items.push({ key: "successor", label: t("script.canvas.createSuccessor"), onSelect: () => onCreateSuccessor(node.id) });
    }
    if (onSetEntry && node.id !== graph.entryNodeId) {
      items.push({ key: "set-entry", label: t("script.nodeInspector.setEntry"), onSelect: () => onSetEntry(node.id) });
    }
    if (onManageEnding) {
      const registered = Object.values(manifest?.unlocks?.endings ?? {}).some((ending) => ending.nodeId === node.id);
      items.push({ key: "ending", label: registered ? t("script.canvas.manageEnding") : t("script.canvas.registerEnding"), onSelect: () => onManageEnding(node.id) });
    }
    items.push({
      key: "delete",
      label: t("script.canvas.deleteNode"),
      danger: true,
      dividerBefore: true,
      onSelect: () => onDeleteNodes([node.id]),
    });

    setMenu({ anchor: { x: clientX, y: clientY }, items });
  };

  // Spec 33 E5：适应视图上浮为常驻控件（Controls 按钮与右键菜单共用）。
  const handleFitView = () => {
    if (!flowInstance) return;
    flowInstance.fitView({ duration: 250 });
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

  // 空画布主操作：在画布可视中心创建第一个节点
  const handleCreateAtCenter = () => {
    if (!flowInstance || !onCreateNodeAt) return;
    const bounds = shellRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const center = flowPositionFromViewportCenter(bounds, flowInstance.screenToFlowPosition);
    onCreateNodeAt({ x: Math.round(center.x), y: Math.round(center.y) });
  };

  return (
    <div ref={shellRef} style={canvasShellStyle} onContextMenu={(e) => e.preventDefault()}>
      {flowNodes.length === 0 && (
        // 空画布引导层：整体不挡画布交互，仅操作区恢复可点
        <div style={emptyOverlayStyle}>
          <EmptyState
            icon={Workflow}
            title={t("script.canvas.emptyTitle")}
            description={t("script.canvas.emptyDescription")}
            action={
              onCreateNodeAt ? (
                <div style={{ pointerEvents: "auto" }}>
                  <Button variant="primary" disabled={!flowInstance} onClick={handleCreateAtCenter}>
                    {t("script.canvas.createFirst")}
                  </Button>
                </div>
              ) : undefined
            }
          />
        </div>
      )}
      <ReactFlow<GraphCanvasFlowNode, Edge>
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        colorMode={colorMode}
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
          style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}
        >
          <ControlButton
            type="button"
            onClick={() => onUndo?.()}
            disabled={!canUndo}
            title={t("script.canvas.undo")}
            aria-label={t("script.canvas.undo")}
          >
            <Undo2 size={14} />
          </ControlButton>
          <ControlButton
            type="button"
            onClick={() => onRedo?.()}
            disabled={!canRedo}
            title={t("script.canvas.redo")}
            aria-label={t("script.canvas.redo")}
          >
            <Redo2 size={14} />
          </ControlButton>
          {onAutoLayout && (
            <ControlButton
              type="button"
              onClick={onAutoLayout}
              title={t("script.canvas.autoLayout")}
              aria-label={t("script.canvas.autoLayout")}
            >
              <LayoutGrid size={14} />
            </ControlButton>
          )}
          <ControlButton
            type="button"
            onClick={handleFitView}
            disabled={!flowInstance}
            title={t("script.canvas.fitView")}
            aria-label={t("script.canvas.fitView")}
          >
            <Scan size={14} />
          </ControlButton>
          {graph.entryNodeId && (
            <ControlButton
              type="button"
              onClick={handleLocateEntry}
              title={t("script.canvas.locateEntry")}
              aria-label={t("script.canvas.locateEntry")}
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

const emptyOverlayStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "grid",
  placeItems: "center",
  zIndex: 2,
  pointerEvents: "none",
};

const entryLocatorIconStyle: React.CSSProperties = {
  color: "var(--accent-bright)",
  fontSize: "var(--text-xl)",
  lineHeight: 1,
};
