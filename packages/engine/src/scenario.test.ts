import { describe, expect, it } from "vitest";
import type { Instruction } from "./types";
import {
  formatScenarioText,
  parseScenarioText,
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
@set route "stay"`);
  });
});
