import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Instruction } from "./types";
import {
  formatScenarioText,
  parseScenarioText,
  withoutStoryPointId,
} from "./scenario";

describe("scenario text DSL", () => {
  it("parses blank-line separated frames into instructions with pause for stage-only frames", () => {
    const result = parseScenarioText(`@bg classroom fade
@bgm daily
@char akari smile left

akari: 今天也很安静呢。`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.instructions).toEqual([
      { t: "bg", id: "classroom", trans: "fade", ms: 1000 },
      { t: "bgm", id: "daily", fade: 1500, loop: true },
      { t: "char", id: "akari", expr: "smile", pos: "left", trans: "fade", ms: 600, clear: false, remove: false },
      { t: "pause" },
      { t: "say", who: "akari", expr: "default", text: "今天也很安静呢。" },
    ]);
  });

  it("parses narrate, audio, wait, set, effect and transition commands", () => {
    const result = parseScenarioText(`普通旁白
@sfx knock
@voice akari_001
@wait 800

@set has_key true
@effect shake
@transition fade_in
@pause`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.instructions).toEqual([
      { t: "narrate", text: "普通旁白" },
      { t: "sfx", id: "knock" },
      { t: "voice", id: "akari_001" },
      { t: "wait", ms: 800 },
      { t: "set", key: "has_key", value: true },
      { t: "effect", type: "shake", intensity: 6, ms: 400 },
      { t: "transition", type: "fade_in", ms: 1000 },
      { t: "pause" },
    ]);
  });

  it("parses media and unlock commands", () => {
    const result = parseScenarioText(`@showCg cg_001
@playVideo op true
@unlock endings true_end`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.instructions).toEqual([
      { t: "showCg", id: "cg_001" },
      { t: "playVideo", id: "op", skippable: true },
      { t: "unlock", kind: "endings", id: "true_end" },
      { t: "pause" },
    ]);
  });

  it("reports line diagnostics for malformed commands", () => {
    const result = parseScenarioText(`@bg
@choice
- 没有目标`);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.diagnostics.map((diagnostic) => ({
      line: diagnostic.line,
      message: diagnostic.message,
    }))).toEqual([
      { line: 1, message: "@bg 需要背景 ID。" },
      { line: 2, message: "分支选项已移到流程图出口，请在流程图中配置。" },
    ]);
  });

  it("formats instructions into stable scenario text", () => {
    const instructions: Instruction[] = [
      { t: "bg", id: "classroom", trans: "fade", ms: 1000 },
      { t: "char", id: "akari", expr: "smile", pos: "left", trans: "fade", ms: 600, clear: false, remove: false },
      { t: "pause" },
      { t: "say", who: "akari", expr: "default", text: "早上好。" },
      { t: "showCg", id: "cg_001" },
      { t: "playVideo", id: "op", skippable: true },
      { t: "set", key: "route", value: "stay" },
    ];

    expect(formatScenarioText(instructions)).toBe(`@bg classroom fade
@char akari smile left
@pause

akari: 早上好。

@showCg cg_001
@playVideo op true
@set route "stay"
@continue`);
  });

  it("round-trips every semantic field while hiding story-point ids", () => {
    const instructions: Instruction[] = [
      { t: "bg", id: "ocean_night", trans: "dissolve", ms: 2375 },
      { t: "bgm", id: "theme", fade: 0, loop: false },
      { t: "sfx", id: "door" },
      { t: "voice", id: "line_001" },
      { t: "char", id: "hero", expr: "hurt", pos: "far-left", trans: "slide", ms: 825, clear: true, remove: true },
      { t: "say", id: "say_001", who: "hero", expr: "hurt", text: "别把 : 和 @ 当成语法。", ms: 0 },
      { t: "narrate", id: "narrate_001", text: "风停了。", ms: 2600 },
      { t: "set", key: "route", value: "line one\n\"quoted\" : value" },
      { t: "wait", id: "wait_001", ms: 715 },
      { t: "effect", type: "blur", intensity: 2.5, ms: 975 },
      { t: "transition", type: "white_out", ms: 1450 },
      { t: "pause", id: "pause_001" },
      { t: "unlock", kind: "endings", id: "true_end" },
      { t: "showCg", id: "cg_finale" },
      { t: "playVideo", id: "ending", skippable: false },
    ];

    const formatted = formatScenarioText(instructions);
    const result = parseScenarioText(formatted);

    expect(result).toMatchObject({ ok: true, diagnostics: [] });
    expect(formatted).not.toContain("say_001");
    expect(formatted).not.toContain("narrate_001");
    expect(formatted).not.toContain("wait_001");
    expect(formatted).not.toContain("pause_001");
    expect(result.instructions).toEqual(instructions.map(withoutStoryPointId));
  });

  it("removes story-point ids from fallback instruction JSON", () => {
    const instructions = [
      { t: "say", id: "say_fallback", who: "hero", text: "Keep every semantic field.", ms: 125 },
      { t: "narrate", id: "narrate_fallback", text: "Narration", ms: 250 },
    ] as Instruction[];

    const formatted = formatScenarioText(instructions);
    const result = parseScenarioText(formatted);

    expect(formatted).toContain('@instruction {"t":"say","who":"hero","text":"Keep every semantic field.","ms":125}');
    expect(formatted).toContain('@instruction {"t":"narrate","text":"Narration","ms":250}');
    expect(formatted).not.toContain("fallback");
    expect(result).toMatchObject({ ok: true, diagnostics: [] });
    expect(result.instructions).toEqual(instructions.map(withoutStoryPointId));
  });

  it("does not confuse resource ids with story-point identity", () => {
    const background = { t: "bg", id: "classroom", ms: 125 } as Instruction;

    expect(withoutStoryPointId(background)).toEqual(background);
    expect(withoutStoryPointId({ t: "wait", id: "wait_001", ms: 125 })).toEqual({ t: "wait", ms: 125 });
  });

  it("preserves omitted default fields and never formats them as undefined", () => {
    const instructions = [
      { t: "bgm", id: "bgm_main", fade: 2500 },
      { t: "char", id: "protagonist", remove: true },
      { t: "say", who: "protagonist", text: "缺省表情仍应保持缺省。" },
      { t: "playVideo", id: "op" },
    ] as Instruction[];

    const formatted = formatScenarioText(instructions);
    const result = parseScenarioText(formatted);

    expect(formatted).not.toContain("undefined");
    expect(result).toMatchObject({ ok: true, diagnostics: [] });
    expect(result.instructions).toEqual(instructions);
  });

  it("preserves negative zero in numeric variable values", () => {
    const instructions = [{ t: "set", key: "offset", value: -0 }] as Instruction[];

    const result = parseScenarioText(formatScenarioText(instructions));

    expect(result).toMatchObject({ ok: true, diagnostics: [] });
    expect(result.instructions).toHaveLength(1);
    expect(Object.is((result.instructions[0] as { value: number }).value, -0)).toBe(true);
  });

  it("round-trips the sample prologue without changing any instruction", () => {
    const source = JSON.parse(readFileSync(
      new URL("../../../examples/sample-novel/content/nodes/prologue.json", import.meta.url),
      "utf8",
    )) as Instruction[];

    const result = parseScenarioText(formatScenarioText(source));

    expect(result).toMatchObject({ ok: true, diagnostics: [] });
    expect(result.instructions).toEqual(source.map(withoutStoryPointId));
  });

  it("does not invent an implicit pause after a formatted non-blocking tail", () => {
    const instructions: Instruction[] = [
      { t: "showCg", id: "cg_001" },
      { t: "playVideo", id: "op", skippable: true },
      { t: "set", key: "route", value: "stay" },
    ];

    const result = parseScenarioText(formatScenarioText(instructions));

    expect(result).toMatchObject({ ok: true, diagnostics: [] });
    expect(result.instructions).toEqual(instructions);
  });
});
