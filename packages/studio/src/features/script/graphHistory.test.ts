import { describe, expect, it } from "vitest";
import type { ProjectGraph } from "../../lib/types";
import {
  applyGraphCommand,
  createGraphHistoryState,
  makeGraphRevisionToken,
  reconcileGraphHistory,
  redoGraphHistory,
  undoGraphHistory,
} from "./graphHistory";

const baseGraph: ProjectGraph = {
  version: 1,
  entryNodeId: "start",
  nodes: [
    { id: "start", title: "Start", file: "nodes/start.json", position: { x: 0, y: 0 } },
    { id: "middle", title: "Middle", file: "nodes/middle.json", position: { x: 240, y: 0 } },
    { id: "ending", title: "Ending", file: "nodes/ending.json", position: { x: 480, y: 0 } },
  ],
  edges: [
    { id: "start__middle", from: "start", to: "middle", mode: "linear", label: null, condition: null },
    { id: "middle__ending", from: "middle", to: "ending", mode: "linear", label: null, condition: null },
  ],
};

const revision = makeGraphRevisionToken({ relPath: "content/graph.json", mtimeMs: 1, size: 10, sha256: "a" });

describe("graphHistory", () => {
  it("undoRedoGraphCommandRestoresPreviousGraph", () => {
    let state = createGraphHistoryState(baseGraph, revision);

    state = applyGraphCommand(state, {
      kind: "addNode",
      id: "bonus",
      title: "Bonus",
      file: "nodes/bonus.json",
      position: { x: 720, y: 0 },
    });
    state = applyGraphCommand(state, { kind: "connect", from: "ending", to: "bonus" });
    state = applyGraphCommand(state, { kind: "renameNode", nodeId: "middle", title: "Mid" });
    state = applyGraphCommand(state, { kind: "moveNode", nodeId: "bonus", position: { x: 720, y: 120 } });
    state = applyGraphCommand(state, { kind: "removeEdge", edgeId: "middle__ending" });
    state = applyGraphCommand(state, { kind: "setEntryNode", nodeId: "middle" });
    state = applyGraphCommand(state, { kind: "autoLayout" });

    const afterCommands = state.graph;

    for (let index = 0; index < 7; index += 1) {
      state = undoGraphHistory(state);
    }
    expect(state.graph).toEqual(baseGraph);
    expect(state.canUndo).toBe(false);
    expect(state.canRedo).toBe(true);

    for (let index = 0; index < 7; index += 1) {
      state = redoGraphHistory(state);
    }
    expect(state.graph).toEqual(afterCommands);
    expect(state.canUndo).toBe(true);
    expect(state.canRedo).toBe(false);
  });

  it("undoStackClearsAfterNewCommand", () => {
    let state = createGraphHistoryState(baseGraph, revision);

    state = applyGraphCommand(state, { kind: "renameNode", nodeId: "start", title: "Prologue" });
    state = applyGraphCommand(state, { kind: "moveNode", nodeId: "middle", position: { x: 300, y: 40 } });

    state = undoGraphHistory(state);
    expect(state.canRedo).toBe(true);

    state = applyGraphCommand(state, { kind: "setEntryNode", nodeId: "middle" });
    expect(state.canRedo).toBe(false);
    expect(state.graph.entryNodeId).toBe("middle");
  });

  it("undoStackDoesNotApplyAcrossGraphRevisionChange", () => {
    let state = createGraphHistoryState(baseGraph, revision);
    state = applyGraphCommand(state, { kind: "renameNode", nodeId: "start", title: "Prologue" });

    const externalGraph: ProjectGraph = {
      ...baseGraph,
      nodes: baseGraph.nodes.map((node) => (node.id === "middle" ? { ...node, title: "Externally Changed" } : node)),
    };

    state = reconcileGraphHistory(
      state,
      externalGraph,
      makeGraphRevisionToken({ relPath: "content/graph.json", mtimeMs: 2, size: 12, sha256: "b" }),
    );

    expect(state.graph).toEqual(externalGraph);
    expect(state.canUndo).toBe(false);
    expect(state.canRedo).toBe(false);
    expect(undoGraphHistory(state)).toEqual(state);
  });

  it("preservesUndoStackAcrossSelfSaveRefreshWhenGraphDidNotChange", () => {
    let state = createGraphHistoryState(baseGraph, revision);
    state = applyGraphCommand(state, { kind: "renameNode", nodeId: "start", title: "Prologue" });
    const changedGraph = state.graph;

    state = reconcileGraphHistory(
      state,
      changedGraph,
      makeGraphRevisionToken({ relPath: "content/graph.json", mtimeMs: 3, size: 14, sha256: "c" }),
    );

    expect(state.canUndo).toBe(true);
    expect(state.canRedo).toBe(false);
    expect(undoGraphHistory(state).graph).toEqual(baseGraph);
  });
});
