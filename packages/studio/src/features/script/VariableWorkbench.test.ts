import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProjectGraph } from "../../lib/types";
import { changeVariableType, registerInferredVariable, VariableWorkbench } from "./VariableWorkbench";

const graph: ProjectGraph = {
  version: 1,
  entryNodeId: "start",
  chapters: [{ id: "chapter_1", title: "第一章" }],
  nodes: [{ id: "start", file: "nodes/start.json", chapterId: "chapter_1", position: { x: 0, y: 0 } }],
  edges: [],
};

describe("VariableWorkbench model", () => {
  it("registers inferred variables with an explicit compatible declaration", () => {
    const registry = { version: 1 as const, variables: {} };
    expect(registerInferredVariable(registry, "affection", ["number"])).toEqual({
      version: 1,
      variables: { affection: { type: "number", default: 0, nullable: false, scope: "run", description: "" } },
    });
  });

  it("resets the default when the declaration type changes", () => {
    expect(changeVariableType({ type: "string", default: "123", nullable: true, scope: "run" }, "boolean"))
      .toEqual({ type: "boolean", default: false, nullable: true, scope: "run" });
  });

  it("renders a creator view first and folds identifiers and storage semantics into technical details", () => {
    const registry = {
      version: 1 as const,
      variables: {
        affection: {
          label: "好感度",
          type: "number" as const,
          default: 3,
          nullable: false,
          scope: "run" as const,
          description: "影响角色路线",
        },
      },
    };

    const html = renderToStaticMarkup(createElement(VariableWorkbench, {
      registry,
      graph,
      onChange: () => {},
    }));

    expect(html).toContain("<strong>好感度</strong>");
    expect(html).toContain("影响角色路线");
    expect(html).toContain("初始值");
    expect(html).toContain('aria-label="affection 显示名称"');
    expect(html).toContain('aria-label="affection 说明"');
    expect(html).toMatch(/aria-label="affection 显示名称"[^>]*value="好感度"/);
    expect(html).toMatch(/aria-label="affection 说明"[^>]*value="影响角色路线"/);
    expect(html).toMatch(/aria-label="affection 显示名称"[\s\S]*<details>/);
    expect(html).toMatch(/aria-label="affection 说明"[\s\S]*<details>/);
    expect(html).toContain("<summary>技术详情</summary>");
    expect(html).toContain("内部标识");
    expect(html).toContain("affection");
    expect(html).toContain("本轮游戏");
    expect(html).toContain("数值");
    expect(html).not.toContain("<details open");
    expect(html).not.toContain(">nullable<");
    expect(html).not.toContain(">run<");
  });

  it("keeps the stable identifier as the fallback title when no creator label exists", () => {
    const registry = {
      version: 1 as const,
      variables: {
        route_done: {
          type: "boolean" as const,
          default: false,
          nullable: false,
          scope: "global" as const,
          description: "",
        },
      },
    };

    const html = renderToStaticMarkup(createElement(VariableWorkbench, { registry, graph }));

    expect(html).toContain("<strong>route_done</strong>");
    expect(html).toContain("跨周目保存");
    expect(html).toContain("开关");
  });

  it("uses creator-facing labels for boolean and unset initial values", () => {
    const registry = {
      version: 1 as const,
      variables: {
        route_done: {
          label: "路线已完成",
          type: "boolean" as const,
          default: false,
          nullable: false,
          scope: "run" as const,
        },
        partner_name: {
          label: "搭档称呼",
          type: "string" as const,
          default: null,
          nullable: true,
          scope: "run" as const,
        },
      },
    };

    const html = renderToStaticMarkup(createElement(VariableWorkbench, {
      registry,
      graph,
      onChange: () => {},
    }));

    expect(html).toContain(">开启</option>");
    expect(html).toContain(">关闭</option>");
    expect(html).toContain("初始状态：未设置");
    expect(html).not.toContain(">true</option>");
    expect(html).not.toContain(">false</option>");
    expect(html).not.toContain("默认 null");
  });
});
