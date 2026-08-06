import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Instruction } from "./types";
import {
  findScenarioBlockHeaderAtLine,
  formatScenarioInstruction,
  formatScenarioText,
  parseScenarioText,
  withoutStoryPointId,
} from "./scenario";
import { withInstructionDefaults } from "./instructionDefaults";

const INDENT = "    "; // 4 spaces, one indent level

describe("scenario indentation tree — choice", () => {
  it("parses a choice with two options that each carry body + to", () => {
    const text = [
      "choice",
      `${INDENT}去看看那片火光`,
      `${INDENT}${INDENT}NPC: 你很有勇气！`,
      `${INDENT}${INDENT}@set resolve = resolve + 4`,
      `${INDENT}${INDENT}@to approach`,
      `${INDENT}留在原地`,
      `${INDENT}${INDENT}NPC: 也是稳妥的选择。`,
      `${INDENT}${INDENT}@to shore`,
      "@continue",
    ].join("\n");

    const result = parseScenarioText(text);

    expect(result).toMatchObject({ ok: true, diagnostics: [] });
    if (!result.ok) return;
    expect(result.instructions).toEqual([
      {
        t: "choice",
        prompt: null,
        options: [
          {
            text: "去看看那片火光",
            to: "approach",
            body: [
              { t: "say", who: "NPC", text: "你很有勇气！" },
              { t: "set", key: "resolve", expr: "resolve + 4" },
            ],
          },
          {
            text: "留在原地",
            to: "shore",
            body: [{ t: "say", who: "NPC", text: "也是稳妥的选择。" }],
          },
        ],
      },
    ]);
  });

  it("parses an option whose only content is an inline @to (no body)", () => {
    const text = [
      "choice",
      `${INDENT}去看看那片火光  @to approach`,
      `${INDENT}留在原地  @to shore`,
      "@continue",
    ].join("\n");

    const result = parseScenarioText(text);

    expect(result).toMatchObject({ ok: true, diagnostics: [] });
    if (!result.ok) return;
    expect(result.instructions).toEqual([
      {
        t: "choice",
        prompt: null,
        options: [
          { text: "去看看那片火光", to: "approach" },
          { text: "留在原地", to: "shore" },
        ],
      },
    ]);
  });

  it("parses a choice prompt from the header tail", () => {
    const text = [
      "choice 你打算怎么办？",
      `${INDENT}冲上去  @to fight`,
      `${INDENT}撤退  @to retreat`,
    ].join("\n");

    const result = parseScenarioText(text);

    expect(result).toMatchObject({ ok: true, diagnostics: [] });
    if (!result.ok) return;
    expect(result.instructions[0]).toMatchObject({ t: "choice", prompt: "你打算怎么办？" });
  });

  it("parses a choice instruction id from the header", () => {
    const text = [
      "choice #awakening_choice",
      `${INDENT}A  @to a`,
      `${INDENT}B  @to b`,
    ].join("\n");

    const result = parseScenarioText(text);

    expect(result).toMatchObject({ ok: true, diagnostics: [] });
    if (!result.ok) return;
    expect(result.instructions[0]).toMatchObject({ t: "choice", id: "awakening_choice" });
  });

  it("parses an option with effects block but no body and no to", () => {
    const text = [
      "choice",
      `${INDENT}只是改个变量`,
      `${INDENT}${INDENT}@effects`,
      `${INDENT}${INDENT}${INDENT}@set resolve = resolve + 4`,
      `${INDENT}另一个  @to other`,
    ].join("\n");

    const result = parseScenarioText(text);

    expect(result).toMatchObject({ ok: true, diagnostics: [] });
    if (!result.ok) return;
    expect(result.instructions[0]).toMatchObject({
      t: "choice",
      options: [
        { text: "只是改个变量", effects: [{ t: "set", key: "resolve", expr: "resolve + 4" }] },
        { text: "另一个", to: "other" },
      ],
    });
  });
});

describe("scenario indentation tree — if", () => {
  it("parses an if with then and else branches", () => {
    const text = [
      "if affection_yuki >= 60",
      `${INDENT}@char yuki smile`,
      `${INDENT}yuki: 我也一起去！`,
      "else",
      `${INDENT}@char yuki neutral`,
      `${INDENT}yuki: 小心点。`,
      "@continue",
    ].join("\n");

    const result = parseScenarioText(text);

    expect(result).toMatchObject({ ok: true, diagnostics: [] });
    if (!result.ok) return;
    expect(result.instructions).toEqual([
      {
        t: "if",
        condition: "affection_yuki >= 60",
        then: [
          { t: "char", id: "yuki", expr: "smile" },
          { t: "say", who: "yuki", text: "我也一起去！" },
        ],
        else: [
          { t: "char", id: "yuki", expr: "neutral" },
          { t: "say", who: "yuki", text: "小心点。" },
        ],
      },
    ]);
  });

  it("parses an if without else", () => {
    const text = [
      "if has_key",
      `${INDENT}hero: 门开了。`,
      "@continue",
    ].join("\n");

    const result = parseScenarioText(text);

    expect(result).toMatchObject({ ok: true, diagnostics: [] });
    if (!result.ok) return;
    expect(result.instructions).toEqual([
      {
        t: "if",
        condition: "has_key",
        then: [{ t: "say", who: "hero", text: "门开了。" }],
      },
    ]);
  });

  it("parses an if instruction id from the header", () => {
    const text = [
      "if #gate_check has_key",
      `${INDENT}hero: 门开了。`,
    ].join("\n");

    const result = parseScenarioText(text);

    expect(result).toMatchObject({ ok: true, diagnostics: [] });
    if (!result.ok) return;
    expect(result.instructions[0]).toMatchObject({ t: "if", id: "gate_check", condition: "has_key" });
  });

  it("rejects an else without a preceding if", () => {
    const result = parseScenarioText(["else", `${INDENT}hero: x`].join("\n"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.line).toBe(1);
  });
});

describe("scenario indentation tree — nesting", () => {
  it("parses an if nested inside a choice option body", () => {
    const text = [
      "choice",
      `${INDENT}走近`,
      `${INDENT}${INDENT}if brave >= 5`,
      `${INDENT}${INDENT}${INDENT}NPC: 勇敢！`,
      `${INDENT}${INDENT}else`,
      `${INDENT}${INDENT}${INDENT}NPC: 再想想。`,
      `${INDENT}走开  @to leave`,
    ].join("\n");

    const result = parseScenarioText(text);

    expect(result).toMatchObject({ ok: true, diagnostics: [] });
    if (!result.ok) return;
    const choice = result.instructions[0];
    expect(choice).toMatchObject({ t: "choice" });
    if (choice?.t !== "choice") return;
    expect(choice.options[0].body).toEqual([
      {
        t: "if",
        condition: "brave >= 5",
        then: [{ t: "say", who: "NPC", text: "勇敢！" }],
        else: [{ t: "say", who: "NPC", text: "再想想。" }],
      },
    ]);
  });

  it("parses a choice nested inside an if then branch", () => {
    const text = [
      'if route == "main"',
      `${INDENT}choice`,
      `${INDENT}${INDENT}A  @to a`,
      `${INDENT}${INDENT}B  @to b`,
    ].join("\n");

    const result = parseScenarioText(text);

    expect(result).toMatchObject({ ok: true, diagnostics: [] });
    if (!result.ok) return;
    const iff = result.instructions[0];
    expect(iff).toMatchObject({ t: "if" });
    if (iff?.t !== "if") return;
    expect(iff.then).toEqual([
      {
        t: "choice",
        prompt: null,
        options: [
          { text: "A", to: "a" },
          { text: "B", to: "b" },
        ],
      },
    ]);
  });
});

describe("scenario indentation tree — indentation tolerance", () => {
  it("accepts tab indentation", () => {
    const text = [
      "if has_key",
      "\thero: 门开了。",
      "@continue",
    ].join("\n");

    const result = parseScenarioText(text);

    expect(result).toMatchObject({ ok: true, diagnostics: [] });
    if (!result.ok) return;
    expect(result.instructions).toEqual([
      { t: "if", condition: "has_key", then: [{ t: "say", who: "hero", text: "门开了。" }] },
    ]);
  });

  it("accepts 2-space indentation", () => {
    const text = [
      "if has_key",
      "  hero: 门开了。",
    ].join("\n");

    const result = parseScenarioText(text);

    expect(result).toMatchObject({ ok: true, diagnostics: [] });
  });

  it("coalesces deeper-than-expected indent into the current block", () => {
    // jumped from depth 1 to depth 4 — still belongs to the option body
    const text = [
      "choice",
      `${INDENT}opt`,
      `${INDENT}${INDENT}${INDENT}${INDENT}NPC: x`,
    ].join("\n");

    const result = parseScenarioText(text);

    expect(result).toMatchObject({ ok: true, diagnostics: [] });
    if (!result.ok) return;
    const choice = result.instructions[0];
    if (choice?.t !== "choice") return;
    expect(choice.options[0].body).toEqual([{ t: "say", who: "NPC", text: "x" }]);
  });
});

describe("scenario indentation tree — frame semantics", () => {
  it("does not inject implicit pause inside a choice option body", () => {
    const text = [
      "choice",
      `${INDENT}opt`,
      `${INDENT}${INDENT}@bg room`,
      `${INDENT}${INDENT}@sfx ding`,
      `${INDENT}${INDENT}NPC: 反应台词。`,
      `${INDENT}opt2  @to b`,
    ].join("\n");

    const result = parseScenarioText(text);

    expect(result).toMatchObject({ ok: true, diagnostics: [] });
    if (!result.ok) return;
    const choice = result.instructions[0];
    if (choice?.t !== "choice") return;
    // body should be the 3 instructions, no injected pause
    expect(choice.options[0].body).toEqual([
      { t: "bg", id: "room" },
      { t: "sfx", id: "ding" },
      { t: "say", who: "NPC", text: "反应台词。" },
    ]);
  });

  it("injects implicit pause after a non-blocking choice tail", () => {
    const text = [
      "@bg room",
      "hero: 准备好了吗？",
      "",
      "choice",
      `${INDENT}是  @to yes`,
      `${INDENT}否  @to no`,
    ].join("\n");

    const result = parseScenarioText(text);

    expect(result).toMatchObject({ ok: true, diagnostics: [] });
    if (!result.ok) return;
    // bg + say form a frame; say is blocking so no implicit pause after it.
    // choice is a non-blocking tail, so finishFrame injects a pause AFTER it.
    expect(result.instructions.map((i) => i.t)).toEqual(["bg", "say", "choice", "pause"]);
  });
});

describe("scenario indentation tree — formatting", () => {
  it("formats a choice instruction as an indentation tree", () => {
    const instruction: Instruction = {
      t: "choice",
      id: "awakening_choice",
      prompt: null,
      options: [
        {
          text: "去看看那片火光",
          to: "approach",
          effects: [{ t: "set", key: "resolve", expr: "resolve + 4" }],
        },
        { text: "留在原地", to: "shore" },
      ],
    } as Instruction;

    const formatted = formatScenarioInstruction(instruction);

    expect(formatted).not.toContain("@instruction");
    expect(formatted).not.toContain("awakening_choice"); // id hidden (story point)
    expect(formatted).toContain("choice");
    expect(formatted).toContain("去看看那片火光");
    expect(formatted).toContain("@to approach");
    expect(formatted).toContain("@set resolve = resolve + 4");
  });

  it("formats an if instruction as an indentation tree", () => {
    const instruction: Instruction = {
      t: "if",
      condition: "affection_yuki >= 60",
      then: [{ t: "char", id: "yuki", expr: "smile" }],
      else: [{ t: "char", id: "yuki", expr: "neutral" }],
    } as Instruction;

    const formatted = formatScenarioInstruction(instruction);

    expect(formatted).not.toContain("@instruction");
    expect(formatted).toContain("if affection_yuki >= 60");
    expect(formatted).toContain("else");
    expect(formatted).toContain("@char yuki smile");
    expect(formatted).toContain("@char yuki neutral");
  });

  it("round-trips a choice with body + effects + to", () => {
    const instructions: Instruction[] = [
      { t: "narrate", text: "光照进来。" },
      {
        t: "choice",
        id: "c1",
        prompt: "你怎么办？",
        options: [
          {
            text: "冲过去",
            to: "fight",
            effects: [{ t: "set", key: "resolve", value: 4 }],
            body: [
              { t: "say", who: "NPC", text: "好勇敢！" },
              { t: "sfx", id: "ding" },
            ],
          },
          { text: "观望", body: [{ t: "say", who: "NPC", text: "再等等。" }] },
        ],
      },
      { t: "narrate", text: "远处传来呼救。" },
    ] as Instruction[];

    const formatted = formatScenarioText(instructions);
    const result = parseScenarioText(formatted);

    expect(result).toMatchObject({ ok: true, diagnostics: [] });
    expect(formatted).not.toContain("@instruction");
    expect(formatted).not.toContain("c1"); // story-point id hidden
    expect(result.instructions.map(withInstructionDefaults)).toEqual(
      instructions.map(withoutStoryPointId).map(withInstructionDefaults),
    );
  });

  it("round-trips an if/else with nested instructions", () => {
    const instructions: Instruction[] = [
      {
        t: "if",
        id: "check",
        condition: "affection >= 60",
        then: [
          { t: "char", id: "yuki", expr: "smile" },
          { t: "say", who: "yuki", text: "我也一起去！" },
        ],
        else: [{ t: "char", id: "yuki", expr: "neutral" }],
      },
    ] as Instruction[];

    const formatted = formatScenarioText(instructions);
    const result = parseScenarioText(formatted);

    expect(result).toMatchObject({ ok: true, diagnostics: [] });
    expect(formatted).not.toContain("@instruction");
    expect(result.instructions.map(withInstructionDefaults)).toEqual(
      instructions.map(withoutStoryPointId).map(withInstructionDefaults),
    );
  });

  it("round-trips the sample awakening node (choice with effects + to)", () => {
    const source = JSON.parse(readFileSync(
      new URL("../../../examples/sample-novel/content/nodes/awakening.json", import.meta.url),
      "utf8",
    )) as Instruction[];

    const formatted = formatScenarioText(source);
    const result = parseScenarioText(formatted);

    expect(result).toMatchObject({ ok: true, diagnostics: [] });
    // The choice instruction must render as a readable indent tree, not JSON.
    // (textKey-bearing narrate/say instructions still fall back to @instruction
    //  JSON — that is pre-existing leaf-formatter behavior, not Phase 2 scope.)
    expect(formatted).toContain("choice");
    expect(formatted).toContain("@to approach");
    expect(formatted).toContain("@to shore");
    expect(formatted).toContain("@set resolve = resolve + 4");
    expect(result.instructions.map(withInstructionDefaults)).toEqual(
      source.map(withoutStoryPointId).map(withInstructionDefaults),
    );
  });

  it("falls back to @instruction json when an option text contains a newline", () => {
    // newline in option text cannot be expressed on a single option line
    const instruction: Instruction = {
      t: "choice",
      prompt: null,
      options: [{ text: "第一行\n第二行", to: "x" }],
    } as Instruction;

    const formatted = formatScenarioInstruction(instruction);

    expect(formatted.startsWith("@instruction ")).toBe(true);
    expect(parseScenarioText(formatted)).toMatchObject({ ok: true, diagnostics: [] });
  });
});

describe("scenario indentation tree — continuation marker", () => {
  it("appends @continue when a node ends with a choice (non-blocking tail)", () => {
    const instructions: Instruction[] = [
      {
        t: "choice",
        prompt: null,
        options: [{ text: "A", to: "a" }],
      } as Instruction,
    ];

    const formatted = formatScenarioText(instructions);
    // choice is not blocking, so formatScenarioText appends @continue
    expect(formatted.trimEnd().endsWith("@continue")).toBe(true);
  });
});

describe("scenario indentation tree — block header location", () => {
  it("locates a choice block header by line", () => {
    const text = [
      "@bg room",
      "hero: 开场白。",
      "",
      "choice",
      "    去看看  @to approach",
      "    留在原地  @to shore",
      "@continue",
    ].join("\n");
    const found = findScenarioBlockHeaderAtLine(text, 4); // line 4 = choice
    expect(found).not.toBeNull();
    if (!found) return;
    expect(found.kind).toBe("choice");
    expect(found.startLine).toBe(4);
    expect(found.endLine).toBe(6);
    expect(found.instruction.options).toHaveLength(2);
  });

  it("returns null for non-block-header lines", () => {
    const text = ["hero: 台词。"].join("\n");
    expect(findScenarioBlockHeaderAtLine(text, 1)).toBeNull();
  });
});
