import type { FileRevision, GraphEdge, ProjectGraph } from "../../lib/types";
import {
  addNode,
  connectNodes,
  moveNode,
  removeEdge,
  removeNodes,
  renameNode,
  replaceNodeOutgoingEdges,
  setEntryNode,
} from "./graphEditing";
import { autoLayoutGraph } from "./graphLayout";

export type GraphCommand =
  | {
    kind: "addNode";
    id: string;
    title: string;
    file: string;
    position?: { x: number; y: number };
  }
  | { kind: "removeNodes"; nodeIds: string[] }
  | {
    kind: "connect";
    from: string;
    to: string;
    options?: Partial<Pick<GraphEdge, "mode" | "label" | "condition">>;
  }
  | { kind: "removeEdge"; edgeId: string }
  | { kind: "renameNode"; nodeId: string; title: string }
  | { kind: "moveNode"; nodeId: string; position: { x: number; y: number } }
  | { kind: "setEntryNode"; nodeId: string }
  | { kind: "autoLayout" }
  | { kind: "replaceOutgoingEdges"; nodeId: string; edges: GraphEdge[] };

export interface GraphHistoryState {
  graph: ProjectGraph;
  revisionToken: string | null;
  undoStack: ProjectGraph[];
  redoStack: ProjectGraph[];
  canUndo: boolean;
  canRedo: boolean;
}

export function makeGraphRevisionToken(revision?: FileRevision | null): string | null {
  if (!revision) return null;
  return JSON.stringify({
    relPath: revision.relPath,
    mtimeMs: revision.mtimeMs,
    size: revision.size,
    sha256: revision.sha256 ?? null,
  });
}

export function createGraphHistoryState(graph: ProjectGraph, revisionToken: string | null): GraphHistoryState {
  return {
    graph,
    revisionToken,
    undoStack: [],
    redoStack: [],
    canUndo: false,
    canRedo: false,
  };
}

export function applyGraphCommand(state: GraphHistoryState, command: GraphCommand): GraphHistoryState {
  const nextGraph = runGraphCommand(state.graph, command);
  if (graphsEqual(nextGraph, state.graph)) return state;

  return withStackState({
    ...state,
    graph: nextGraph,
    undoStack: [...state.undoStack, state.graph],
    redoStack: [],
  });
}

export function undoGraphHistory(state: GraphHistoryState): GraphHistoryState {
  const previous = state.undoStack.at(-1);
  if (!previous) return state;

  return withStackState({
    ...state,
    graph: previous,
    undoStack: state.undoStack.slice(0, -1),
    redoStack: [state.graph, ...state.redoStack],
  });
}

export function redoGraphHistory(state: GraphHistoryState): GraphHistoryState {
  const [next, ...rest] = state.redoStack;
  if (!next) return state;

  return withStackState({
    ...state,
    graph: next,
    undoStack: [...state.undoStack, state.graph],
    redoStack: rest,
  });
}

export function reconcileGraphHistory(
  state: GraphHistoryState,
  incomingGraph: ProjectGraph,
  revisionToken: string | null,
): GraphHistoryState {
  if (graphsEqual(state.graph, incomingGraph)) {
    return withStackState({ ...state, graph: incomingGraph, revisionToken });
  }
  return createGraphHistoryState(incomingGraph, revisionToken);
}

function runGraphCommand(graph: ProjectGraph, command: GraphCommand): ProjectGraph {
  switch (command.kind) {
    case "addNode":
      return addNode(graph, command);
    case "removeNodes":
      return removeNodes(graph, command.nodeIds).graph;
    case "connect":
      return connectNodes(graph, command.from, command.to, command.options);
    case "removeEdge":
      return removeEdge(graph, command.edgeId);
    case "renameNode":
      return renameNode(graph, command.nodeId, command.title);
    case "moveNode":
      return moveNode(graph, command.nodeId, command.position);
    case "setEntryNode":
      return setEntryNode(graph, command.nodeId);
    case "autoLayout":
      return autoLayoutGraph(graph);
    case "replaceOutgoingEdges":
      return replaceNodeOutgoingEdges(graph, command.nodeId, command.edges);
  }
}

function withStackState(state: Omit<GraphHistoryState, "canUndo" | "canRedo">): GraphHistoryState {
  return {
    ...state,
    canUndo: state.undoStack.length > 0,
    canRedo: state.redoStack.length > 0,
  };
}

function graphsEqual(left: ProjectGraph, right: ProjectGraph): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
