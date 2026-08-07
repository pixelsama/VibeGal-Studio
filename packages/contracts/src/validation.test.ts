import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contractDiagnostics, instructionPolicies } from "./diagnostics";
import { buildJsonSchema, SCHEMAS, type SchemaName } from "./schemaExport";
import { validateContractInput, validateProjectSemantics } from "./validation";

type ExpectedIssue = {
  code: string;
  severity: "error" | "warn";
  source: string;
  jsonPath: string;
};

const fixture = JSON.parse(readFileSync(
  new URL("../fixtures/validation-contract.json", import.meta.url),
  "utf8",
)) as {
  nodeCases: Array<{ id: string; input: unknown; issues: ExpectedIssue[] }>;
  schemaCases: Array<{
    id: string;
    schema: "graph" | "manifest" | "meta" | "locale";
    input: unknown;
    issues: ExpectedIssue[];
  }>;
  limitCase: {
    id: string;
    count: number;
    retained: number;
    repeatedIssue: Omit<ExpectedIssue, "jsonPath"> & { jsonPathTemplate: string };
    truncationIssue: ExpectedIssue;
  };
};

const defaultsFixture = JSON.parse(readFileSync(
  new URL("../fixtures/default-projection-contract.json", import.meta.url),
  "utf8",
)) as {
  cases: Array<{ id: string; schema: SchemaName; input: unknown; expected: unknown }>;
};

const stable = (issues: ReturnType<typeof validateContractInput>) => issues.map((issue) => ({
  code: issue.code,
  severity: issue.severity,
  source: issue.source,
  jsonPath: issue.jsonPath,
}));

describe("contract validation corpus", () => {
  for (const testCase of fixture.nodeCases) {
    it(testCase.id, () => {
      expect(stable(validateContractInput("nodeFile", testCase.input))).toEqual(testCase.issues);
    });
  }

  for (const testCase of fixture.schemaCases) {
    it(testCase.id, () => {
      expect(stable(validateContractInput(testCase.schema, testCase.input))).toEqual(testCase.issues);
    });
  }

  it(fixture.limitCase.id, () => {
    const testCase = fixture.limitCase;
    const input = Array.from({ length: testCase.count }, () => ({}));
    const repeated = Array.from({ length: testCase.count }, (_, index) => ({
      code: testCase.repeatedIssue.code,
      severity: testCase.repeatedIssue.severity,
      source: testCase.repeatedIssue.source,
      jsonPath: testCase.repeatedIssue.jsonPathTemplate.replace("{index}", String(index)),
    })).sort(issueOrder).slice(0, testCase.retained);
    const expected = [...repeated, testCase.truncationIssue].sort(issueOrder);

    expect(stable(validateContractInput("nodeFile", input))).toEqual(expected);
  });

  it("keeps instruction policies aligned with every generated discriminator", () => {
    // Spec 35: choice/if 的 body/then/else 内嵌 Instruction[]，使 InstructionSchema
    // 成为自递归类型。Zod 4 的 z.toJSONSchema 因此把指令联合抽到 $defs.<key>
    // 并用 $ref 引用，而不再是 nodeFile.items.oneOf 的扁平数组。
    const nodeSchema = buildJsonSchema("nodeFile") as {
      items: { $ref?: string };
      $defs?: Record<string, { oneOf: Array<{ properties: { t: { const: string } } }> }>;
    };
    const defKey = (nodeSchema.items.$ref ?? "").split("/").pop()!;
    const union = nodeSchema.$defs?.[defKey]?.oneOf;
    expect(Array.isArray(union)).toBe(true);
    const discriminators = union!
      .map((branch) => branch.properties.t.const)
      .sort();

    expect(Object.keys(instructionPolicies).sort()).toEqual(discriminators);

    const allInstructions = fixture.nodeCases.find(
      (testCase) => testCase.id === "node.valid.all-instructions",
    )?.input;
    expect(Array.isArray(allInstructions)).toBe(true);
    const fixtureDiscriminators = (allInstructions as Array<{ t: string }>)
      .map((instruction) => instruction.t)
      .sort();
    expect(fixtureDiscriminators).toEqual(discriminators);
  });

  it("declares every policy and corpus issue code in canonical diagnostics", () => {
    const policyCodes = Object.values(instructionPolicies).flatMap((policy) =>
      "references" in policy
        ? policy.references.flatMap((rule) => "missingCode" in rule ? [rule.missingCode] : [])
        : []);
    const fixtureCodes = [...fixture.nodeCases, ...fixture.schemaCases]
      .flatMap((testCase) => testCase.issues.map((issue) => issue.code));

    for (const code of [...policyCodes, ...fixtureCodes]) {
      expect(contractDiagnostics).toHaveProperty(code);
    }
  });
});

describe("project semantic validation", () => {
  const manifest = {
    characters: {
      hero: {
        name: "Hero",
        color: "#fff",
        sprites: {
          idle: "assets/hero-idle.png",
          animated: {
            atlas: "hero",
            clip: "idle",
            fallback: "assets/hero-fallback.png",
          },
        },
      },
    },
    backgrounds: { room: "assets/room.png" },
    audio: { bgm: { theme: "assets/theme.ogg" }, sfx: {}, voice: {} },
    animationAtlases: {
      hero: {
        image: "assets/hero-atlas.png",
        frameWidth: 100,
        frameHeight: 100,
        clips: { idle: { frames: [0, 3], fps: 8, loop: true } },
      },
    },
  };

  it("validates safe chapter checkpoints across graph, nodes and manifest", () => {
    const graph = {
      entryNodeId: "opening",
      chapters: [
        { id: "opening", title: "Opening" },
        {
          id: "chapter_2",
          title: "Chapter 2",
          checkpoint: {
            nodeId: "opening",
            instructionId: "missing-line",
            vars: {},
            background: "missing-background",
            sprites: [
              { id: "missing-character", pos: "center", expr: "idle" },
              { id: "hero", pos: "center", expr: "missing-expression" },
            ],
            bgm: { id: "missing-bgm" },
          },
        },
        {
          id: "chapter_3",
          title: "Chapter 3",
          checkpoint: {
            nodeId: "missing",
            vars: {},
            background: null,
            sprites: [],
            bgm: null,
          },
        },
        { id: "chapter_4", title: "Chapter 4" },
      ],
      nodes: [
        { id: "opening", file: "nodes/opening.json", chapterId: "opening" },
        { id: "chapter_2", file: "nodes/chapter-2.json", chapterId: "chapter_2" },
      ],
      edges: [],
    };

    expect(stable(validateProjectSemantics({
      graph,
      manifest,
      nodes: [{ nodeId: "chapter_2", data: [{ t: "narrate", id: "line-1", text: "Hello" }] }],
    }))).toEqual(expect.arrayContaining([
      { code: "checkpoint_node_wrong_chapter", severity: "error", source: "graph", jsonPath: "$.chapters[1].checkpoint.nodeId" },
      { code: "checkpoint_story_point_missing", severity: "error", source: "graph", jsonPath: "$.chapters[1].checkpoint.instructionId" },
      { code: "checkpoint_background_missing", severity: "error", source: "graph", jsonPath: "$.chapters[1].checkpoint.background" },
      { code: "checkpoint_character_missing", severity: "error", source: "graph", jsonPath: "$.chapters[1].checkpoint.sprites[0].id" },
      { code: "checkpoint_character_expr_missing", severity: "error", source: "graph", jsonPath: "$.chapters[1].checkpoint.sprites[1].expr" },
      { code: "checkpoint_bgm_missing", severity: "error", source: "graph", jsonPath: "$.chapters[1].checkpoint.bgm.id" },
      { code: "checkpoint_node_missing", severity: "error", source: "graph", jsonPath: "$.chapters[2].checkpoint.nodeId" },
      { code: "chapter_checkpoint_missing", severity: "warn", source: "graph", jsonPath: "$.chapters[3].checkpoint" },
    ]));
  });

  it("accepts an entry without checkpoint and validates a complete chapter checkpoint", () => {
    const graph = {
      entryNodeId: "opening",
      chapters: [
        { id: "opening", title: "Opening" },
        {
          id: "chapter_2",
          title: "Chapter 2",
          checkpoint: {
            nodeId: "chapter_2",
            instructionId: "line-1",
            vars: {},
            background: "room",
            sprites: [{ id: "hero", pos: "center", expr: "idle" }],
            bgm: { id: "theme" },
          },
        },
      ],
      nodes: [
        { id: "opening", file: "nodes/opening.json", chapterId: "opening" },
        { id: "chapter_2", file: "nodes/chapter-2.json", chapterId: "chapter_2" },
      ],
      edges: [],
    };

    expect(validateProjectSemantics({
      graph,
      manifest,
      nodes: [{ nodeId: "chapter_2", data: [{ t: "narrate", id: "line-1", text: "Hello" }] }],
    })).toEqual([]);
  });

  it("accepts a chapter checkpoint targeting a story-point nested in an if-then branch (Phase 4)", () => {
    const graph = {
      entryNodeId: "opening",
      chapters: [
        { id: "opening", title: "Opening" },
        {
          id: "chapter_2",
          title: "Chapter 2",
          checkpoint: {
            nodeId: "chapter_2",
            instructionId: "nested_hi",
            vars: {},
            background: null,
            sprites: [],
            bgm: null,
          },
        },
      ],
      nodes: [
        { id: "opening", file: "nodes/opening.json", chapterId: "opening" },
        { id: "chapter_2", file: "nodes/chapter-2.json", chapterId: "chapter_2" },
      ],
      edges: [],
    };

    expect(validateProjectSemantics({
      graph,
      manifest,
      nodes: [{ nodeId: "chapter_2", data: [
        { t: "set", key: "affection", value: 80 },
        { t: "if", condition: "affection >= 60", then: [
          { t: "narrate", id: "nested_hi", text: "高好感。" },
        ] },
      ] }],
    })).toEqual([]);
  });

  it("accepts a chapter checkpoint targeting a story-point nested in a choice option body (Phase 4)", () => {
    const graph = {
      entryNodeId: "opening",
      chapters: [
        { id: "opening", title: "Opening" },
        {
          id: "chapter_2",
          title: "Chapter 2",
          checkpoint: {
            nodeId: "chapter_2",
            instructionId: "react",
            vars: {},
            background: null,
            sprites: [],
            bgm: null,
          },
        },
      ],
      nodes: [
        { id: "opening", file: "nodes/opening.json", chapterId: "opening" },
        { id: "chapter_2", file: "nodes/chapter-2.json", chapterId: "chapter_2" },
      ],
      edges: [],
    };

    expect(validateProjectSemantics({
      graph,
      manifest,
      nodes: [{ nodeId: "chapter_2", data: [
        { t: "choice", id: "branch", options: [{
          text: "继续",
          body: [{ t: "say", id: "react", who: "hero", expr: "default", text: "反应。" }],
        }] },
      ] }],
    })).toEqual([]);
  });

  it("rejects a chapter checkpoint targeting a story-point with a stale id in a nested branch (Phase 4)", () => {
    const graph = {
      entryNodeId: "opening",
      chapters: [
        { id: "opening", title: "Opening" },
        {
          id: "chapter_2",
          title: "Chapter 2",
          checkpoint: {
            nodeId: "chapter_2",
            instructionId: "gone",
            vars: {},
            background: null,
            sprites: [],
            bgm: null,
          },
        },
      ],
      nodes: [
        { id: "opening", file: "nodes/opening.json", chapterId: "opening" },
        { id: "chapter_2", file: "nodes/chapter-2.json", chapterId: "chapter_2" },
      ],
      edges: [],
    };

    expect(stable(validateProjectSemantics({
      graph,
      manifest,
      nodes: [{ nodeId: "chapter_2", data: [
        { t: "if", condition: "true", then: [
          { t: "narrate", id: "nested_hi", text: "高好感。" },
        ] },
      ] }],
    }))).toEqual([
      { code: "checkpoint_story_point_missing", severity: "error", source: "graph", jsonPath: "$.chapters[1].checkpoint.instructionId" },
    ]);
  });

  it("does not speculate when graph or manifest structure is invalid", () => {
    expect(validateProjectSemantics({
      graph: { chapters: [] },
      manifest,
      nodes: [],
    })).toEqual([]);
    expect(validateProjectSemantics({
      graph: {
        entryNodeId: "opening",
        chapters: [{ id: "opening", title: "Opening" }],
        nodes: [{ id: "opening", file: "nodes/opening.json", chapterId: "opening" }],
        edges: [],
      },
      manifest: [],
      nodes: [],
    })).toEqual([]);
  });

  it("validates atlas and clip references plus statically-known frame bounds", () => {
    const brokenManifest = structuredClone(manifest);
    brokenManifest.characters.hero.sprites = {
      missingAtlas: { atlas: "missing", clip: "idle", fallback: "assets/missing-atlas.png" },
      missingClip: { atlas: "hero", clip: "missing", fallback: "assets/missing-clip.png" },
    };

    expect(stable(validateProjectSemantics({
      graph: {
        entryNodeId: "opening",
        chapters: [{ id: "opening", title: "Opening" }],
        nodes: [{ id: "opening", file: "nodes/opening.json", chapterId: "opening" }],
        edges: [],
      },
      manifest: brokenManifest,
      nodes: [],
      imageDimensions: { "assets/hero-atlas.png": { width: 200, height: 100 } },
    }))).toEqual([
      { code: "animation_frame_out_of_bounds", severity: "error", source: "manifest", jsonPath: "$.animationAtlases[\"hero\"].clips[\"idle\"].frames[1]" },
      { code: "animation_atlas_missing", severity: "error", source: "manifest", jsonPath: "$.characters[\"hero\"].sprites[\"missingAtlas\"].atlas" },
      { code: "animation_clip_missing", severity: "error", source: "manifest", jsonPath: "$.characters[\"hero\"].sprites[\"missingClip\"].clip" },
    ]);
  });

  it("does not guess atlas bounds without known image dimensions", () => {
    expect(validateProjectSemantics({
      graph: {
        entryNodeId: "opening",
        chapters: [{ id: "opening", title: "Opening" }],
        nodes: [{ id: "opening", file: "nodes/opening.json", chapterId: "opening" }],
        edges: [],
      },
      manifest,
      nodes: [],
    })).toEqual([]);
  });
});

describe("contract default projection corpus", () => {
  for (const testCase of defaultsFixture.cases) {
    it(testCase.id, () => {
      expect(SCHEMAS[testCase.schema].parse(testCase.input)).toEqual(testCase.expected);
    });
  }

  it("variables preserve an optional creator-facing label without changing the stable identifier", () => {
    expect(SCHEMAS.variables.parse({
      version: 1,
      variables: {
        affection: {
          label: "好感度",
          type: "number",
          default: 0,
          nullable: false,
          scope: "run",
          description: "影响角色路线",
        },
      },
    })).toEqual({
      version: 1,
      variables: {
        affection: {
          label: "好感度",
          type: "number",
          default: 0,
          nullable: false,
          scope: "run",
          description: "影响角色路线",
        },
      },
    });
  });
});

function issueOrder(left: ExpectedIssue, right: ExpectedIssue): number {
  const leftKey = `${left.jsonPath}\0${left.code}`;
  const rightKey = `${right.jsonPath}\0${right.code}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}
