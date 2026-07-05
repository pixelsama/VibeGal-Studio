import { describe, expect, it } from "vitest";
import type { GraphIssue, NodeEntry, ProjectGraph } from "../../lib/types";
import {
  NODE_TYPE,
  collectDuplicateNodeIds,
  deriveGraphNodeStatus,
  findNode,
  findNodeData,
  issueTargetsNode,
  mapGraphToFlow,
  summarizeNodeConnections,
} from "./graphMapping";

const sampleGraph: ProjectGraph = {
  version: 1,
  entryNodeId: "prologue",
  nodes: [
    {
      id: "prologue",
      title: "序章",
      file: "nodes/prologue.json",
      position: { x: 120, y: 180 },
    },
    {
      id: "first-meeting",
      title: "初遇",
      file: "nodes/first-meeting.json",
      position: { x: 420, y: 180 },
    },
  ],
  edges: [
    {
      id: "prologue__first-meeting",
      from: "prologue",
      to: "first-meeting",
      condition: null,
    },
  ],
};

describe("graphMapping", () => {
  it("mapGraphToFlow maps nodes with position and type", () => {
    const flow = mapGraphToFlow(sampleGraph);

    expect(flow.nodes).toHaveLength(2);
    expect(flow.nodes[0]).toMatchObject({
      id: "prologue",
      type: NODE_TYPE,
      position: { x: 120, y: 180 },
      data: {
        title: "序章",
        fileId: "nodes/prologue.json",
        isEntry: true,
      },
    });
    expect(flow.nodes[1]).toMatchObject({
      id: "first-meeting",
      type: NODE_TYPE,
      position: { x: 420, y: 180 },
      data: {
        title: "初遇",
        fileId: "nodes/first-meeting.json",
        isEntry: false,
      },
    });
  });

  it("mapGraphToFlow marks entry node", () => {
    const flow = mapGraphToFlow(sampleGraph);
    const entryIds = flow.nodes.filter((node) => node.data.isEntry).map((node) => node.id);

    expect(entryIds).toEqual(["prologue"]);
  });

  it("mapGraphToFlow maps edges with smoothstep type", () => {
    const flow = mapGraphToFlow(sampleGraph);

    expect(flow.edges).toEqual([
      {
        id: "prologue__first-meeting",
        source: "prologue",
        target: "first-meeting",
        type: "smoothstep",
        data: { condition: null, mode: "linear" },
      },
    ]);
  });

  it("mapGraphToFlow_labels_choice_edges_from_edge_label", () => {
    const flow = mapGraphToFlow({
      ...sampleGraph,
      edges: [{ ...sampleGraph.edges[0], mode: "choice", label: "继续前进" }],
    });

    expect(flow.edges[0].label).toBe("继续前进");
  });

  it("mapGraphToFlow_marks_choice_exit_node_as_branch", () => {
    const graphWithNonEntryChoice: ProjectGraph = {
      ...sampleGraph,
      entryNodeId: "first-meeting",
      edges: [{ ...sampleGraph.edges[0], mode: "choice", label: "继续前进" }],
    };
    const flow = mapGraphToFlow(graphWithNonEntryChoice);

    expect(flow.nodes.find((node) => node.id === "prologue")?.data.status).toBe("branch");
  });

  it("mapGraphToFlow handles empty graph", () => {
    const flow = mapGraphToFlow({
      version: 1,
      entryNodeId: "",
      nodes: [],
      edges: [],
    });

    expect(flow).toEqual({ nodes: [], edges: [] });
  });

  it("issueTargetsNode returns nodeId for selection", () => {
    const nodeIssue: GraphIssue = {
      severity: "warn",
      code: "missing_node_file",
      message: "节点文件缺失",
      nodeId: "first-meeting",
    };
    const edgeIssue: GraphIssue = {
      severity: "warn",
      code: "dangling_edge",
      message: "边缺少端点",
      edgeId: "prologue__missing",
    };

    expect(issueTargetsNode(nodeIssue)).toBe("first-meeting");
    expect(issueTargetsNode(edgeIssue)).toBeNull();
  });

  it("mapGraphToFlow marks suspicious edges from issues", () => {
    const flow = mapGraphToFlow(sampleGraph, {
      graphIssues: [
        {
          severity: "warn",
          code: "dangling_edge",
          message: "边的端点不存在",
          edgeId: "prologue__first-meeting",
        },
      ],
    });

    expect(flow.edges[0].data).toMatchObject({
      condition: null,
      suspicious: true,
    });
  });

  it("findNode returns node by id", () => {
    expect(findNode(sampleGraph, "first-meeting")).toEqual(sampleGraph.nodes[1]);
    expect(findNode(sampleGraph, "missing")).toBeNull();
    expect(findNode(sampleGraph, null)).toBeNull();
  });

  it("findNodeData locates data by node file", () => {
    const entries: NodeEntry[] = [
      { relPath: "nodes/prologue.json", data: [{ t: "say", text: "hello" }] },
      { relPath: "nodes/first-meeting.json", data: null },
    ];

    expect(findNodeData(entries, "nodes/prologue.json")).toEqual(entries[0].data);
    expect(findNodeData(entries, "nodes/first-meeting.json")).toBeNull();
    expect(findNodeData(entries, "nodes/missing.json")).toBeNull();
    expect(findNodeData(undefined, "nodes/prologue.json")).toBeNull();
  });
});

// ── Phase 8: 节点状态派生 ──────────────────────────────────────

const statusGraph: ProjectGraph = {
  version: 1,
  entryNodeId: "prologue",
  nodes: [
    { id: "prologue", title: "序章", file: "nodes/prologue.json", position: { x: 0, y: 0 } },
    { id: "middle", title: "中段", file: "nodes/middle.json", position: { x: 1, y: 0 } },
    { id: "branch", title: "分支", file: "nodes/branch.json", position: { x: 2, y: 0 } },
    { id: "endA", title: "结局 A", file: "nodes/endA.json", position: { x: 3, y: 0 } },
    { id: "endB", title: "结局 B", file: "nodes/endB.json", position: { x: 3, y: 1 } },
    { id: "lonely", title: "孤立", file: "nodes/lonely.json", position: { x: 0, y: 5 } },
  ],
  edges: [
    { id: "prologue__middle", from: "prologue", to: "middle", condition: null },
    { id: "middle__branch", from: "middle", to: "branch", condition: null },
    { id: "branch__endA", from: "branch", to: "endA", condition: null },
    { id: "branch__endB", from: "branch", to: "endB", condition: null },
  ],
};

describe("deriveGraphNodeStatus", () => {
  it("marks entry node", () => {
    expect(deriveGraphNodeStatus(statusGraph, "prologue")).toBe("entry");
  });

  it("marks node with single outgoing as normal", () => {
    expect(deriveGraphNodeStatus(statusGraph, "middle")).toBe("normal");
  });

  it("marks node with multiple outgoing as branch", () => {
    expect(deriveGraphNodeStatus(statusGraph, "branch")).toBe("branch");
  });

  it("marks node with incoming and no outgoing as ending", () => {
    expect(deriveGraphNodeStatus(statusGraph, "endA")).toBe("ending");
    expect(deriveGraphNodeStatus(statusGraph, "endB")).toBe("ending");
  });

  it("marks fully disconnected non-entry node as orphan", () => {
    expect(deriveGraphNodeStatus(statusGraph, "lonely")).toBe("orphan");
  });

  it("marks missing-file above entry/orphan/ending", () => {
    expect(deriveGraphNodeStatus(statusGraph, "prologue", { hasFile: false })).toBe("missing-file");
    expect(deriveGraphNodeStatus(statusGraph, "lonely", { hasFile: false })).toBe("missing-file");
  });

  it("marks duplicate id above everything", () => {
    const dups = new Set(["prologue"]);
    expect(deriveGraphNodeStatus(statusGraph, "prologue", { duplicateNodeIds: dups })).toBe("duplicate");
    // missing-file + duplicate 同时存在时，duplicate 仍优先
    expect(
      deriveGraphNodeStatus(statusGraph, "prologue", { hasFile: false, duplicateNodeIds: dups }),
    ).toBe("duplicate");
  });

  it("entry beats orphan for a single-node graph", () => {
    const single: ProjectGraph = {
      version: 1,
      entryNodeId: "only",
      nodes: [{ id: "only", title: "唯一", file: "nodes/only.json", position: { x: 0, y: 0 } }],
      edges: [],
    };
    expect(deriveGraphNodeStatus(single, "only")).toBe("entry");
  });

  it("collectDuplicateNodeIds reads duplicate_node_id issues", () => {
    const dups = collectDuplicateNodeIds({
      graphIssues: [
        { severity: "error", code: "duplicate_node_id", message: "x", nodeId: "a" },
        { severity: "error", code: "duplicate_node_id", message: "y", nodeId: "b" },
        { severity: "warn", code: "dangling_edge", message: "z", edgeId: "a__b" },
      ],
    });
    expect([...dups].sort()).toEqual(["a", "b"]);
    expect(collectDuplicateNodeIds(undefined)).toEqual(new Set());
  });
});

describe("summarizeNodeConnections", () => {
  it("counts incoming and outgoing edges", () => {
    expect(summarizeNodeConnections(statusGraph, "middle")).toEqual({ incoming: 1, outgoing: 1 });
    expect(summarizeNodeConnections(statusGraph, "branch")).toEqual({ incoming: 1, outgoing: 2 });
    expect(summarizeNodeConnections(statusGraph, "endA")).toEqual({ incoming: 1, outgoing: 0 });
  });

  it("returns zeros for disconnected node", () => {
    expect(summarizeNodeConnections(statusGraph, "lonely")).toEqual({ incoming: 0, outgoing: 0 });
  });

  it("ignores self-loops", () => {
    const loopGraph: ProjectGraph = {
      version: 1,
      entryNodeId: "a",
      nodes: [{ id: "a", title: "A", file: "nodes/a.json", position: { x: 0, y: 0 } }],
      edges: [{ id: "a__a", from: "a", to: "a", condition: null }],
    };
    expect(summarizeNodeConnections(loopGraph, "a")).toEqual({ incoming: 0, outgoing: 0 });
  });
});
