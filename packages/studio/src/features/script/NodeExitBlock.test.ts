import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode } from "../../lib/types";
import { inferExitMode, NodeExitBlock, validateNodeExits } from "./NodeExitBlock";

function edge(patch: Partial<GraphEdge> = {}): GraphEdge {
  return {
    id: patch.id ?? "a__b",
    from: patch.from ?? "a",
    to: patch.to ?? "b",
    mode: patch.mode ?? "linear",
    label: patch.label ?? null,
    condition: patch.condition ?? null,
  };
}

const currentNode: GraphNode = {
  id: "a",
  title: "当前节点",
  file: "nodes/a.json",
  position: { x: 0, y: 0 },
};

const graphNodes: GraphNode[] = [
  currentNode,
  { id: "b", title: "节点 B", file: "nodes/b.json", position: { x: 100, y: 0 } },
  { id: "c", title: "节点 C", file: "nodes/c.json", position: { x: 200, y: 0 } },
];

function renderExitBlock(edges: GraphEdge[]): string {
  return renderToStaticMarkup(createElement(NodeExitBlock, {
    node: currentNode,
    graphNodes,
    edges,
    issues: validateNodeExits(edges),
    onChange: () => {},
  }));
}

describe("NodeExitBlock rules", () => {
  it("infers end mode from empty outgoing edges", () => {
    expect(inferExitMode([])).toBe("end");
    expect(validateNodeExits([])).toEqual([]);
  });

  it("rejects multiple linear exits", () => {
    const issues = validateNodeExits([
      edge({ id: "a__b", to: "b" }),
      edge({ id: "a__c", to: "c" }),
    ]);

    expect(issues).toContain("普通继续只能有一条出口。");
  });

  it("rejects choice exits without labels", () => {
    const issues = validateNodeExits([edge({ mode: "choice", label: "" })]);

    expect(issues).toContain("玩家选择出口需要选项文本。");
  });

  it("rejects mixed outgoing modes", () => {
    const issues = validateNodeExits([
      edge({ id: "a__b", mode: "choice", label: "留下" }),
      edge({ id: "a__c", mode: "auto", condition: "flag" }),
    ]);

    expect(issues).toContain("同一节点不能混用不同出口模式。");
  });

  it("rejects multiple auto default exits", () => {
    const issues = validateNodeExits([
      edge({ id: "a__b", mode: "auto", condition: null }),
      edge({ id: "a__c", mode: "auto", condition: " " }),
    ]);

    expect(issues).toContain("自动判定最多只能有一条无条件默认出口。");
  });
});

describe("NodeExitBlock UI", () => {
  it("renders empty outgoing edges as an inferred ending, not a selectable mode", () => {
    const html = renderExitBlock([]);

    expect(html).toContain("节点在此结束");
    expect(html).toContain("连接下一个节点");
    expect(html).not.toContain('value="end"');
    expect(html).not.toContain('value="linear"');
    expect(html).not.toContain("线性继续");
  });

  it("renders one linear edge as inferred continuation without an end/linear chooser", () => {
    const html = renderExitBlock([edge({ to: "b" })]);

    expect(html).toContain("继续到");
    expect(html).toContain("节点 B");
    expect(html).toContain("删除连接");
    expect(html).not.toContain('value="end"');
    expect(html).not.toContain('value="linear"');
    expect(html).not.toContain("线性继续");
  });

  it("only exposes player choice and auto condition as branch type options", () => {
    const html = renderExitBlock([
      edge({ id: "a__b", mode: "choice", label: "去 B", to: "b" }),
      edge({ id: "a__c", mode: "choice", label: "去 C", to: "c" }),
    ]);

    expect(html).toContain("出口类型");
    expect(html).toContain('value="choice"');
    expect(html).toContain('value="auto"');
    expect(html).not.toContain('value="end"');
    expect(html).not.toContain('value="linear"');
  });
});
