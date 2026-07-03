import { describe, expect, it } from "vitest";
import type { ProjectGraph } from "../../lib/types";
import { autoLayoutGraph } from "./graphLayout";

const makeGraph = (overrides: Partial<ProjectGraph> = {}): ProjectGraph => ({
  version: 1,
  entryNodeId: "a",
  nodes: [
    { id: "a", title: "A", file: "nodes/a.json", position: { x: 0, y: 0 } },
    { id: "b", title: "B", file: "nodes/b.json", position: { x: 0, y: 0 } },
    { id: "c", title: "C", file: "nodes/c.json", position: { x: 0, y: 0 } },
    { id: "d", title: "D", file: "nodes/d.json", position: { x: 0, y: 0 } },
  ],
  edges: [
    { id: "a__b", from: "a", to: "b", condition: null },
    { id: "a__c", from: "a", to: "c", condition: null },
    { id: "c__d", from: "c", to: "d", condition: null },
  ],
  ...overrides,
});

describe("autoLayoutGraph", () => {
  it("places entry at layer 0 (leftmost) and successors to the right", () => {
    const layout = autoLayoutGraph(makeGraph());
    const pos = (id: string) => layout.nodes.find((n) => n.id === id)!.position;

    // a 是入口，layer 0；b/c 是 a 的后继，layer 1；d 是 c 的后继，layer 2
    expect(pos("a").x).toBeLessThan(pos("b").x);
    expect(pos("c").x).toBe(pos("b").x); // 同层
    expect(pos("d").x).toBeGreaterThan(pos("c").x);
  });

  it("sorts same-layer nodes by id for determinism", () => {
    const layout = autoLayoutGraph(makeGraph());
    const pos = (id: string) => layout.nodes.find((n) => n.id === id)!.position;

    // layer 1 有 b、c，按字典序 b 在 c 上面（y 更小）
    expect(pos("b").y).toBeLessThan(pos("c").y);
  });

  it("only changes positions, preserving id/file/title/edges/entryNodeId", () => {
    const original = makeGraph();
    const layout = autoLayoutGraph(original);

    expect(layout.nodes.map((n) => ({ id: n.id, title: n.title, file: n.file }))).toEqual(
      original.nodes.map((n) => ({ id: n.id, title: n.title, file: n.file })),
    );
    expect(layout.edges).toEqual(original.edges);
    expect(layout.entryNodeId).toBe(original.entryNodeId);
    expect(layout.version).toBe(original.version);
  });

  it("is idempotent: running twice yields identical positions", () => {
    const once = autoLayoutGraph(makeGraph());
    const twice = autoLayoutGraph(once);

    expect(twice.nodes.map((n) => n.position)).toEqual(once.nodes.map((n) => n.position));
  });

  it("places unreachable nodes in a separate bottom region", () => {
    const graph = makeGraph({
      nodes: [
        { id: "a", title: "A", file: "nodes/a.json", position: { x: 0, y: 0 } },
        { id: "b", title: "B", file: "nodes/b.json", position: { x: 0, y: 0 } },
        { id: "orphan", title: "Orphan", file: "nodes/orphan.json", position: { x: 0, y: 0 } },
      ],
      edges: [{ id: "a__b", from: "a", to: "b", condition: null }],
    });

    const layout = autoLayoutGraph(graph);
    const pos = (id: string) => layout.nodes.find((n) => n.id === id)!.position;

    // orphan 不可达，应在可达节点下方
    expect(pos("orphan").y).toBeGreaterThan(pos("b").y);
    // 不可达区 x 回到 ORIGIN_X（= a 的 x）
    expect(pos("orphan").x).toBe(pos("a").x);
  });

  it("treats all nodes as unreachable when entryNodeId is empty", () => {
    const graph = makeGraph({ entryNodeId: "" });
    const layout = autoLayoutGraph(graph);

    // 全部不可达，按 id 字典序排（a,b,c,d），y 递增
    const ys = layout.nodes.map((n) => n.position.y);
    expect(ys).toEqual([...ys].sort((p, q) => p - q));
    expect(layout.nodes.map((n) => n.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("does not crash on empty graph", () => {
    const empty: ProjectGraph = { version: 1, entryNodeId: "", nodes: [], edges: [] };
    expect(autoLayoutGraph(empty)).toEqual(empty);
  });

  it("ignores self-loops in BFS layering", () => {
    const graph = makeGraph({
      nodes: [
        { id: "a", title: "A", file: "nodes/a.json", position: { x: 0, y: 0 } },
        { id: "b", title: "B", file: "nodes/b.json", position: { x: 0, y: 0 } },
      ],
      edges: [
        { id: "a__a", from: "a", to: "a", condition: null }, // 自环
        { id: "a__b", from: "a", to: "b", condition: null },
      ],
    });

    const layout = autoLayoutGraph(graph);
    const pos = (id: string) => layout.nodes.find((n) => n.id === id)!.position;
    // b 仍在 layer 1（自环不影响分层）
    expect(pos("b").x).toBeGreaterThan(pos("a").x);
  });

  it("ignores entryNodeId that does not exist in nodes", () => {
    const graph = makeGraph({ entryNodeId: "ghost" });
    const layout = autoLayoutGraph(graph);

    // 入口不存在 → 全部不可达，按字典序
    expect(layout.nodes.map((n) => n.id)).toEqual(["a", "b", "c", "d"]);
  });
});
