import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { saveGraph, saveGraphPositions } from "../../lib/tauri";
import type { GraphPositionPatch, ProjectData, ProjectGraph } from "../../lib/types";
import { RevisionedProjectMutationQueue } from "../../lib/projectMutation";
import { preventUnloadWhenDirty } from "./unsavedChanges";
import {
  createGraphHistoryState,
  makeGraphRevisionToken,
  reconcileGraphHistory,
} from "./graphHistory";
import { takePendingGraphPositionUpdates } from "./scriptWorkspaceOperations";

const EMPTY_GRAPH = {
  version: 1,
  entryNodeId: "",
  chapters: [{ id: "chapter_1", title: "第一章" }],
  nodes: [],
  edges: [],
} satisfies ProjectGraph;

interface UseScriptGraphStateOptions {
  project: ProjectData;
  view: "graph" | "node";
  onSaved: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export function useScriptGraphState({ project, view, onSaved, onDirtyChange }: UseScriptGraphStateOptions) {
  const incomingGraph = useMemo(() => project.graph ?? EMPTY_GRAPH, [project.graph]);
  const incomingRevisionToken = useMemo(() => makeGraphRevisionToken(project.graphRevision), [project.graphRevision]);
  const graphReport = useMemo(() => project.graphReport ?? { graphIssues: [] }, [project.graphReport]);
  const [graphHistory, setGraphHistory] = useState(() => createGraphHistoryState(incomingGraph, incomingRevisionToken));
  const graph = graphHistory.graph;
  const [savingGraph, setSavingGraph] = useState(false);
  const [positionSavePending, setPositionSavePending] = useState(false);
  const [graphStatus, setGraphStatus] = useState("");
  const positionSaveTimerRef = useRef<number | null>(null);
  const pendingPositionUpdatesRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const graphMutationQueue = useMemo(
    () => new RevisionedProjectMutationQueue(project.graphRevision),
    [project.path],
  );

  useEffect(() => {
    setGraphHistory((current) => reconcileGraphHistory(current, incomingGraph, incomingRevisionToken));
    setGraphStatus("");
  }, [incomingGraph, incomingRevisionToken]);

  useEffect(() => {
    graphMutationQueue.synchronizeRevision(project.graphRevision);
  }, [graphMutationQueue, project.graphRevision]);

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

  function replaceGraph(next: ProjectGraph) {
    setGraphHistory(createGraphHistoryState(next, graphHistory.revisionToken));
  }

  return {
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
  };
}
