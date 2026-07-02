import { describe, expect, it } from "vitest";
import type { ProjectGraph } from "../../lib/types";
import {
  addNode,
  connectNodes,
  defaultPosition,
  generateNodeId,
  moveNode,
  removeEdge,
  removeNode,
  removeNodes,
  renameNode,
} from "./graphEditing";

const sampleGraph: ProjectGraph = {
  version: 1,
  entryNodeId: "node",
  nodes: [
    {
      id: "node",
      title: "Node",
      file: "nodes/node.json",
      position: { x: 100, y: 120 },
    },
    {
      id: "node_2",
      title: "Node 2",
      file: "nodes/node_2.json",
      position: { x: 360, y: 120 },
    },
    {
      id: "ending",
      title: "Ending",
      file: "nodes/ending.json",
      position: { x: 620, y: 120 },
    },
  ],
  edges: [
    { id: "node__node_2", from: "node", to: "node_2", condition: null },
    { id: "node_2__ending", from: "node_2", to: "ending", condition: null },
  ],
};

describe("graphEditing", () => {
  it("addNode appends node with given id/file", () => {
    const next = addNode(sampleGraph, {
      id: "new-node",
      title: "New Node",
      file: "nodes/new-node.json",
      position: { x: 40, y: 60 },
    });

    expect(next.nodes).toHaveLength(sampleGraph.nodes.length + 1);
    expect(next.nodes.at(-1)).toMatchObject({
      id: "new-node",
      title: "New Node",
      file: "nodes/new-node.json",
      position: { x: 40, y: 60 },
    });
    expect(sampleGraph.nodes).toHaveLength(3);
  });

  it("removeNode removes node and its edges", () => {
    const result = removeNode(sampleGraph, "node_2");

    expect(result.removedFile).toBe("nodes/node_2.json");
    expect(result.graph.nodes.map((node) => node.id)).toEqual(["node", "ending"]);
    expect(result.graph.edges).toEqual([]);
  });

  it("removeNode returns null removedFile when node missing", () => {
    const result = removeNode(sampleGraph, "missing");

    expect(result.removedFile).toBeNull();
    expect(result.graph).toBe(sampleGraph);
  });

  it("removeNodes removes multiple nodes and all related edges in one graph update", () => {
    const result = removeNodes(sampleGraph, ["node", "ending"]);

    expect(result.removedFiles).toEqual(["nodes/node.json", "nodes/ending.json"]);
    expect(result.graph.nodes.map((node) => node.id)).toEqual(["node_2"]);
    expect(result.graph.edges).toEqual([]);
  });

  it("removeNodes ignores missing nodes and preserves graph when none match", () => {
    const result = removeNodes(sampleGraph, ["missing", "also_missing"]);

    expect(result.removedFiles).toEqual([]);
    expect(result.graph).toBe(sampleGraph);
  });

  it("connectNodes adds edge with stable id", () => {
    const next = connectNodes(sampleGraph, "ending", "node");
    const duplicate = connectNodes(next, "ending", "node");

    expect(next.edges.at(-1)).toEqual({
      id: "ending__node",
      from: "ending",
      to: "node",
      condition: null,
    });
    expect(duplicate.edges).toHaveLength(next.edges.length);
  });

  it("renameNode updates title only", () => {
    const next = renameNode(sampleGraph, "node", "Renamed");

    expect(next.nodes[0]).toEqual({
      ...sampleGraph.nodes[0],
      title: "Renamed",
    });
  });

  it("moveNode updates position", () => {
    const next = moveNode(sampleGraph, "ending", { x: 700, y: 240 });

    expect(next.nodes[2]).toEqual({
      ...sampleGraph.nodes[2],
      position: { x: 700, y: 240 },
    });
    expect(next.nodes[0]).toBe(sampleGraph.nodes[0]);
  });

  it("removeEdge removes by id", () => {
    const next = removeEdge(sampleGraph, "node__node_2");

    expect(next.edges).toEqual([{ id: "node_2__ending", from: "node_2", to: "ending", condition: null }]);
  });

  it("generateNodeId dedupes against existing", () => {
    expect(generateNodeId(sampleGraph, "node")).toBe("node_3");
    expect(generateNodeId(sampleGraph, "New Node!")).toBe("new_node");
    expect(generateNodeId({ ...sampleGraph, nodes: [] }, "!!!")).toBe("node");
  });

  it("defaultPosition offsets from existing nodes", () => {
    const next = defaultPosition(sampleGraph);

    expect(next.x).toBeGreaterThanOrEqual(0);
    expect(next.y).toBeGreaterThanOrEqual(0);
    expect(sampleGraph.nodes.some((node) => node.position.x === next.x && node.position.y === next.y)).toBe(false);
  });
});
