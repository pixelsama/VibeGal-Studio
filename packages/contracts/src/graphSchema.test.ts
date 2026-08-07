import { describe, expect, it } from "vitest";
import {
  GraphEdgeSchema,
  InstructionSchema,
  ProjectGraphSchema,
} from "./schema";

const validGraph = {
  version: 1,
  entryNodeId: "start",
  chapters: [{ id: "chapter_1", title: "第一章" }],
  nodes: [{
    id: "start",
    file: "nodes/start.json",
    chapterId: "chapter_1",
    position: { x: 0, y: 0 },
  }],
  edges: [],
};

describe("ProjectGraphSchema chapter ownership", () => {
  it("requires at least one chapter", () => {
    expect(ProjectGraphSchema.safeParse({ ...validGraph, chapters: [] }).success).toBe(false);
  });

  it("requires every node to name an existing chapter", () => {
    const withoutChapter = {
      ...validGraph,
      nodes: validGraph.nodes.map(({ chapterId: _chapterId, ...node }) => node),
    };
    expect(ProjectGraphSchema.safeParse(withoutChapter).success).toBe(false);
    expect(ProjectGraphSchema.safeParse({
      ...validGraph,
      nodes: validGraph.nodes.map((node) => ({ ...node, chapterId: "missing" })),
    }).success).toBe(false);
  });
});

// ── Spec 35: GraphEdgeSchema 去 mode/label ──
describe("GraphEdgeSchema Spec 35 simplification", () => {
  it("parses an edge with only id/from/to and defaults condition to null", () => {
    const parsed = GraphEdgeSchema.parse({ id: "a-b", from: "a", to: "b" });
    expect(parsed).toEqual({ id: "a-b", from: "a", to: "b", condition: null });
    expect("mode" in parsed).toBe(false);
    expect("label" in parsed).toBe(false);
  });

  it("strips legacy mode/label fields (z.object drops unknown keys)", () => {
    const parsed = GraphEdgeSchema.parse({
      id: "a-b", from: "a", to: "b",
      mode: "choice", label: "去 A",
    });
    expect("mode" in parsed).toBe(false);
    expect("label" in parsed).toBe(false);
  });

  it("keeps condition and effects", () => {
    const parsed = GraphEdgeSchema.parse({
      id: "a-b", from: "a", to: "b",
      condition: "resolve >= 3",
      effects: [{ t: "set", key: "route", value: "a" }],
    });
    expect(parsed.condition).toBe("resolve >= 3");
    expect(parsed.effects).toEqual([{ t: "set", key: "route", value: "a" }]);
  });
});

// ── Spec 35: choice / if 指令（含递归嵌套）──
describe("choice / if instruction schemas", () => {
  it("parses a minimal choice with a jump-only option", () => {
    const parsed = InstructionSchema.safeParse({
      t: "choice",
      id: "branch_1",
      prompt: "怎么办？",
      options: [{ text: "冲过去", to: "approach" }, { text: "等一等" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("parses a choice whose option carries effects + body, and body nests another choice", () => {
    const parsed = InstructionSchema.safeParse({
      t: "choice",
      id: "branch_1",
      options: [{
        text: "冲过去",
        effects: [{ t: "set", key: "resolve", expr: "resolve + 4" }],
        body: [
          { t: "say", who: "npc", text: "你很有勇气！" },
          {
            t: "choice",
            id: "nested",
            options: [{ text: "再选一次", to: "loop" }],
          },
        ],
      }],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a choice with no options", () => {
    expect(InstructionSchema.safeParse({ t: "choice", options: [] }).success).toBe(false);
  });

  it("parses an if with then + else, and then may nest choice", () => {
    const parsed = InstructionSchema.safeParse({
      t: "if",
      condition: "affection >= 60",
      then: [
        { t: "narrate", text: "她笑了。" },
        { t: "choice", id: "after", options: [{ text: "回应", to: "good" }] },
      ],
      else: [{ t: "narrate", text: "她没说话。" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("parses an if with no else (合流)", () => {
    expect(InstructionSchema.safeParse({
      t: "if", condition: "flag", then: [{ t: "narrate", text: "ok" }],
    }).success).toBe(true);
  });

  it("rejects an if without condition", () => {
    expect(InstructionSchema.safeParse({
      t: "if", then: [{ t: "narrate", text: "ok" }],
    }).success).toBe(false);
  });
});
