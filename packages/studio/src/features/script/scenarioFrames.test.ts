import { describe, expect, it } from "vitest";
import { parseScenarioText } from "@vibegal/engine";
import { mapScenarioFrames } from "./scenarioFrames";

describe("mapScenarioFrames", () => {
  it("marks blank lines that produce implicit pauses", () => {
    const text = "@bg classroom fade\n\nakari: 早上好。\n\n@bgm daily";
    const map = mapScenarioFrames(text);

    // 第一帧只有非阻塞的 @bg → 空行 2 补隐式停顿；
    // 第二帧的 say 是阻塞指令 → 空行 4 不产生停顿。
    expect(map.implicitPauseLines).toEqual([2]);
  });

  it("suppresses the implicit pause when the frame uses @continue", () => {
    const text = "@bg classroom fade\n@continue\n\nakari: 早上好。";

    expect(mapScenarioFrames(text).implicitPauseLines).toEqual([]);
  });

  it("ignores blank lines before any instruction and after blocking lines", () => {
    const text = "\n\nakari: 早上好。\n\n";

    expect(mapScenarioFrames(text).implicitPauseLines).toEqual([]);
  });

  it("maps every line to the instruction index to start preview from", () => {
    const text = "@bg classroom fade\n\nakari: 早上好。";
    const map = mapScenarioFrames(text);

    // @bg → 指令 0；空行 → 隐式 pause（指令 1）；say → 指令 2
    expect(map.startIndexByLine).toEqual([0, 1, 2]);
  });

  it("points non-instruction lines at the following instruction", () => {
    const text = "@unknown x\n@continue\nakari: 早上好。";
    const map = mapScenarioFrames(text);

    expect(map.startIndexByLine).toEqual([0, 0, 0]);
  });

  it("maps real and implicit instructions back to their exact lines", () => {
    const text = "@bg classroom fade\n\n@continue\nakari: 早上好。";
    const map = mapScenarioFrames(text);

    expect(map.instructionIndexByLine).toEqual([0, 1, null, 2]);
    expect(map.lineByInstructionIndex).toEqual([1, 2, 4]);
  });

  it("leaves invalid and suppressed lines out of reordering targets", () => {
    const text = "@unknown x\n@continue\n\nakari: 早上好。";

    expect(mapScenarioFrames(text).instructionIndexByLine).toEqual([null, null, null, 0]);
  });

  it("keeps its instruction count in sync with the engine parser", () => {
    const text = "@bg classroom fade\n\n@bgm daily\n@wait 800\n\nakari: 早上好。";
    const map = mapScenarioFrames(text);
    const parsed = parseScenarioText(text);

    expect(parsed.ok).toBe(true);
    const maxStartIndex = Math.max(...map.startIndexByLine);
    expect(maxStartIndex).toBeLessThan(parsed.instructions.length);
    // 最后一行是阻塞指令，后面没有更多指令；起跑下标总数不超过引擎指令数
    expect(map.startIndexByLine[map.startIndexByLine.length - 1]).toBe(parsed.instructions.length - 1);
  });

  // ── Spec 35 Phase 2：choice / if 块的缩进感知帧映射 ──

  it("maps a choice block header and all its nested lines to one top-level index", () => {
    const text = [
      "@bg room",
      "hero: 开场。",
      "",
      "choice",
      "    去看看  @to approach",
      "        @effects",
      "            @set resolve = resolve + 4",
      "    留在原地  @to shore",
      "@continue",
    ].join("\n");
    const map = mapScenarioFrames(text);
    const parsed = parseScenarioText(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // bg(0), say(1), choice(2) — 3 条顶层指令（@continue 抑制尾部 pause）
    expect(parsed.instructions.length).toBe(3);
    // choice 块头（第 4 行）映射到 index 2
    expect(map.instructionIndexByLine[3]).toBe(2);
    // option 行（第 5 行）也映射到 choice 的 index 2
    expect(map.instructionIndexByLine[4]).toBe(2);
    // @effects 行（第 6 行）映射到 index 2
    expect(map.instructionIndexByLine[5]).toBe(2);
    // effect set 行（第 7 行）映射到 index 2
    expect(map.instructionIndexByLine[6]).toBe(2);
    // 第二个 option（第 8 行）映射到 index 2
    expect(map.instructionIndexByLine[7]).toBe(2);
    // 块头行被登记
    expect(map.blockHeaderLines).toContain(4);
  });

  it("maps an if/else block and its branches to one top-level index", () => {
    const text = [
      "if affection >= 60",
      "    yuki: 我也一起去！",
      "else",
      "    yuki: 小心点。",
      "@continue",
    ].join("\n");
    const map = mapScenarioFrames(text);
    // if 块头（第 1 行）→ index 0；then 行（第 2 行）→ 0；else 行（第 3 行）→ 0；else body（第 4 行）→ 0
    expect(map.instructionIndexByLine[0]).toBe(0);
    expect(map.instructionIndexByLine[1]).toBe(0);
    expect(map.instructionIndexByLine[2]).toBe(0);
    expect(map.instructionIndexByLine[3]).toBe(0);
    expect(map.blockHeaderLines).toContain(1);
  });

  it("maps nested choice-in-if lines to the outer if block index", () => {
    const text = [
      "if route == \"main\"",
      "    choice",
      "        A  @to a",
      "        B  @to b",
      "@continue",
    ].join("\n");
    const map = mapScenarioFrames(text);
    // 整个 if（含嵌套 choice）算作顶层 index 0
    expect(map.instructionIndexByLine[0]).toBe(0);
    expect(map.instructionIndexByLine[1]).toBe(0); // nested choice header
    expect(map.instructionIndexByLine[2]).toBe(0); // option A
    expect(map.instructionIndexByLine[3]).toBe(0); // option B
  });
});
