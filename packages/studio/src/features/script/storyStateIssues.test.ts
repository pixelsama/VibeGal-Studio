import { describe, expect, it } from "vitest";
import type { VariableRegistry } from "@vibegal/engine";
import type { NodeEntry, ProjectGraph } from "../../lib/types";
import { collectDanglingExperienceIssues, collectStoryStateIssues } from "./storyStateIssues";

const graph: ProjectGraph = {
  version: 1,
  entryNodeId: "start",
  chapters: [{ id: "c1", title: "第一章" }],
  nodes: [
    { id: "start", title: "天台·夜", file: "nodes/start.json", chapterId: "c1", position: { x: 0, y: 0 } },
    { id: "love", title: "告白", file: "nodes/love.json", chapterId: "c1", position: { x: 200, y: 0 } },
    { id: "plain", title: "普通", file: "nodes/plain.json", chapterId: "c1", position: { x: 200, y: 80 } },
  ],
  edges: [
    { id: "start__love", from: "start", to: "love", mode: "auto", label: null, condition: "affection >= 60" },
    { id: "start__plain", from: "start", to: "plain", mode: "auto", label: null, condition: null },
  ],
};

const registry: VariableRegistry = {
  version: 1,
  variables: {
    affection: { kind: "meter", type: "number", default: 0, nullable: false, scope: "run", label: "好感度" },
  },
};

const nodes: NodeEntry[] = [
  { relPath: "nodes/start.json", data: [] },
  { relPath: "nodes/love.json", data: [] },
  { relPath: "nodes/plain.json", data: [] },
] as unknown as NodeEntry[];

describe("collectStoryStateIssues", () => {
  it("reports a state nothing ever changes, in creator wording", () => {
    const issues = collectStoryStateIssues({ graph, nodes, registry });
    const issue = issues.find((item) => item.code === "read_before_write");
    expect(issue).toBeTruthy();
    expect(issue!.source).toBe("variables");
    expect(issue!.message).toContain("好感度");
    expect(issue!.message).not.toContain("read_before_write");
  });

  it("points the issue at the branch that reads it, so clicking lands somewhere useful", () => {
    const issues = collectStoryStateIssues({ graph, nodes, registry });
    expect(issues.find((item) => item.code === "read_before_write")?.edgeId).toBe("start__love");
  });

  it("reports an unparseable condition as a story-state problem", () => {
    const broken: ProjectGraph = {
      ...graph,
      edges: [{ ...graph.edges[0], condition: "affection >" }, graph.edges[1]],
    };
    const issues = collectStoryStateIssues({ graph: broken, nodes, registry });
    const issue = issues.find((item) => item.code === "invalid_condition");
    expect(issue?.message).toContain("分流条件写错了");
    expect(issue?.edgeId).toBe("start__love");
  });

  it("returns nothing when there is no graph yet", () => {
    expect(collectStoryStateIssues({ graph: null, registry })).toEqual([]);
  });
});

describe("collectDanglingExperienceIssues", () => {
  it("catches a condition that still references a deleted choice", () => {
    const dangling: ProjectGraph = {
      ...graph,
      edges: [{ ...graph.edges[0], condition: "chose.start__deleted" }, graph.edges[1]],
    };
    const issues = collectDanglingExperienceIssues(dangling, nodes);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("dangling_story_experience");
    expect(issues[0].message).toContain("已经被删掉了");
    expect(issues[0].edgeId).toBe("start__love");
  });

  it("catches a condition that still references a deleted node", () => {
    const dangling: ProjectGraph = {
      ...graph,
      edges: [{ ...graph.edges[0], condition: "seen.gone" }, graph.edges[1]],
    };
    expect(collectDanglingExperienceIssues(dangling, nodes)).toHaveLength(1);
  });

  it("stays quiet when the referenced choice and node still exist", () => {
    const valid: ProjectGraph = {
      ...graph,
      edges: [{ ...graph.edges[0], condition: "chose.start__love && seen.plain" }, graph.edges[1]],
    };
    expect(collectDanglingExperienceIssues(valid, nodes)).toEqual([]);
  });

  it("ignores ordinary declared states", () => {
    expect(collectDanglingExperienceIssues(graph, nodes)).toEqual([]);
  });
});
