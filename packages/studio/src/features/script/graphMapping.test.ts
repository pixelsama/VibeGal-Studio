import { describe, expect, it } from "vitest";
import type { GraphIssue, NodeEntry, ProjectGraph } from "../../lib/types";
import { NODE_TYPE, findNode, findNodeData, issueTargetsNode, mapGraphToFlow } from "./graphMapping";

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
        data: { condition: null },
      },
    ]);
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
