import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusDialog, StatusPanel, type StatusIssue } from "./StatusPanel";

const issues: StatusIssue[] = [
  {
    severity: "error",
    source: "asset",
    code: "missing_asset",
    message: "资源文件不存在",
    file: "content/assets/bg/x.png",
    jsonPath: "$.backgrounds.x",
  },
  {
    severity: "warn",
    source: "asset",
    code: "duplicate_asset_ref",
    message: "资源被多处引用",
    file: "content/assets/bg/y.png",
  },
];

describe("StatusPanel (通用指示器)", () => {
  it("正常态显示对勾与 okLabel，不渲染弹窗", () => {
    const html = renderToStaticMarkup(
      <StatusPanel
        issues={[]}
        okLabel="资产正常"
        notOkLabel={(n) => `资产有 ${n} 个问题`}
        dialogTitle="Asset Issues"
        dialogAriaLabel="Asset Issues"
      />,
    );

    expect(html).toContain("资产正常");
    expect(html).toContain("✓");
    expect(html).not.toContain("Asset Issues");
    expect(html).not.toContain("Errors");
  });

  it("有问题时显示感叹号、计数、notOkLabel，不展开详情", () => {
    const html = renderToStaticMarkup(
      <StatusPanel
        issues={issues}
        okLabel="资产正常"
        notOkLabel={(n) => `资产有 ${n} 个问题`}
        dialogTitle="Asset Issues"
        dialogAriaLabel="Asset Issues"
      />,
    );

    expect(html).toContain("资产有 2 个问题");
    expect(html).toContain("!");
    expect(html).toContain(">2<");
    expect(html).not.toContain("missing_asset");
    expect(html).not.toContain("资源文件不存在");
  });

  it("issueExtra 的返回值不出现在折叠态（只在弹窗里）", () => {
    const html = renderToStaticMarkup(
      <StatusPanel
        issues={issues}
        okLabel="资产正常"
        notOkLabel={(n) => `资产有 ${n} 个问题`}
        dialogTitle="Asset Issues"
        dialogAriaLabel="Asset Issues"
        issueExtra={() => "EXTRA-TAG"}
      />,
    );
    expect(html).not.toContain("EXTRA-TAG");
  });
});

describe("StatusDialog (通用弹窗)", () => {
  it("分组展示 error/warn 详情与计数", () => {
    const html = renderToStaticMarkup(
      <StatusDialog
        issues={issues}
        okLabel="资产正常"
        dialogTitle="Asset Issues"
        dialogAriaLabel="Asset Issues"
        onClose={() => {}}
      />,
    );

    expect(html).toContain("Asset Issues");
    expect(html).toContain("1 error / 1 warn");
    expect(html).toContain("missing_asset");
    expect(html).toContain("资源文件不存在");
    expect(html).toContain("content/assets/bg/x.png");
    expect(html).toContain("$.backgrounds.x");
  });

  it("issueExtra 的内容出现在卡片中", () => {
    const html = renderToStaticMarkup(
      <StatusDialog
        issues={issues}
        okLabel="资产正常"
        dialogTitle="Asset Issues"
        dialogAriaLabel="Asset Issues"
        issueExtra={(i) => `tag:${i.code}`}
        onClose={() => {}}
      />,
    );
    expect(html).toContain("tag:missing_asset");
    expect(html).toContain("tag:duplicate_asset_ref");
  });

  it("无问题时弹窗显示对勾与正常文案", () => {
    const html = renderToStaticMarkup(
      <StatusDialog
        issues={[]}
        okLabel="资产正常"
        emptyDescription="资产一致"
        dialogTitle="Asset Issues"
        dialogAriaLabel="Asset Issues"
        onClose={() => {}}
      />,
    );
    expect(html).toContain("✓");
    expect(html).toContain("资产一致");
  });
});

describe("StatusDialog 按 source 分组", () => {
  // 跨来源的混合问题：图结构有 1 error + 1 warn，资产有 1 error
  const mixed: StatusIssue[] = [
    { severity: "warn", source: "graph", code: "dangling_edge", message: "边端点缺失" },
    { severity: "error", source: "asset", code: "orphan_asset", message: "孤儿文件" },
    { severity: "error", source: "graph", code: "duplicate_node_id", message: "节点重复" },
  ];

  it("按 sourceLabel 把问题分到不同 section", () => {
    const html = renderToStaticMarkup(
      <StatusDialog
        issues={mixed}
        okLabel="项目正常"
        dialogTitle="Project Issues"
        dialogAriaLabel="Project Issues"
        sourceLabel={(s) => (s === "graph" ? "图结构" : s === "asset" ? "资产" : s)}
        onClose={() => {}}
      />,
    );
    expect(html).toContain("图结构");
    expect(html).toContain("资产");
  });

  it("sourceLabel 支持 node issues 显示为节点内容", () => {
    const html = renderToStaticMarkup(
      <StatusDialog
        issues={[{ severity: "error", source: "node", code: "node_not_array", message: "节点文件不是数组" }]}
        okLabel="项目正常"
        dialogTitle="Project Issues"
        dialogAriaLabel="Project Issues"
        sourceLabel={(s) => (s === "node" ? "节点内容" : s)}
        onClose={() => {}}
      />,
    );

    expect(html).toContain("节点内容");
    expect(html).toContain("node_not_array");
  });

  it("同一 source 组内 error 排在 warn 前面", () => {
    const html = renderToStaticMarkup(
      <StatusDialog
        issues={mixed}
        okLabel="项目正常"
        dialogTitle="Project Issues"
        dialogAriaLabel="Project Issues"
        sourceLabel={(s) => (s === "graph" ? "图结构" : s === "asset" ? "资产" : s)}
        onClose={() => {}}
      />,
    );
    // 图结构组里：duplicate_node_id(error) 应在 dangling_edge(warn) 之前
    const graphStart = html.indexOf("图结构");
    const errPos = html.indexOf("duplicate_node_id", graphStart);
    const warnPos = html.indexOf("dangling_edge", graphStart);
    expect(errPos).toBeGreaterThan(-1);
    expect(warnPos).toBeGreaterThan(-1);
    expect(errPos).toBeLessThan(warnPos);
  });

  it("每张卡片标注 Error / Warning 标签", () => {
    const html = renderToStaticMarkup(
      <StatusDialog
        issues={mixed}
        okLabel="项目正常"
        dialogTitle="Project Issues"
        dialogAriaLabel="Project Issues"
        sourceLabel={(s) => s}
        onClose={() => {}}
      />,
    );
    expect(html).toContain("Error");
    expect(html).toContain("Warning");
  });

  it("isIssueClickable 可以让不可定位的问题保持默认光标", () => {
    const html = renderToStaticMarkup(
      <StatusDialog
        issues={mixed}
        okLabel="项目正常"
        dialogTitle="Project Issues"
        dialogAriaLabel="Project Issues"
        onIssueClick={() => {}}
        isIssueClickable={(issue) => issue.source === "graph" && Boolean(issue.nodeId || issue.edgeId)}
        onClose={() => {}}
      />,
    );

    expect(html).toContain("cursor:default");
  });
});
