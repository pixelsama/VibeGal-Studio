import { useCallback, useEffect, useMemo, useState } from "react";
import { Layers3, Plus } from "lucide-react";
import { deleteFile, renameVariable, saveFile, saveLocale, saveManifest, saveVariables, saveNode } from "../../lib/tauri";
import { Button } from "../common/Button";
import { isEditableEventTarget, resolveUndoRedoShortcut } from "./graphShortcuts";
import type {
  FileRevision,
  GraphIssueFocusRequest,
  LocaleTable,
  NodeDetail,
  ProjectChangedPayload,
  ProjectData,
  ProjectGraph,
} from "../../lib/types";
import { CollapsibleSidebar } from "../common/CollapsibleSidebar";
import { Breadcrumb } from "./Breadcrumb";
import { GraphCanvas } from "./GraphCanvas";
import { StoryStateView } from "./StoryStateView";
import { TranslationComparison } from "./TranslationComparison";
import { assignInstructionTextKey } from "./translationModel";
import { RouteCoveragePanel } from "./RouteCoveragePanel";
import { NodeInspector } from "./NodeInspector";
import {
  NodeEditor,
  nodeExternalChange as resolveNodeExternalChange,
} from "./NodeEditor";
import { StoryOutline } from "./StoryOutline";
import { ConfirmDialog, PromptDialog } from "../common/Dialogs";
import {
  createSuccessor,
  defaultPosition,
  duplicateNode,
  generateNodeId,
  removeNodes,
} from "./graphEditing";
import {
  applyGraphCommand,
  redoGraphHistory,
  undoGraphHistory,
} from "./graphHistory";
import { findNode } from "./graphMapping";
import { loadNodeDetail, useAllProjectNodes, useNodeCreatorSummaries, useNodeDetail } from "../../lib/projectNodeData";
import "@xyflow/react/dist/style.css";
import { endingsForNode, insertEndingCompletion, registerEnding, unregisterEnding, upsertEnding } from "./endingRegistry";
import { referencesAffectedByNodeDeletion } from "./nodeReferences";
import {
  chapterScopeForNode,
  generateChapterId,
  graphForChapterScope,
  isNodeInChapterScope,
  normalizeChapterScope,
  type ChapterScope,
} from "./chapterEditing";

import {
  buildGraphPositionUpdates,
  persistCreatedNodeWithCompensation,
} from "./scriptWorkspaceOperations";
import { useScriptGraphState } from "./useScriptGraphState";
import { statusError, statusOk, statusWarn, statusSeverityColor } from "./statusMessage";
import { useStudioI18n } from "../../lib/i18n";
export {
  buildGraphPositionUpdates,
  persistCreatedNodeWithCompensation,
  takePendingGraphPositionUpdates,
} from "./scriptWorkspaceOperations";
export type {
  PersistCreatedNodeWithCompensationParams,
  PersistCreatedNodeWithCompensationResult,
} from "./scriptWorkspaceOperations";

interface RetainedNodeEditor {
  projectPath: string;
  node: ProjectGraph["nodes"][number];
  detail: NodeDetail;
}

export interface ResolvedNodeChange {
  payload: ProjectChangedPayload;
  nodeFile: string;
}

interface Props {
  project: ProjectData;
  rendererId: string;
  refreshKey: number;
  lastProjectChange?: ProjectChangedPayload | null;
  outlineCollapsed: boolean;
  onOutlineCollapsedChange: (collapsed: boolean) => void;
  location: ScriptWorkspaceLocation;
  focusRequest?: GraphIssueFocusRequest | null;
  onOpenGraph: () => void;
  onOpenNode: (nodeId: string) => void;
  onReplaceWithGraph: () => void;
  onSaved: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** Spec 33 E6：画布右键菜单「快捷键与命令」入口。 */
  onOpenShortcutsHelp?: () => void;
}

export type ScriptWorkspaceLocation =
  | { view: "graph" }
  | { view: "node"; nodeId: string };

export function ScriptWorkspace({
  project,
  rendererId,
  refreshKey: _refreshKey,
  lastProjectChange,
  outlineCollapsed,
  onOutlineCollapsedChange,
  location,
  focusRequest,
  onOpenGraph,
  onOpenNode,
  onReplaceWithGraph,
  onSaved,
  onDirtyChange,
  onOpenShortcutsHelp,
}: Props) {
  const { t } = useStudioI18n();
  const view = location.view;
  /** 剧情工作台的一级视图：剧情流程 / 故事状态 / 翻译对照。 */
  const [primaryView, setPrimaryView] = useState<"flow" | "state" | "translation">("flow");
  const scriptTabViews = ["flow", "state", "translation"] as const;
  const handleViewKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const current = scriptTabViews.indexOf(primaryView);
    if (current === -1) return;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (current + 1) % scriptTabViews.length;
    else if (event.key === "ArrowLeft") next = (current - 1 + scriptTabViews.length) % scriptTabViews.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = scriptTabViews.length - 1;
    if (next === null) return;
    event.preventDefault();
    const nextView = scriptTabViews[next];
    setPrimaryView(nextView);
    requestAnimationFrame(() => {
      document.getElementById(`script-tab-${nextView}`)?.focus();
    });
  };
  const [coverageOpen, setCoverageOpen] = useState(false);
  const [outlineSearchActive, setOutlineSearchActive] = useState(false);
  const blockingFullNodeData = view === "graph"
    && (primaryView === "state" || primaryView === "translation" || coverageOpen);
  const needsFullNodeData = blockingFullNodeData || (view === "graph" && outlineSearchActive);
  const allNodeData = useAllProjectNodes(project, _refreshKey, needsFullNodeData);
  const nodeCreatorSummaries = useNodeCreatorSummaries(
    project,
    _refreshKey,
    view === "graph" && primaryView === "flow",
  );
  const [localFocus, setLocalFocus] = useState<GraphIssueFocusRequest | null>(null);
  const [retainedNodeEditor, setRetainedNodeEditor] = useState<RetainedNodeEditor | null>(null);
  const [nodeEditorDirty, setNodeEditorDirty] = useState(false);
  const [resolvedNodeChange, setResolvedNodeChange] = useState<ResolvedNodeChange | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [graphLocateToken, setGraphLocateToken] = useState(0);
  const [chapterScope, setChapterScope] = useState<ChapterScope>({ kind: "all" });
  const {
    graph,
    graphHistory,
    graphReport,
    savingGraph,
    graphStatus,
    setGraphHistory,
    setSavingGraph,
    setGraphStatus,
    persistGraph,
    schedulePositionSave,
    replaceGraph,
  } = useScriptGraphState({ project, view, onSaved, onDirtyChange });
  const [confirm, setConfirm] = useState<{
    message: string;
    onConfirm: () => void;
    confirmLabel?: string;
    danger?: boolean;
  } | null>(null);
  const [prompt, setPrompt] = useState<{ title: string; label?: string; initialValue?: string; allowUnchanged?: boolean; onConfirm: (v: string) => void } | null>(null);
  const activeNodeId = location.view === "node" ? location.nodeId : selectedNodeId;
  const selectedNode = useMemo(() => findNode(graph, activeNodeId), [activeNodeId, graph]);
  const activeNodeFile = nodeFileForEditorRoute({
    location,
    projectPath: project.path,
    selectedNodeFile: selectedNode?.file,
    retainedNode: retainedNodeEditor
      ? {
        projectPath: retainedNodeEditor.projectPath,
        nodeId: retainedNodeEditor.node.id,
        nodeFile: retainedNodeEditor.node.file,
      }
      : null,
  });
  const selectedNodeDetail = useNodeDetail(
    project,
    activeNodeFile || null,
    _refreshKey,
  );
  const unresolvedProjectChange = projectChangeAfterResolution({
    payload: lastProjectChange,
    resolved: resolvedNodeChange,
    nodeFile: activeNodeFile,
  });
  const activeNodeChange = useMemo(
    () => resolveNodeExternalChange(unresolvedProjectChange, activeNodeFile),
    [activeNodeFile, unresolvedProjectChange],
  );
  const preserveRetainedEditor = nodeEditorDirty || activeNodeChange != null;
  const retainedEditorMatchesRoute = location.view === "node"
    && retainedNodeEditor?.projectPath === project.path
    && retainedNodeEditor.node.id === location.nodeId;
  const editorNode = retainedEditorMatchesRoute && preserveRetainedEditor
    ? retainedNodeEditor.node
    : selectedNode;
  const editorDetail = editorSnapshotAfterRefresh({
    current: retainedEditorMatchesRoute ? retainedNodeEditor.detail : null,
    incoming: selectedNodeDetail.detail,
    dirty: nodeEditorDirty,
    externalChange: activeNodeChange,
  });
  const scopedGraph = useMemo(() => graphForChapterScope(graph, chapterScope), [chapterScope, graph]);
  const visibleNodeIds = useMemo(() => new Set(scopedGraph.nodes.map((node) => node.id)), [scopedGraph.nodes]);

  useEffect(() => {
    if (!selectedNode || !selectedNodeDetail.detail || nodeEditorDirty) return;
    setRetainedNodeEditor({
      projectPath: project.path,
      node: selectedNode,
      detail: selectedNodeDetail.detail,
    });
  }, [nodeEditorDirty, project.path, selectedNode, selectedNodeDetail.detail]);

  useEffect(() => {
    setRetainedNodeEditor(null);
    setNodeEditorDirty(false);
    setResolvedNodeChange(null);
  }, [project.path]);

  const handleNodeDirtyChange = useCallback((dirty: boolean) => {
    setNodeEditorDirty(dirty);
    onDirtyChange?.(dirty);
  }, [onDirtyChange]);

  const handleExternalChangeResolved = useCallback(() => {
    if (!lastProjectChange || !activeNodeFile) return;
    setResolvedNodeChange({
      payload: lastProjectChange,
      nodeFile: activeNodeFile,
    });
  }, [activeNodeFile, lastProjectChange]);

  useEffect(() => {
    setChapterScope((current) => normalizeChapterScope(graph, current));
  }, [graph]);

  useEffect(() => {
    if (location.view === "node") {
      if (findNode(graph, location.nodeId)) {
        setSelectedNodeId(location.nodeId);
        return;
      }
      if (
        retainedNodeEditor?.projectPath === project.path
        && retainedNodeEditor.node.id === location.nodeId
        && (
          nodeEditorDirty
          || resolveNodeExternalChange(unresolvedProjectChange, retainedNodeEditor.node.file)
        )
      ) {
        setSelectedNodeId(null);
        return;
      }
      setSelectedNodeId(null);
      onReplaceWithGraph();
      return;
    }

    if (!selectedNodeId) return;
    if (findNode(graph, selectedNodeId)) return;
    setSelectedNodeId(null);
  }, [
    graph,
    location,
    nodeEditorDirty,
    onReplaceWithGraph,
    project.path,
    retainedNodeEditor,
    selectedNodeId,
    unresolvedProjectChange,
  ]);

  useEffect(() => {
    if (!focusRequest) return;
    if (focusRequest.nodeId && findNode(graph, focusRequest.nodeId)) {
      setSelectedNodeId(focusRequest.nodeId);
      setChapterScope(chapterScopeForNode(graph, focusRequest.nodeId));
      setSelectedEdgeId(null);
      return;
    }
    if (focusRequest.edgeId && graph.edges.some((edge) => edge.id === focusRequest.edgeId)) {
      const sourceNodeId = graph.edges.find((edge) => edge.id === focusRequest.edgeId)?.from ?? null;
      setSelectedNodeId(sourceNodeId);
      setChapterScope({ kind: "all" });
      setSelectedEdgeId(focusRequest.edgeId);
    }
  }, [focusRequest, graph]);

  const handleSelect = (id: string) => {
    if (!isNodeInChapterScope(graph, id, chapterScope)) {
      setChapterScope(chapterScopeForNode(graph, id));
    }
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
  };

  const handleChapterScopeChange = (scope: ChapterScope) => {
    setChapterScope(scope);
    setSelectedEdgeId(null);
    if (selectedNodeId && !isNodeInChapterScope(graph, selectedNodeId, scope)) {
      setSelectedNodeId(null);
    }
  };

  const handleSelectEdge = (id: string) => {
    const sourceNodeId = graph.edges.find((edge) => edge.id === id)?.from ?? null;
    if (!scopedGraph.edges.some((edge) => edge.id === id)) {
      setChapterScope({ kind: "all" });
    }
    setSelectedEdgeId(id);
    setSelectedNodeId(sourceNodeId);
  };

  const handleEnter = (id: string) => {
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
    onOpenNode(id);
  };

  /**
   * 从故事状态页跳到「改变它的那一条指令」。
   *
   * 复用问题面板已有的 focusRequest 通道（NodeEditor 按 jsonPath 定位），
   * 所以不需要给 run-scope 的 set 指令新发稳定 ID。
   */
  const handleOpenNodeAtInstruction = (nodeId: string, instructionIndex?: number) => {
    setPrimaryView("flow");
    setLocalFocus(instructionIndex == null
      ? null
      : { requestId: Date.now(), nodeId, jsonPath: `$[${instructionIndex}]` });
    handleEnter(nodeId);
  };

  const handleCreateNode = async (position?: { x: number; y: number }) => {
    const id = generateNodeId(graph, "node");
    const file = `nodes/${id}.json`;
    setSavingGraph(true);
    setGraphStatus(null);
    try {
      const nextState = applyGraphCommand(graphHistory, {
        kind: "addNode",
        id,
        title: id,
        file,
        position: position ?? defaultPosition(scopedGraph),
        chapterId: chapterScope.kind === "chapter" ? chapterScope.chapterId : graph.chapters[0].id,
      });
      const next = nextState.graph;
      setGraphHistory(nextState);
      setSelectedNodeId(id);
      setSelectedEdgeId(null);
      onOpenGraph();
      const result = await persistCreatedNodeWithCompensation({
        projectPath: project.path,
        nodeFile: file,
        content: "[]",
        graph: next,
        saveFileFn: saveFile,
        persistGraphFn: persistGraph,
        deleteFileFn: deleteFile,
      });
      if (!result.saved) {
        setGraphHistory(graphHistory);
        setSelectedNodeId(null);
        if (!result.rolledBack) {
          setGraphStatus(statusError(t("script.graph.saveFailedKept", {
            kind: t("script.node.newKind"),
            detail: result.rollbackError instanceof Error ? result.rollbackError.message : String(result.rollbackError),
          })));
        }
      }
    } catch (error) {
      setGraphStatus(statusError(t("script.node.createFailed", {
        detail: error instanceof Error ? error.message : String(error),
      })));
    } finally {
      setSavingGraph(false);
    }
  };

  const handleRenameNode = (id: string, title: string) => {
    const nextState = applyGraphCommand(graphHistory, { kind: "renameNode", nodeId: id, title });
    if (nextState === graphHistory) return;
    setGraphHistory(nextState);
    void persistGraph(nextState.graph);
  };

  const handleSetNodeChapter = (id: string, chapterId: string) => {
    const nextState = applyGraphCommand(graphHistory, { kind: "setNodeChapter", nodeId: id, chapterId });
    if (nextState === graphHistory) return;
    setGraphHistory(nextState);
    setChapterScope({ kind: "chapter", chapterId });
    void persistGraph(nextState.graph);
  };

  const handleCreateChapter = () => {
    const id = generateChapterId(graph);
    setPrompt({
      title: t("script.chapter.create"),
      label: t("script.chapter.name"),
      initialValue: `第 ${graph.chapters.length + 1} 章`,
      // 默认名本身就是要创建的合法值，允许不改动直接确认。
      allowUnchanged: true,
      onConfirm: (value) => {
        const title = value.trim();
        if (!title) return;
        const nextState = applyGraphCommand(graphHistory, { kind: "addChapter", id, title });
        setGraphHistory(nextState);
        setChapterScope({ kind: "chapter", chapterId: id });
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
        void persistGraph(nextState.graph);
      },
    });
  };

  const handleRenameChapter = (chapterId: string) => {
    const chapter = graph.chapters.find((candidate) => candidate.id === chapterId);
    if (!chapter) return;
    setPrompt({
      title: t("script.chapter.rename"),
      label: t("script.chapter.name"),
      initialValue: chapter.title,
      onConfirm: (value) => {
        const title = value.trim();
        if (!title) return;
        const nextState = applyGraphCommand(graphHistory, { kind: "renameChapter", chapterId, title });
        if (nextState === graphHistory) return;
        setGraphHistory(nextState);
        void persistGraph(nextState.graph);
      },
    });
  };

  const handleMoveChapter = (chapterId: string, offset: -1 | 1) => {
    const nextState = applyGraphCommand(graphHistory, { kind: "moveChapter", chapterId, offset });
    if (nextState === graphHistory) return;
    setGraphHistory(nextState);
    void persistGraph(nextState.graph);
  };

  const handleDeleteChapter = (chapterId: string) => {
    const chapter = graph.chapters.find((candidate) => candidate.id === chapterId);
    if (!chapter) return;
    const nodeCount = graph.nodes.filter((node) => node.chapterId === chapterId).length;
    if (graph.chapters.length === 1) {
      setGraphStatus(statusWarn(t("script.chapter.minimum")));
      return;
    }
    if (nodeCount > 0) {
      setGraphStatus(statusWarn(t("script.chapter.moveNodesFirst", { title: chapter.title, count: nodeCount })));
      return;
    }
    const deletingActiveChapter = chapterScope.kind === "chapter" && chapterScope.chapterId === chapterId;
    setConfirm({
      message: t("script.chapter.deleteConfirm", { title: chapter.title }),
      confirmLabel: t("script.chapter.delete"),
      danger: true,
      onConfirm: () => {
        const nextState = applyGraphCommand(graphHistory, { kind: "deleteChapter", chapterId });
        setGraphHistory(nextState);
        if (deletingActiveChapter) {
          setChapterScope({ kind: "all" });
          setSelectedEdgeId(null);
        }
        void persistGraph(nextState.graph);
      },
    });
  };

  const handleMoveNode = (id: string, position: { x: number; y: number }) => {
    const nextState = applyGraphCommand(graphHistory, { kind: "moveNode", nodeId: id, position });
    const next = nextState.graph;
    const updates = buildGraphPositionUpdates(graph, next);
    if (updates.length === 0) return;
    setGraphHistory(nextState);
    schedulePositionSave(updates);
  };

  const handleConnect = (from: string, to: string) => {
    const nextState = applyGraphCommand(graphHistory, { kind: "connect", from, to });
    if (nextState === graphHistory) return;
    setGraphHistory(nextState);
    void persistGraph(nextState.graph);
  };

  const handleDeleteNodes = (nodeIds: string[]) => {
    const uniqueIds = Array.from(new Set(nodeIds));
    const nodes = uniqueIds.map((id) => findNode(graph, id)).filter((node) => node != null);
    if (nodes.length === 0) return;

    const label = nodes.length === 1
      ? t("script.node.singleLabel", { title: nodes[0].title })
      : t("script.node.multipleLabel", { count: nodes.length });
    const affected = referencesAffectedByNodeDeletion(project.content.manifest, uniqueIds);
    const referenceWarning = affected.length > 0
      ? t("script.node.referencesAffected", {
        references: affected.map((item) => `${item.registry}:${item.id}`).join("、"),
      })
      : "";
    setConfirm({
      message: t("script.node.deleteConfirm", { label, warning: referenceWarning }),
      onConfirm: () => void performDeleteNodes(uniqueIds),
    });
  };

  const performDeleteNodes = async (uniqueIds: string[]) => {
    const { graph: next, removedFiles } = removeNodes(graph, uniqueIds);
    if (next === graph) return;
    const removedFileRevisions = new Map<string, FileRevision | null | undefined>();
    await Promise.all(removedFiles.map(async (removedFile) => {
      const revision = await loadNodeDetail(project, removedFile, _refreshKey)
        .then((detail) => detail.revision)
        .catch(() => project.nodeRevisions?.[removedFile]);
      removedFileRevisions.set(removedFile, revision);
    }));
    setGraphHistory(applyGraphCommand(graphHistory, { kind: "removeNodes", nodeIds: uniqueIds }));
    if (selectedNodeId && uniqueIds.includes(selectedNodeId)) {
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      onReplaceWithGraph();
    }

    const saved = await persistGraph(next);
    if (!saved) return;

    for (const removedFile of removedFiles) {
      try {
        await deleteFile(project.path, removedFile, removedFileRevisions.get(removedFile));
      } catch (error) {
        console.warn("删除节点文件失败（图已更新）:", error);
      }
    }
  };

  const handleDeleteEdge = (edgeId: string) => {
    const nextState = applyGraphCommand(graphHistory, { kind: "removeEdge", edgeId });
    if (nextState === graphHistory) return;
    if (selectedEdgeId === edgeId) setSelectedEdgeId(null);
    setGraphHistory(nextState);
    void persistGraph(nextState.graph);
  };

  const handleUpdateOutgoingEdges = (nodeId: string, edges: ProjectGraph["edges"]) => {
    const nextState = applyGraphCommand(graphHistory, { kind: "replaceOutgoingEdges", nodeId, edges });
    if (nextState === graphHistory) return;
    setGraphHistory(nextState);
    void persistGraph(nextState.graph);
  };

  // Phase 7：复制节点 —— 复制图结构 + 复制源节点文件内容到新文件
  const handleDuplicateNode = async (nodeId: string) => {
    const source = findNode(graph, nodeId);
    if (!source) return;
    const { graph: next, newNode } = duplicateNode(graph, nodeId);
    if (!newNode) return;

    setSavingGraph(true);
    setGraphStatus(null);
    try {
      const sourceDetail = await loadNodeDetail(project, source.file, _refreshKey);
      const content = JSON.stringify(sourceDetail.data, null, 2);
      replaceGraph(next);
      setSelectedNodeId(newNode.id);
      setSelectedEdgeId(null);
      const result = await persistCreatedNodeWithCompensation({
        projectPath: project.path,
        nodeFile: newNode.file,
        content,
        graph: next,
        saveFileFn: saveFile,
        persistGraphFn: persistGraph,
        deleteFileFn: deleteFile,
      });
      if (!result.saved) {
        setGraphHistory(graphHistory);
        setSelectedNodeId(nodeId);
        if (!result.rolledBack) {
          setGraphStatus(statusError(t("script.graph.saveFailedKept", {
            kind: t("script.node.duplicatedKind"),
            detail: result.rollbackError instanceof Error ? result.rollbackError.message : String(result.rollbackError),
          })));
        }
      }
    } catch (error) {
      setGraphStatus(statusError(t("script.node.duplicateFailed", {
        detail: error instanceof Error ? error.message : String(error),
      })));
    } finally {
      setSavingGraph(false);
    }
  };

  // Phase 7：创建后续节点 —— 建空文件 + 连边
  const handleCreateSuccessor = async (nodeId: string) => {
    const { graph: next, newNode } = createSuccessor(graph, nodeId);
    if (!newNode) return;

    setSavingGraph(true);
    setGraphStatus(null);
    try {
      replaceGraph(next);
      setSelectedNodeId(newNode.id);
      setSelectedEdgeId(null);
      const result = await persistCreatedNodeWithCompensation({
        projectPath: project.path,
        nodeFile: newNode.file,
        content: "[]",
        graph: next,
        saveFileFn: saveFile,
        persistGraphFn: persistGraph,
        deleteFileFn: deleteFile,
      });
      if (!result.saved) {
        setGraphHistory(graphHistory);
        setSelectedNodeId(nodeId);
        if (!result.rolledBack) {
          setGraphStatus(statusError(t("script.graph.saveFailedKept", {
            kind: t("script.node.newKind"),
            detail: result.rollbackError instanceof Error ? result.rollbackError.message : String(result.rollbackError),
          })));
        }
      }
    } catch (error) {
      setGraphStatus(statusError(t("script.node.successorFailed", {
        detail: error instanceof Error ? error.message : String(error),
      })));
    } finally {
      setSavingGraph(false);
    }
  };

  // Phase 7：重命名（走 PromptDialog）
  const handleRenameNodeDialog = (nodeId: string) => {
    const node = findNode(graph, nodeId);
    if (!node) return;
    setPrompt({
      title: t("script.node.rename"),
      label: t("script.node.title"),
      initialValue: node.title,
      onConfirm: (value) => {
        const nextState = applyGraphCommand(graphHistory, { kind: "renameNode", nodeId, title: value });
        if (nextState === graphHistory) return;
        setGraphHistory(nextState);
        void persistGraph(nextState.graph);
      },
    });
  };

  // Phase 8：设为入口节点
  const handleSetEntry = (nodeId: string) => {
    const nextState = applyGraphCommand(graphHistory, { kind: "setEntryNode", nodeId });
    if (nextState === graphHistory) return;
    setGraphHistory(nextState);
    void persistGraph(nextState.graph);
  };

  const handleManageEnding = (nodeId: string) => {
    const linked = endingsForNode(project.content.manifest, nodeId);
    setPrompt({
      title: linked.length > 0
        ? t("script.ending.linked", { ids: linked.map(([id]) => id).join(", ") })
        : t("script.ending.register"),
      label: t("script.ending.idLabel"),
      initialValue: linked[0]?.[0] ?? "",
      onConfirm: (id) => {
        if (linked.some(([existing]) => existing === id)) return;
        try {
          const next = registerEnding(project.content.manifest, { id, title: findNode(graph, nodeId)?.title ?? id, nodeId });
          void saveManifest(project.path, next, project.manifestRevision)
            .then(() => { setGraphStatus(statusOk(t("script.ending.saved"))); onSaved(); })
            .catch((error) => setGraphStatus(statusError(t("script.ending.saveFailed", {
              detail: error instanceof Error ? error.message : String(error),
            }))));
        } catch (error) {
          setGraphStatus(statusError(t("script.ending.saveFailed", {
            detail: error instanceof Error ? error.message : String(error),
          })));
        }
      },
    });
  };
  const handleVariablesChange = (variables: typeof project.content.variables) => {
    void saveVariables(project.path, variables, project.variablesRevision)
      .then(() => { setGraphStatus(statusOk(t("script.variables.saved"))); onSaved(); })
      .catch((error) => setGraphStatus(statusError(t("script.variables.saveFailed", {
        detail: error instanceof Error ? error.message : String(error),
      }))));
  };
  const handleRenameVariable = (from: string, to: string) => {
    // 后端一次性改写注册表、图条件与 set 指令；成功后整份项目重新加载。
    void renameVariable(project.path, from, to)
      .then((result) => {
        setGraphStatus(statusOk(t("script.variables.renamed", {
          conditions: result.updatedConditions,
          nodes: result.updatedNodes,
        })));
        onSaved();
      })
      .catch((error) => setGraphStatus(statusError(t("script.variables.renameFailed", {
        detail: error instanceof Error ? error.message : String(error),
      }))));
  };
  const handleEditEnding = (endingId: string) => {
    const ending = project.content.manifest.unlocks.endings[endingId];
    if (!ending) return;
    setPrompt({ title: t("script.ending.edit", { id: endingId }), label: t("script.node.title"), initialValue: ending.title, onConfirm: (title) => {
      const next = upsertEnding(project.content.manifest, { id: endingId, title, nodeId: ending.nodeId });
      void saveManifest(project.path, next, project.manifestRevision)
        .then(onSaved)
        .catch((error) => setGraphStatus(statusError(t("script.ending.updateFailed", {
          detail: error instanceof Error ? error.message : String(error),
        }))));
    } });
  };
  const handleUnregisterEnding = (endingId: string) => {
    setConfirm({ message: t("script.ending.unregisterConfirm", { id: endingId }), danger: true, onConfirm: () => {
      void saveManifest(project.path, unregisterEnding(project.content.manifest, endingId), project.manifestRevision)
        .then(onSaved)
        .catch((error) => setGraphStatus(statusError(t("script.ending.unregisterFailed", {
          detail: error instanceof Error ? error.message : String(error),
        }))));
    } });
  };
  const handleInsertEndingCompletion = async (nodeId: string, endingId: string) => {
    const node = findNode(graph, nodeId);
    if (!node) return;
    try {
      const detail = await loadNodeDetail(project, node.file, _refreshKey);
      if (!Array.isArray(detail.data)) throw new Error(t("script.ending.invalidNode"));
      const next = insertEndingCompletion(detail.data as never[], endingId);
      await saveNode(project.path, node.file, next, detail.revision);
      onSaved();
    } catch (error) {
      setGraphStatus(statusError(t("script.ending.insertFailed", {
        detail: error instanceof Error ? error.message : String(error),
      })));
    }
  };

  // Phase 9：自动排布（确定性分层）后一次性落盘
  const handleAutoLayout = () => {
    const nextState = applyGraphCommand(graphHistory, { kind: "autoLayout" });
    const next = nextState.graph;
    if (
      next.nodes.every((node, idx) => {
        const previous = graph.nodes[idx]?.position;
        return previous && node.position.x === previous.x && node.position.y === previous.y;
      })
    ) {
      return;
    }
    setGraphHistory(nextState);
    setGraphLocateToken((current) => current + 1);
    void persistGraph(next);
  };

  const handleUndo = useCallback(() => {
    const nextState = undoGraphHistory(graphHistory);
    if (nextState === graphHistory) return;
    setGraphHistory(nextState);
    setGraphLocateToken((current) => current + 1);
    void persistGraph(nextState.graph);
  }, [graphHistory, persistGraph]);

  const handleRedo = useCallback(() => {
    const nextState = redoGraphHistory(graphHistory);
    if (nextState === graphHistory) return;
    setGraphHistory(nextState);
    setGraphLocateToken((current) => current + 1);
    void persistGraph(nextState.graph);
  }, [graphHistory, persistGraph]);

  // 图视图快捷键：Ctrl/Cmd+Z 撤销，Ctrl+Shift+Z / Ctrl+Y 重做。
  // 弹窗打开时不拦截；输入控件内的按键留给文本编辑自身的撤销栈。
  useEffect(() => {
    if (view !== "graph" || confirm || prompt) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const action = resolveUndoRedoShortcut({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        targetIsEditable: isEditableEventTarget(event.target),
      });
      if (!action) return;
      event.preventDefault();
      if (action === "undo") {
        handleUndo();
      } else {
        handleRedo();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [view, confirm, prompt, handleUndo, handleRedo]);

  return (
    <div style={containerStyle}>
      <div className="gs-script-header">
        <Breadcrumb
          view={view}
          selectedNodeTitle={selectedNode?.title ?? null}
          onBackToGraph={onOpenGraph}
        />
        {view === "graph" && (
          <div className="gs-script-views" role="tablist" aria-label={t("script.views")} onKeyDown={handleViewKeyDown}>
            <button
              type="button"
              role="tab"
              id="script-tab-flow"
              aria-selected={primaryView === "flow"}
              aria-controls="script-tabpanel"
              tabIndex={primaryView === "flow" ? 0 : -1}
              className={primaryView === "flow" ? "gs-tab gs-tab--pane gs-tab--active" : "gs-tab gs-tab--pane"}
              onClick={() => setPrimaryView("flow")}
            >
              {t("script.view.flow")}
            </button>
            <button
              type="button"
              role="tab"
              id="script-tab-state"
              aria-selected={primaryView === "state"}
              aria-controls="script-tabpanel"
              tabIndex={primaryView === "state" ? 0 : -1}
              className={primaryView === "state" ? "gs-tab gs-tab--pane gs-tab--active" : "gs-tab gs-tab--pane"}
              onClick={() => setPrimaryView("state")}
            >
              {t("script.view.state")}
            </button>
            <button
              type="button"
              role="tab"
              id="script-tab-translation"
              aria-selected={primaryView === "translation"}
              aria-controls="script-tabpanel"
              tabIndex={primaryView === "translation" ? 0 : -1}
              className={primaryView === "translation" ? "gs-tab gs-tab--pane gs-tab--active" : "gs-tab gs-tab--pane"}
              onClick={() => setPrimaryView("translation")}
            >
              {t("script.view.translation")}
            </button>
          </div>
        )}
      </div>
      <div
        style={contentStyle}
        role={view === "graph" ? "tabpanel" : undefined}
        id={view === "graph" ? "script-tabpanel" : undefined}
        aria-labelledby={view === "graph" ? `script-tab-${primaryView}` : undefined}
      >
        {blockingFullNodeData && allNodeData.loading ? (
            <WorkspaceDataState message={t("script.loading.fullNodes")} />
          ) : blockingFullNodeData && allNodeData.error ? (
            <WorkspaceDataState message={t("script.loading.fullNodesFailed", { detail: allNodeData.error })} error />
          ) : view === "graph" && primaryView === "translation" ? (
          <TranslationComparison
            project={{ ...project, graph, nodes: allNodeData.entries }}
            onAssignKey={async (row, textKey) => {
              const node = graph.nodes.find((candidate) => candidate.id === row.nodeId);
              if (!node) throw new Error(t("script.translation.nodeMissing"));
              const detail = await loadNodeDetail(project, node.file, _refreshKey);
              const instructions = assignInstructionTextKey(detail.data, row.instructionIndex, textKey);
              if (!instructions) throw new Error(t("script.translation.nodeChanged"));
              await saveNode(project.path, node.file, instructions, detail.revision);
              onSaved();
            }}
            onSaveLocale={async (locale, value: LocaleTable) => {
              const existing = project.locales?.find((entry) => entry.locale === locale);
              const expectedRevision = existing ? existing.revision : null;
              if (existing && !expectedRevision) {
                throw new Error(t("script.translation.revisionMissing"));
              }
              await saveLocale(project.path, locale, value, expectedRevision);
              onSaved();
            }}
          />
        ) : view === "graph" && primaryView === "state" ? (
          <StoryStateView
            graph={graph}
            nodes={allNodeData.entries}
            manifest={project.content.manifest}
            registry={project.content.variables}
            onChange={handleVariablesChange}
            onRename={handleRenameVariable}
            onOpenNode={handleOpenNodeAtInstruction}
            onSelectEdge={(edgeId) => { setPrimaryView("flow"); handleSelectEdge(edgeId); }}
          />
        ) : view === "graph" ? (
          <div className="gs-graph-layout" style={graphLayoutStyle}>
            <div style={outlinePaneStyle}>
              <CollapsibleSidebar
                title={t("script.sidebar.story")}
                collapsed={outlineCollapsed}
                onCollapsedChange={onOutlineCollapsedChange}
                expandedWidth={280}
                collapsedLabel={t("script.sidebar.chapters")}
              >
                <StoryOutline
                  graph={graph}
                  nodeEntries={outlineSearchActive ? allNodeData.entries : undefined}
                  loadingNodeEntries={outlineSearchActive && allNodeData.loading}
                  nodeEntriesError={outlineSearchActive ? allNodeData.error : null}
                  onSearchActiveChange={setOutlineSearchActive}
                  manifest={project.content.manifest}
                  scope={chapterScope}
                  selectedNodeId={selectedNodeId}
                  onScopeChange={handleChapterScopeChange}
                  onSelectNode={handleSelect}
                  onSelectEdge={handleSelectEdge}
                  onCreateNode={() => void handleCreateNode()}
                  onCreateChapter={handleCreateChapter}
                  onRenameChapter={handleRenameChapter}
                  onMoveChapter={handleMoveChapter}
                  onDeleteChapter={handleDeleteChapter}
                />
              </CollapsibleSidebar>
            </div>
            <div style={canvasPaneStyle}>
              <div style={canvasColumnStyle}>
                <div style={toolbarStyle}>
                  <Button variant="primary" onClick={() => handleCreateNode()} disabled={savingGraph}>
                    <Plus size={15} />
                    {t("script.createNode")}
                  </Button>
                  <span style={scopeIndicatorStyle}>
                    <Layers3 size={14} />
                    {chapterScope.kind === "all"
                      ? t("script.globalView")
                      : graph.chapters.find((chapter) => chapter.id === chapterScope.chapterId)?.title ?? t("script.chapter")}
                  </span>
                  <Button onClick={() => setCoverageOpen((open) => !open)} aria-expanded={coverageOpen}>
                    {t("script.routeCoverage")}
                  </Button>
                  <div style={toolbarSpacerStyle} />
                  {graphStatus && (
                    <span
                      style={{
                        ...statusTextStyle,
                        color: statusSeverityColor(graphStatus.severity),
                      }}
                    >
                      {graphStatus.message}
                    </span>
                  )}
                </div>
                {coverageOpen && (
                  <RouteCoveragePanel
                    graph={graph}
                    nodeEntries={allNodeData.entries}
                    manifest={project.content.manifest}
                    registry={project.content.variables}
                    onSelectNode={handleSelect}
                  />
                )}
                <GraphCanvas
                  graph={graph}
                  visibleNodeIds={visibleNodeIds}
                  graphReport={graphReport}
                  nodeSummaries={nodeCreatorSummaries}
                  manifest={project.content.manifest}
                  variables={project.content.variables}
                  selectedNodeId={selectedNodeId}
                  selectedEdgeId={selectedEdgeId}
                  locateSelectedNodeToken={graphLocateToken}
                  canUndo={graphHistory.canUndo}
                  canRedo={graphHistory.canRedo}
                  onSelect={handleSelect}
                  onSelectEdge={handleSelectEdge}
                  onEnter={handleEnter}
                  onMoveNode={handleMoveNode}
                  onConnect={handleConnect}
                  onDeleteNodes={handleDeleteNodes}
                  onDeleteEdge={handleDeleteEdge}
                  onUndo={handleUndo}
                  onRedo={handleRedo}
                  onCreateNodeAt={(position) => handleCreateNode(position)}
                  onDuplicateNode={handleDuplicateNode}
                  onCreateSuccessor={handleCreateSuccessor}
                  onRenameNode={handleRenameNodeDialog}
                  onSetEntry={handleSetEntry}
                  onManageEnding={handleManageEnding}
                  onAutoLayout={handleAutoLayout}
                  onOpenShortcutsHelp={onOpenShortcutsHelp}
                />
              </div>
            </div>
            <div className="gs-graph-layout__inspector" style={inspectorPaneStyle}>
              <div style={inspectorContentStyle}>
                <NodeInspector
                  graph={graph}
                  nodeSummaries={project.nodeSummaries}
                  selectedNodeId={selectedNodeId}
                  onEnter={handleEnter}
                  onRename={handleRenameNode}
                  onSetChapter={handleSetNodeChapter}
                  onUpdateOutgoingEdges={handleUpdateOutgoingEdges}
                  onSetEntry={handleSetEntry}
                  onCreateNode={() => void handleCreateNode()}
                  saving={savingGraph}
                  variables={project.content.variables}
                  manifest={project.content.manifest}
                  onRegisterEnding={handleManageEnding}
                  onEditEnding={handleEditEnding}
                  onUnregisterEnding={handleUnregisterEnding}
                  onInsertEndingCompletion={handleInsertEndingCompletion}
                />
              </div>
            </div>
          </div>
        ) : (
          editorNode && (
            selectedNodeDetail.loading && !editorDetail ? (
              <WorkspaceDataState message={t("script.loading.node")} />
            ) : selectedNodeDetail.error && !editorDetail ? (
              <WorkspaceDataState message={t("script.loading.nodeFailed", { detail: selectedNodeDetail.error })} error />
            ) : editorDetail ? (
              <NodeEditor
                key={`${editorNode.id}:${editorDetail.revision.mtimeMs}:${editorDetail.revision.size}`}
                project={project}
                rendererId={rendererId}
                node={editorNode}
                nodeData={editorDetail.data}
                nodeText={editorDetail.text}
                nodeRevision={editorDetail.revision}
                externalChange={activeNodeChange}
                focusRequest={localFocus ?? focusRequest}
                outgoingEdges={graph.edges.filter((edge) => edge.from === editorNode.id)}
                onUpdateOutgoingEdges={(edges) => handleUpdateOutgoingEdges(editorNode.id, edges)}
                onSaved={onSaved}
                onDirtyChange={handleNodeDirtyChange}
                onExternalChangeResolved={handleExternalChangeResolved}
              />
            ) : null
          )
        )}
      </div>

      {/* Phase 7：自绘弹窗（替换 window.confirm / prompt） */}
      {confirm && (
        <ConfirmDialog
          message={confirm.message}
          danger={confirm.danger ?? true}
          confirmLabel={confirm.confirmLabel ?? t("script.delete")}
          onConfirm={confirm.onConfirm}
          onClose={() => setConfirm(null)}
        />
      )}
      {prompt && (
        <PromptDialog
          title={prompt.title}
          label={prompt.label}
          initialValue={prompt.initialValue}
          allowUnchanged={prompt.allowUnchanged}
          onConfirm={prompt.onConfirm}
          onClose={() => setPrompt(null)}
        />
      )}
    </div>
  );
}

export function nodeFileForEditorRoute({
  location,
  projectPath,
  selectedNodeFile,
  retainedNode,
}: {
  location: ScriptWorkspaceLocation;
  projectPath: string;
  selectedNodeFile?: string;
  retainedNode: {
    projectPath: string;
    nodeId: string;
    nodeFile: string;
  } | null;
}): string {
  if (location.view !== "node") return "";
  if (
    retainedNode?.projectPath === projectPath
    && retainedNode.nodeId === location.nodeId
  ) {
    return retainedNode.nodeFile;
  }
  return selectedNodeFile ?? "";
}

export function projectChangeAfterResolution({
  payload,
  resolved,
  nodeFile,
}: {
  payload: ProjectChangedPayload | null | undefined;
  resolved: ResolvedNodeChange | null;
  nodeFile: string;
}): ProjectChangedPayload | null | undefined {
  if (
    payload
    && resolved?.payload === payload
    && resolved.nodeFile === nodeFile
  ) {
    return null;
  }
  return payload;
}

export function editorSnapshotAfterRefresh({
  current,
  incoming,
  dirty,
  externalChange,
}: {
  current: NodeDetail | null;
  incoming: NodeDetail | null;
  dirty: boolean;
  externalChange: ReturnType<typeof resolveNodeExternalChange>;
}): NodeDetail | null {
  if ((dirty || externalChange) && current) return current;
  return incoming;
}

export const nodeExternalChange = resolveNodeExternalChange;

function WorkspaceDataState({ message, error = false }: { message: string; error?: boolean }) {
  return (
    <div role={error ? "alert" : "status"} style={workspaceDataStateStyle(error)}>
      {message}
    </div>
  );
}

const workspaceDataStateStyle = (error: boolean): React.CSSProperties => ({
  display: "grid",
  placeItems: "center",
  minHeight: 120,
  padding: "var(--space-6)",
  color: error ? "var(--status-error-text)" : "var(--text-muted)",
  textAlign: "center",
});

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

const scopeIndicatorStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-1)",
  padding: "var(--space-1) var(--space-2)",
  borderRadius: "var(--radius-pill)",
  background: "var(--bg-panel)",
  color: "var(--text-muted)",
  fontSize: "var(--text-sm)",
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
  flexWrap: "wrap",
  alignItems: "center",
  gap: "var(--space-2)",
  minHeight: 48,
  padding: "var(--space-2) var(--space-3)",
  borderBottom: "1px solid var(--border)",
  background: "var(--bg-app)",
};

const toolbarSpacerStyle: React.CSSProperties = {
  flex: 1,
};

const statusTextStyle: React.CSSProperties = {
  fontSize: "var(--text-sm)",
};

const inspectorPaneStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  overflow: "hidden",
  borderLeft: "1px solid var(--border)",
};

const inspectorContentStyle: React.CSSProperties = {
  minHeight: 0,
  flex: 1,
};
