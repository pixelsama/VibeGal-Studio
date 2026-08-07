import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReactFlowProvider } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import type { GraphIssue, NodeEntry, ProjectGraph } from "../../lib/types";
import { EMPTY_MANIFEST } from "../../lib/types";
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
import { GraphNodeView } from "./GraphNodeView";

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

  it("shows terminal and registered-ending badges independently", () => {
    const manifest = { ...EMPTY_MANIFEST, unlocks: { ...EMPTY_MANIFEST.unlocks, endings: {
      true_end: { title: "True", nodeId: "first-meeting" },
    } } };
    const flow = mapGraphToFlow(sampleGraph, undefined, undefined, manifest);
    const ending = flow.nodes.find((node) => node.id === "first-meeting")!;
    expect(ending.data.badges).toContain("图终点");
    expect(ending.data.badges).toContain("正式结局：true_end");
  });

  it("derives creator summaries from node data", () => {
    const entries: NodeEntry[] = [
      {
        relPath: "nodes/first-meeting.json",
        data: [
          { t: "say", who: "akari", text: "你好" },
          { t: "set", key: "route", value: "akari" },
        ],
      },
    ];
    const manifest = { ...EMPTY_MANIFEST, unlocks: { ...EMPTY_MANIFEST.unlocks, endings: {
      true_end: { title: "True", nodeId: "first-meeting" },
    } } };

    const flow = mapGraphToFlow(sampleGraph, undefined, entries, manifest);

    expect(flow.nodes.find((node) => node.id === "first-meeting")?.data.summary).toEqual([
      "1 句台词",
      "改变故事状态",
      "正式结局",
    ]);
  });

  it("renders creator summaries instead of file names and degree arrows", () => {
    const html = renderToStaticMarkup(createElement(ReactFlowProvider, null, createElement(GraphNodeView, {
      id: "first-meeting",
      type: NODE_TYPE,
      selected: false,
      dragging: false,
      draggable: true,
      selectable: true,
      deletable: true,
      isConnectable: true,
      zIndex: 0,
      positionAbsoluteX: 0,
      positionAbsoluteY: 0,
      data: {
        title: "初遇",
        fileId: "nodes/first-meeting.json",
        isEntry: false,
        status: "normal",
        incoming: 1,
        outgoing: 2,
        summary: ["2 句台词", "改变故事状态"],
      },
    })));

    expect(html).toContain("2 句台词 · 改变故事状态");
    expect(html).not.toContain("nodes/first-meeting.json");
    expect(html).not.toContain("↑1");
    expect(html).not.toContain("↓2");
  });

  it("mapGraphToFlow maps edges with smoothstep type", () => {
    const flow = mapGraphToFlow(sampleGraph);

    expect(flow.edges).toEqual([
      {
        id: "prologue__first-meeting",
        source: "prologue",
        target: "first-meeting",
        type: "smoothstep",
        data: { condition: null },
      },
    ]);
  });

  it("mapGraphToFlow_marks_choice_exit_node_as_branch", () => {
    const graphWithBranch: ProjectGraph = {
      ...sampleGraph,
      entryNodeId: "first-meeting",
      nodes: [
        ...sampleGraph.nodes,
        { id: "second-meeting", title: "再遇", file: "nodes/second-meeting.json", position: { x: 420, y: 360 } },
      ],
      edges: [
        { id: "prologue__first-meeting", from: "prologue", to: "first-meeting", condition: null },
        { id: "prologue__second-meeting", from: "prologue", to: "second-meeting", condition: null },
      ],
    };
    const flow = mapGraphToFlow(graphWithBranch);

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

  it("marks empty-content node as empty instead of normal", () => {
    // middle 在 statusGraph 中是普通已连接节点（normal）
    expect(deriveGraphNodeStatus(statusGraph, "middle", { hasContent: false })).toBe("empty");
    expect(deriveGraphNodeStatus(statusGraph, "middle", { hasContent: true })).toBe("normal");
    // empty 不覆盖角色状态：入口/终点/分支仍按角色显示
    expect(deriveGraphNodeStatus(statusGraph, "prologue", { hasContent: false })).toBe("entry");
    expect(deriveGraphNodeStatus(statusGraph, "endA", { hasContent: false })).toBe("ending");
    expect(deriveGraphNodeStatus(statusGraph, "branch", { hasContent: false })).toBe("branch");
  });

  it("mapGraphToFlow flags empty node files as empty status", () => {
    const graph: ProjectGraph = {
      version: 1,
      entryNodeId: "a",
      nodes: [
        { id: "a", title: "A", file: "nodes/a.json", position: { x: 0, y: 0 } },
        { id: "b", title: "B", file: "nodes/b.json", position: { x: 1, y: 0 } },
        { id: "c", title: "C", file: "nodes/c.json", position: { x: 2, y: 0 } },
      ],
      edges: [
        { id: "a__b", from: "a", to: "b", condition: null },
        { id: "b__c", from: "b", to: "c", condition: null },
      ],
    };
    const entries: NodeEntry[] = [
      { relPath: "nodes/a.json", data: [] },
      { relPath: "nodes/b.json", data: [] },
      { relPath: "nodes/c.json", data: [] },
    ];
    const flow = mapGraphToFlow(graph, undefined, entries);
    // a 是入口 -> entry（empty 不覆盖）
    expect(flow.nodes.find((n) => n.id === "a")?.data.status).toBe("entry");
    // b 普通已连接但空文件 -> empty
    expect(flow.nodes.find((n) => n.id === "b")?.data.status).toBe("empty");
    // c 终点 -> ending（empty 不覆盖）
    expect(flow.nodes.find((n) => n.id === "c")?.data.status).toBe("ending");
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

describe("creator summary content status", () => {
  it("marks a connected empty node as empty when only creator summaries are loaded", () => {
    const graph: ProjectGraph = {
      version: 1,
      entryNodeId: "start",
      chapters: [{ id: "chapter", title: "第一章" }],
      nodes: [
        { id: "start", title: "开始", file: "nodes/start.json", position: { x: 0, y: 0 }, chapterId: "chapter" },
        { id: "empty", title: "空节点", file: "nodes/empty.json", position: { x: 200, y: 0 }, chapterId: "chapter" },
        { id: "tail", title: "尾声", file: "nodes/tail.json", position: { x: 400, y: 0 }, chapterId: "chapter" },
      ],
      edges: [
        { id: "start__empty", from: "start", to: "empty" },
        { id: "empty__tail", from: "empty", to: "tail" },
      ],
    };
    const flow = mapGraphToFlow(graph, undefined, undefined, undefined, undefined, [{
      id: "empty",
      relPath: "nodes/empty.json",
      sayCount: 0,
      changesState: false,
      instructionCount: 0,
    }]);

    expect(flow.nodes.find((node) => node.id === "empty")?.data.status).toBe("empty");
  });
});
