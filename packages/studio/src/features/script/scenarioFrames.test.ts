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
});
