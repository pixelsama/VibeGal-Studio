import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Instruction } from "./types";
import {
  formatScenarioInstruction,
  formatScenarioText,
  parseScenarioLine,
  parseScenarioText,
  withoutStoryPointId,
} from "./scenario";
import { withInstructionDefaults } from "./instructionDefaults";

describe("scenario text DSL", () => {
  it("parses blank-line separated frames into instructions with pause for stage-only frames", () => {
    const result = parseScenarioText(`@bg classroom fade
@bgm daily
@char akari smile left

akari: 今天也很安静呢。`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.instructions).toEqual([
      { t: "bg", id: "classroom", trans: "fade" },
      { t: "bgm", id: "daily" },
      { t: "char", id: "akari", expr: "smile", pos: "left" },
      { t: "pause" },
      { t: "say", who: "akari", text: "今天也很安静呢。" },
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
      { t: "effect", type: "shake" },
      { t: "transition", type: "fade_in" },
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
    // Spec 35：@choice 的旧拒绝已移除（choice 重新成为节点内指令）；
    // 未知命令仍报诊断。
    const result = parseScenarioText(`@bg
@nonsense`);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.diagnostics.map((diagnostic) => ({
      line: diagnostic.line,
      message: diagnostic.message,
    }))).toEqual([
      { line: 1, message: "@bg 需要背景 ID。" },
      { line: 2, message: "未知命令：@nonsense" },
    ]);
  });

  it("treats explicit contract defaults as equivalent to omitted fields", () => {
    const parsed = parseScenarioLine("@char akari smile left");
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok || !parsed.instruction) return;
    const explicit = {
      t: "char",
      id: "akari",
      expr: "smile",
      pos: "left",
      trans: "fade",
      ms: 600,
      clear: false,
      remove: false,
    } as Instruction;
    expect(withInstructionDefaults(parsed.instruction)).toEqual(withInstructionDefaults(explicit));
    expect(formatScenarioInstruction(explicit)).toBe("@char akari smile left");
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

    expect(formatScenarioText(instructions)).toBe(`@bg classroom
@char akari smile left
@pause

akari: 早上好。

@showCg cg_001
@playVideo op true
@set route "stay"
@continue`);
  });

  it("parses all readable parameters without materializing omitted defaults", () => {
    const result = parseScenarioText(`@bg ocean_night dissolve 2375ms
@bgm theme 0ms once
@char hero hurt far-left slide 825ms scale=1.25 flip from=left expr=180ms clear out
hero(hurt, 0ms): 别把 : 和 @ 当成语法。
@narrate 2600ms 风停了。
@wait 715ms
@effect blur 2.5 975ms
@transition white_out 1450ms`);

    expect(result).toMatchObject({ ok: true, diagnostics: [] });
    expect(result.instructions).toEqual([
      { t: "bg", id: "ocean_night", trans: "dissolve", ms: 2375 },
      { t: "bgm", id: "theme", fade: 0, loop: false },
      { t: "char", id: "hero", expr: "hurt", pos: "far-left", trans: "slide", ms: 825, scale: 1.25, flip: true, moveFrom: "left", exprMs: 180, clear: true, remove: true },
      { t: "say", who: "hero", expr: "hurt", text: "别把 : 和 @ 当成语法。", ms: 0 },
      { t: "narrate", text: "风停了。", ms: 2600 },
      { t: "wait", ms: 715 },
      { t: "effect", type: "blur", intensity: 2.5, ms: 975 },
      { t: "transition", type: "white_out", ms: 1450 },
    ]);
  });

  it("round-trips every semantic field while hiding story-point ids", () => {
    const instructions: Instruction[] = [
      { t: "bg", id: "ocean_night", trans: "dissolve", ms: 2375 },
      { t: "bgm", id: "theme", fade: 0, loop: false },
      { t: "sfx", id: "door" },
      { t: "voice", id: "line_001" },
      { t: "char", id: "hero", expr: "hurt", pos: "far-left", trans: "slide", ms: 825, scale: 1.25, flip: true, moveFrom: "left", exprMs: 180, clear: true, remove: true },
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

  it("keeps timed dialogue and narration readable while hiding story-point ids", () => {
    const instructions = [
      { t: "say", id: "say_fallback", who: "hero", text: "Keep every semantic field.", ms: 125 },
      { t: "narrate", id: "narrate_fallback", text: "Narration", ms: 250 },
    ] as Instruction[];

    const formatted = formatScenarioText(instructions);
    const result = parseScenarioText(formatted);

    expect(formatted).toContain("hero(125ms): Keep every semantic field.");
    expect(formatted).toContain("@narrate 250ms Narration");
    expect(formatted).not.toContain("@instruction");
    expect(formatted).not.toContain("fallback");
    expect(result).toMatchObject({ ok: true, diagnostics: [] });
    expect(result.instructions).toEqual(instructions.map(withoutStoryPointId));
  });

  it("parses player naming drafts before the backend assigns stable identity", () => {
    const result = parseScenarioText('@inputName playerName "你的名字？"');

    expect(result).toMatchObject({ ok: true, diagnostics: [] });
    expect(result.instructions).toEqual([
      { t: "inputName", key: "playerName", prompt: "你的名字？" },
    ]);
  });

  it("round-trips player naming without exposing instruction JSON or stable identity", () => {
    const instruction = {
      t: "inputName",
      id: "ask_name",
      key: "playerName",
      prompt: "怎么称呼你？\n可以用昵称。",
      default: "旅行者",
      maxLength: 12,
    } as Instruction;

    const formatted = formatScenarioInstruction(instruction);
    const parsed = parseScenarioLine(formatted);

    expect(formatted).toBe('@inputName playerName 12 "怎么称呼你？\\n可以用昵称。" "旅行者"');
    expect(formatted).not.toContain("@instruction");
    expect(formatted).not.toContain("ask_name");
    expect(parsed).toEqual({ ok: true, instruction: withoutStoryPointId(instruction) });
  });

  it("uses the naming length default and reports malformed naming commands", () => {
    expect(parseScenarioLine('@inputName playerName "你的名字？"')).toEqual({
      ok: true,
      instruction: { t: "inputName", key: "playerName", prompt: "你的名字？" },
    });
    expect(parseScenarioLine("@inputName playerName 0 \"名字？\"")).toMatchObject({
      ok: false,
      message: expect.stringContaining("1–100"),
    });
    expect(parseScenarioLine("@inputName playerName 名字？")).toMatchObject({
      ok: false,
      message: expect.stringContaining("引号"),
    });
  });

  it("round-trips line voice in readable dialogue syntax", () => {
    const instruction = {
      t: "say",
      who: "hero",
      expr: "smile",
      text: "这一句有语音。",
      voice: "hero_001",
      ms: 800,
    } as Instruction;

    const formatted = formatScenarioInstruction(instruction);

    expect(formatted).toBe("hero(smile, voice=hero_001, 800ms): 这一句有语音。");
    expect(parseScenarioLine(formatted)).toEqual({ ok: true, instruction });
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
    expect(result.instructions.map(withInstructionDefaults)).toEqual(
      source.map(withoutStoryPointId).map(withInstructionDefaults),
    );
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
