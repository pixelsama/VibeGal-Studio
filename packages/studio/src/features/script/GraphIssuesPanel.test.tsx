import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GraphIssuesDialog, GraphIssuesPanel } from "./GraphIssuesPanel";
import type { GraphIssue } from "../../lib/types";

const issues: GraphIssue[] = [
  {
    severity: "error",
    code: "missing_node_file",
    message: "节点文件不存在",
    file: "content/nodes/start.json",
    jsonPath: "$.nodes[0].file",
    nodeId: "start",
  },
  {
    severity: "warn",
    code: "dangling_edge",
    message: "边引用了不存在的节点",
    edgeId: "edge-1",
  },
];

const noop = () => {};

describe("GraphIssuesPanel", () => {
  it("renders a compact healthy status instead of an always-open panel", () => {
    const html = renderToStaticMarkup(
      <GraphIssuesPanel issues={[]} onSelectNode={noop} onSelectEdge={noop} />,
    );

    expect(html).toContain("图结构正常");
    expect(html).toContain("✓");
    expect(html).not.toContain("Graph Issues");
    expect(html).not.toContain("Errors");
  });

  it("renders a compact problem indicator without expanding issue details by default", () => {
    const html = renderToStaticMarkup(
      <GraphIssuesPanel issues={issues} onSelectNode={noop} onSelectEdge={noop} />,
    );

    expect(html).toContain("图结构有 2 个问题");
    expect(html).toContain("!");
    expect(html).toContain(">2<");
    expect(html).not.toContain("missing_node_file");
    expect(html).not.toContain("节点文件不存在");
  });
});

describe("GraphIssuesDialog", () => {
  it("shows grouped issue details when opened", () => {
    const html = renderToStaticMarkup(
      <GraphIssuesDialog issues={issues} onSelectNode={noop} onSelectEdge={noop} onClose={noop} />,
    );

    expect(html).toContain("Graph Issues");
    expect(html).toContain("1 error / 1 warn");
    expect(html).toContain("missing_node_file");
    expect(html).toContain("节点文件不存在");
    expect(html).toContain("content/nodes/start.json");
    expect(html).toContain("$.nodes[0].file");
    expect(html).toContain("edge edge-1");
  });
});
