import { describe, expect, it } from "vitest";
import type { ProjectGraph } from "../../lib/types";
import { NODE_TYPE, findNode, findNodeData, mapGraphToFlow } from "./graphMapping";

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

  it("findNode returns node by id", () => {
    expect(findNode(sampleGraph, "first-meeting")).toEqual(sampleGraph.nodes[1]);
    expect(findNode(sampleGraph, "missing")).toBeNull();
    expect(findNode(sampleGraph, null)).toBeNull();
  });

  it("findNodeData returns node entry data by graph node id", () => {
    const entries = [
      { relPath: "nodes/prologue.json", data: [{ t: "say", text: "hello" }] },
      { relPath: "nodes/first-meeting.json", data: null },
    ];

    expect(findNodeData(sampleGraph, entries, "prologue")).toEqual(entries[0]);
    expect(findNodeData(sampleGraph, entries, "first-meeting")).toEqual(entries[1]);
    expect(findNodeData(sampleGraph, entries, "missing")).toBeNull();
    expect(findNodeData(sampleGraph, entries, null)).toBeNull();
    expect(findNodeData(sampleGraph, undefined, "prologue")).toBeNull();
  });
});
