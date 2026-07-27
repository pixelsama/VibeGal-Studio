import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Layers3, Plus } from "lucide-react";
import { deleteFile, renameVariable, saveFile, saveGraph, saveGraphPositions, saveLocale, saveManifest, saveVariables, saveNode } from "../../lib/tauri";
import { Button } from "../common/Button";
import { isEditableEventTarget, resolveUndoRedoShortcut } from "./graphShortcuts";
import type { FileRevision, GraphIssueFocusRequest, GraphPositionPatch, LocaleTable, ProjectData, ProjectGraph } from "../../lib/types";
import { CollapsibleSidebar } from "../common/CollapsibleSidebar";
import { Breadcrumb } from "./Breadcrumb";
import { GraphCanvas } from "./GraphCanvas";
import { StoryStateView } from "./StoryStateView";
import { TranslationComparison } from "./TranslationComparison";
import { assignInstructionTextKey } from "./translationModel";
import { RouteCoveragePanel } from "./RouteCoveragePanel";
import { NodeInspector } from "./NodeInspector";
import { NodeEditor } from "./NodeEditor";
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
  createGraphHistoryState,
  makeGraphRevisionToken,
  reconcileGraphHistory,
  redoGraphHistory,
  undoGraphHistory,
} from "./graphHistory";
import { findNode, findNodeData } from "./graphMapping";
import { RevisionedProjectMutationQueue } from "../../lib/projectMutation";
import { preventUnloadWhenDirty } from "./unsavedChanges";
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
  onDirtyChange?: (dirty: boolean) => void;
}

export type ScriptWorkspaceLocation =
  | { view: "graph" }
  | { view: "node"; nodeId: string };

const EMPTY_GRAPH = {
  version: 1,
  entryNodeId: "",
  chapters: [{ id: "chapter_1", title: "第一章" }],
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

export function takePendingGraphPositionUpdates(
  pending: Map<string, { x: number; y: number }>,
): GraphPositionPatch[] {
  const updates = Array.from(pending, ([id, position]) => ({ id, position }));
  pending.clear();
  return updates;
}

interface PersistCreatedNodeWithCompensationParams {
  projectPath: string;
  nodeFile: string;
  content: string;
  graph: ProjectGraph;
  saveFileFn: (
    projectPath: string,
    relPath: string,
    content: string,
    expectedRevision?: FileRevision | null,
  ) => Promise<FileRevision | null>;
  persistGraphFn: (graph: ProjectGraph) => Promise<boolean>;
  deleteFileFn: (
    projectPath: string,
    relPath: string,
    expectedRevision?: FileRevision | null,
  ) => Promise<void>;
}

export type PersistCreatedNodeWithCompensationResult =
  | { saved: true; rolledBack: false }
  | { saved: false; rolledBack: true }
  | { saved: false; rolledBack: false; rollbackError: unknown };

export async function persistCreatedNodeWithCompensation({
  projectPath,
  nodeFile,
  content,
  graph,
  saveFileFn,
  persistGraphFn,
  deleteFileFn,
}: PersistCreatedNodeWithCompensationParams): Promise<PersistCreatedNodeWithCompensationResult> {
  const createdRevision = await saveFileFn(projectPath, `content/${nodeFile}`, content);
  if (await persistGraphFn(graph)) {
    return { saved: true, rolledBack: false };
  }
  try {
    await deleteFileFn(projectPath, nodeFile, createdRevision);
    return { saved: false, rolledBack: true };
  } catch (rollbackError) {
    return { saved: false, rolledBack: false, rollbackError };
  }
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
  onDirtyChange,
}: Props) {
  const view = location.view;
  /** 脚本工作台的一级视图：剧情流程 / 故事状态 / 翻译对照。 */
  const [primaryView, setPrimaryView] = useState<"flow" | "state" | "translation">("flow");
  const [coverageOpen, setCoverageOpen] = useState(false);
  const [localFocus, setLocalFocus] = useState<GraphIssueFocusRequest | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [chapterScope, setChapterScope] = useState<ChapterScope>({ kind: "all" });
  const incomingGraph = useMemo(() => project.graph ?? EMPTY_GRAPH, [project.graph]);
  const incomingRevisionToken = useMemo(() => makeGraphRevisionToken(project.graphRevision), [project.graphRevision]);
  const graphReport = useMemo(() => project.graphReport ?? { graphIssues: [] }, [project.graphReport]);
  const [graphHistory, setGraphHistory] = useState(() => createGraphHistoryState(incomingGraph, incomingRevisionToken));
  const graph = graphHistory.graph;
  const [savingGraph, setSavingGraph] = useState(false);
  const [positionSavePending, setPositionSavePending] = useState(false);
  const [graphStatus, setGraphStatus] = useState("");
  const [confirm, setConfirm] = useState<{
    message: string;
    onConfirm: () => void;
    confirmLabel?: string;
    danger?: boolean;
  } | null>(null);
  const [prompt, setPrompt] = useState<{ title: string; label?: string; initialValue?: string; onConfirm: (v: string) => void } | null>(null);
  const positionSaveTimerRef = useRef<number | null>(null);
  const pendingPositionUpdatesRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const graphMutationQueue = useMemo(
    () => new RevisionedProjectMutationQueue(project.graphRevision),
    [project.path],
  );
  const activeNodeId = location.view === "node" ? location.nodeId : selectedNodeId;
  const selectedNode = useMemo(() => findNode(graph, activeNodeId), [activeNodeId, graph]);
  const scopedGraph = useMemo(() => graphForChapterScope(graph, chapterScope), [chapterScope, graph]);
  const visibleNodeIds = useMemo(() => new Set(scopedGraph.nodes.map((node) => node.id)), [scopedGraph.nodes]);

  useEffect(() => {
    setGraphHistory((current) => reconcileGraphHistory(current, incomingGraph, incomingRevisionToken));
    setGraphStatus("");
  }, [incomingGraph, incomingRevisionToken]);

  useEffect(() => {
    setChapterScope((current) => normalizeChapterScope(graph, current));
  }, [graph]);

  useEffect(() => {
    graphMutationQueue.synchronizeRevision(project.graphRevision);
  }, [graphMutationQueue, project.graphRevision]);

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

  const persistGraph = useCallback(
    async (next: ProjectGraph) => {
      setSavingGraph(true);
      setGraphStatus("");
      try {
        await graphMutationQueue.enqueue((expectedRevision) => (
          saveGraph(project.path, next, expectedRevision)
        ));
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
    [graphMutationQueue, onSaved, project.path],
  );

  const persistGraphPositions = useCallback(
    async (updates: GraphPositionPatch[]) => {
      if (updates.length === 0) return true;
      setSavingGraph(true);
      setGraphStatus("");
      try {
        await graphMutationQueue.enqueue((expectedRevision) => (
          saveGraphPositions(project.path, updates, expectedRevision)
        ));
        setGraphStatus("节点位置已保存");
        onSaved();
        return true;
      } catch (error) {
        setGraphStatus(`保存节点位置失败: ${error instanceof Error ? error.message : String(error)}`);
        return false;
      } finally {
        setSavingGraph(false);
      }
    },
    [graphMutationQueue, onSaved, project.path],
  );

  useEffect(() => {
    return () => {
      if (positionSaveTimerRef.current != null) {
        window.clearTimeout(positionSaveTimerRef.current);
      }
      const pending = takePendingGraphPositionUpdates(pendingPositionUpdatesRef.current);
      if (pending.length === 0) return;
      void graphMutationQueue.enqueue((expectedRevision) => (
        saveGraphPositions(project.path, pending, expectedRevision)
      )).then(() => onSaved()).catch((error) => {
        console.warn("离开页面时保存节点位置失败:", error);
      });
    };
  }, [graphMutationQueue, onSaved, project.path]);

  useEffect(() => {
    if (view !== "graph") return;
    onDirtyChange?.(positionSavePending);
    return () => onDirtyChange?.(false);
  }, [onDirtyChange, positionSavePending, view]);

  useEffect(() => {
    if (!positionSavePending) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      preventUnloadWhenDirty(event, true);
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [positionSavePending]);

  const schedulePositionSave = useCallback(
    (updates: GraphPositionPatch[]) => {
      for (const update of updates) {
        pendingPositionUpdatesRef.current.set(update.id, update.position);
      }
      setPositionSavePending(true);
      if (positionSaveTimerRef.current != null) {
        window.clearTimeout(positionSaveTimerRef.current);
      }
      positionSaveTimerRef.current = window.setTimeout(() => {
        positionSaveTimerRef.current = null;
        const pending = takePendingGraphPositionUpdates(pendingPositionUpdatesRef.current);
        void persistGraphPositions(pending).then((saved) => {
          if (!saved) {
            for (const update of pending) {
              if (!pendingPositionUpdatesRef.current.has(update.id)) {
                pendingPositionUpdatesRef.current.set(update.id, update.position);
              }
            }
          }
          if (pendingPositionUpdatesRef.current.size === 0 && positionSaveTimerRef.current == null) {
            setPositionSavePending(false);
          }
        });
      }, 400);
    },
    [persistGraphPositions],
  );

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
    setGraphStatus("");
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
          setGraphStatus(`图保存失败；新节点文件已保留: ${result.rollbackError instanceof Error ? result.rollbackError.message : String(result.rollbackError)}`);
        }
      }
    } catch (error) {
      setGraphStatus(`新建节点失败: ${error instanceof Error ? error.message : String(error)}`);
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
      title: "新建章节",
      label: "章节名称",
      initialValue: `第 ${graph.chapters.length + 1} 章`,
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
      title: "重命名章节",
      label: "章节名称",
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
      setGraphStatus("项目必须保留至少一个章节");
      return;
    }
    if (nodeCount > 0) {
      setGraphStatus(`请先将「${chapter.title}」中的 ${nodeCount} 个节点移动到其他章节`);
      return;
    }
    const deletingActiveChapter = chapterScope.kind === "chapter" && chapterScope.chapterId === chapterId;
    setConfirm({
      message: `删除空章节「${chapter.title}」？`,
      confirmLabel: "删除章节",
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

    const label =
      nodes.length === 1
        ? `节点「${nodes[0].title}」`
        : `${nodes.length} 个节点`;
    const affected = referencesAffectedByNodeDeletion(project.content.manifest, uniqueIds);
    const referenceWarning = affected.length > 0
      ? `\n受影响的登记引用：${affected.map((item) => `${item.registry}:${item.id}`).join("、")}。这些资源登记条目不会自动删除，保存后校验会标出它们。`
      : "";
    setConfirm({
      message: `确定删除${label}？节点文件也会被删除。${referenceWarning}`,
      onConfirm: () => void performDeleteNodes(uniqueIds),
    });
  };

  const performDeleteNodes = async (uniqueIds: string[]) => {
    const { graph: next, removedFiles } = removeNodes(graph, uniqueIds);
    if (next === graph) return;
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
        await deleteFile(project.path, removedFile, project.nodeRevisions?.[removedFile]);
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
    setGraphStatus("");
    try {
      const sourceData = findNodeData(project.nodes, source.file);
      const content = sourceData == null ? "[]" : JSON.stringify(sourceData, null, 2);
      setGraphHistory(createGraphHistoryState(next, graphHistory.revisionToken));
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
          setGraphStatus(`图保存失败；复制的节点文件已保留: ${result.rollbackError instanceof Error ? result.rollbackError.message : String(result.rollbackError)}`);
        }
      }
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
      setGraphHistory(createGraphHistoryState(next, graphHistory.revisionToken));
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
          setGraphStatus(`图保存失败；新建的后续节点文件已保留: ${result.rollbackError instanceof Error ? result.rollbackError.message : String(result.rollbackError)}`);
        }
      }
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
      title: linked.length > 0 ? `关联结局：${linked.map(([id]) => id).join(", ")}` : "登记为正式结局",
      label: "结局 ID（标题默认使用节点标题）",
      initialValue: linked[0]?.[0] ?? "",
      onConfirm: (id) => {
        if (linked.some(([existing]) => existing === id)) return;
        try {
          const next = registerEnding(project.content.manifest, { id, title: findNode(graph, nodeId)?.title ?? id, nodeId });
          void saveManifest(project.path, next, project.manifestRevision).then(() => { setGraphStatus("结局登记已保存"); onSaved(); }).catch((error) => setGraphStatus(`结局登记失败: ${error instanceof Error ? error.message : String(error)}`));
        } catch (error) { setGraphStatus(`结局登记失败: ${error instanceof Error ? error.message : String(error)}`); }
      },
    });
  };
  const handleVariablesChange = (variables: typeof project.content.variables) => {
    void saveVariables(project.path, variables, project.variablesRevision).then(() => { setGraphStatus("变量声明已保存"); onSaved(); }).catch((error) => setGraphStatus(`变量保存失败: ${error instanceof Error ? error.message : String(error)}`));
  };
  const handleRenameVariable = (from: string, to: string) => {
    // 后端一次性改写注册表、图条件与 set 指令；成功后整份项目重新加载。
    void renameVariable(project.path, from, to)
      .then((result) => {
        setGraphStatus(`已改名：更新了 ${result.updatedConditions} 处判断、${result.updatedNodes} 个节点`);
        onSaved();
      })
      .catch((error) => setGraphStatus(`改名失败: ${error instanceof Error ? error.message : String(error)}`));
  };
  const handleEditEnding = (endingId: string) => {
    const ending = project.content.manifest.unlocks.endings[endingId];
    if (!ending) return;
    setPrompt({ title: `编辑结局 ${endingId}`, label: "标题", initialValue: ending.title, onConfirm: (title) => {
      const next = upsertEnding(project.content.manifest, { id: endingId, title, nodeId: ending.nodeId });
      void saveManifest(project.path, next, project.manifestRevision).then(onSaved).catch((error) => setGraphStatus(`结局更新失败: ${error instanceof Error ? error.message : String(error)}`));
    } });
  };
  const handleUnregisterEnding = (endingId: string) => {
    setConfirm({ message: `取消登记结局 ${endingId}？剧情中的 unlock/completeEnding 指令不会自动删除。`, danger: true, onConfirm: () => {
      void saveManifest(project.path, unregisterEnding(project.content.manifest, endingId), project.manifestRevision).then(onSaved).catch((error) => setGraphStatus(`取消登记失败: ${error instanceof Error ? error.message : String(error)}`));
    } });
  };
  const handleInsertEndingCompletion = (nodeId: string, endingId: string) => {
    const node = findNode(graph, nodeId);
    if (!node) return;
    const data = findNodeData(project.nodes, node.file);
    if (!Array.isArray(data)) return;
    const next = insertEndingCompletion(data as never[], endingId);
    void saveNode(project.path, node.file, next, project.nodeRevisions?.[node.file]).then(onSaved).catch((error) => setGraphStatus(`插入结算失败: ${error instanceof Error ? error.message : String(error)}`));
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
    void persistGraph(next);
  };

  const handleUndo = useCallback(() => {
    const nextState = undoGraphHistory(graphHistory);
    if (nextState === graphHistory) return;
    setGraphHistory(nextState);
    void persistGraph(nextState.graph);
  }, [graphHistory, persistGraph]);

  const handleRedo = useCallback(() => {
    const nextState = redoGraphHistory(graphHistory);
    if (nextState === graphHistory) return;
    setGraphHistory(nextState);
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
      <Breadcrumb
        view={view}
        selectedNodeTitle={selectedNode?.title ?? null}
        onBackToGraph={onOpenGraph}
      />
      {view === "graph" && (
        <div className="gs-script-views" role="tablist" aria-label="脚本视图">
          <button
            type="button"
            role="tab"
            aria-selected={primaryView === "flow"}
            className={primaryView === "flow" ? "gs-tab gs-tab--active" : "gs-tab"}
            onClick={() => setPrimaryView("flow")}
          >
            剧情流程
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={primaryView === "state"}
            className={primaryView === "state" ? "gs-tab gs-tab--active" : "gs-tab"}
            onClick={() => setPrimaryView("state")}
          >
            故事状态
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={primaryView === "translation"}
            className={primaryView === "translation" ? "gs-tab gs-tab--active" : "gs-tab"}
            onClick={() => setPrimaryView("translation")}
          >
            翻译对照
          </button>
        </div>
      )}
      <div style={contentStyle}>
        {view === "graph" && primaryView === "translation" ? (
          <TranslationComparison
            project={{ ...project, graph }}
            onAssignKey={async (row, textKey) => {
              const node = graph.nodes.find((candidate) => candidate.id === row.nodeId);
              const entry = node ? project.nodes?.find((candidate) => candidate.relPath === node.file) : undefined;
              if (!node || !entry) throw new Error("找不到要更新的节点。");
              const instructions = assignInstructionTextKey(entry.data, row.instructionIndex, textKey);
              if (!instructions) throw new Error("节点内容已变化，请刷新后重试。");
              await saveNode(project.path, node.file, instructions, project.nodeRevisions?.[node.file]);
              onSaved();
            }}
            onSaveLocale={async (locale, value: LocaleTable) => {
              const existing = project.locales?.find((entry) => entry.locale === locale);
              const expectedRevision = existing ? existing.revision : null;
              if (existing && !expectedRevision) {
                throw new Error("语言文件版本未知，请刷新项目后重试。");
              }
              await saveLocale(project.path, locale, value, expectedRevision);
              onSaved();
            }}
          />
        ) : view === "graph" && primaryView === "state" ? (
          <StoryStateView
            graph={graph}
            nodes={project.nodes}
            manifest={project.content.manifest}
            registry={project.content.variables}
            onChange={handleVariablesChange}
            onRename={handleRenameVariable}
            onOpenNode={handleOpenNodeAtInstruction}
            onSelectEdge={(edgeId) => { setPrimaryView("flow"); handleSelectEdge(edgeId); }}
          />
        ) : view === "graph" ? (
          <div style={graphLayoutStyle}>
            <div style={outlinePaneStyle}>
              <CollapsibleSidebar
                title="故事结构"
                collapsed={outlineCollapsed}
                onCollapsedChange={onOutlineCollapsedChange}
                expandedWidth={280}
                collapsedLabel="章节"
              >
                <StoryOutline
                  graph={graph}
                  nodeEntries={project.nodes}
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
                    新建节点
                  </Button>
                  <span style={scopeIndicatorStyle}>
                    <Layers3 size={14} />
                    {chapterScope.kind === "all" ? "全局视图" : graph.chapters.find((chapter) => chapter.id === chapterScope.chapterId)?.title ?? "章节"}
                  </span>
                  <Button onClick={() => setCoverageOpen((open) => !open)} aria-expanded={coverageOpen}>
                    剧情覆盖
                  </Button>
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
                {coverageOpen && (
                  <RouteCoveragePanel
                    graph={graph}
                    nodeEntries={project.nodes}
                    manifest={project.content.manifest}
                    registry={project.content.variables}
                    onSelectNode={handleSelect}
                  />
                )}
                <GraphCanvas
                  graph={graph}
                  visibleNodeIds={visibleNodeIds}
                  graphReport={graphReport}
                  nodeEntries={project.nodes}
                  manifest={project.content.manifest}
                  variables={project.content.variables}
                  selectedNodeId={selectedNodeId}
                  selectedEdgeId={selectedEdgeId}
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
                />
              </div>
            </div>
            <div style={inspectorPaneStyle}>
              <div style={inspectorContentStyle}>
                <NodeInspector
                  graph={graph}
                  nodeEntries={project.nodes}
                  selectedNodeId={selectedNodeId}
                  onEnter={handleEnter}
                  onRename={handleRenameNode}
                  onSetChapter={handleSetNodeChapter}
                  onUpdateOutgoingEdges={handleUpdateOutgoingEdges}
                  onSetEntry={handleSetEntry}
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
          selectedNode && (
            <NodeEditor
              key={selectedNode.id}
              project={project}
              rendererId={rendererId}
              node={selectedNode}
              nodeData={findNodeData(project.nodes, selectedNode.file)}
              focusRequest={localFocus ?? focusRequest}
              onSaved={onSaved}
              onDirtyChange={onDirtyChange}
            />
          )
        )}
      </div>

      {/* Phase 7：自绘弹窗（替换 window.confirm / prompt） */}
      {confirm && (
        <ConfirmDialog
          message={confirm.message}
          danger={confirm.danger ?? true}
          confirmLabel={confirm.confirmLabel ?? "删除"}
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
