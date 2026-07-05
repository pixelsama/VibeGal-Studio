import { describe, expect, it } from "vitest";
import type { GraphEdge } from "../../lib/types";
import { inferExitMode, validateNodeExits } from "./NodeExitBlock";

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

    expect(issues).toContain("线性继续只能有一条出口。");
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
