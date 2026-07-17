import { describe, expect, it } from "vitest";
import { highlightScenarioLine } from "./scenarioHighlight";

describe("highlightScenarioLine", () => {
  it("splits @ commands into command and params", () => {
    expect(highlightScenarioLine("@bg classroom fade")).toEqual([
      { kind: "command", text: "@bg" },
      { kind: "param", text: " classroom fade" },
    ]);
    expect(highlightScenarioLine("  @wait 800")).toEqual([
      { kind: "command", text: "  @wait" },
      { kind: "param", text: " 800" },
    ]);
  });

  it("dims @continue and @instruction payloads", () => {
    expect(highlightScenarioLine("@continue")).toEqual([{ kind: "dim", text: "@continue" }]);

    const tokens = highlightScenarioLine('@instruction {"t":"pause"}');
    expect(tokens[0]).toEqual({ kind: "command", text: "@instruction" });
    expect(tokens[1].kind).toBe("dim");
  });

  it("marks unknown commands and malformed lines as invalid", () => {
    expect(highlightScenarioLine("@bogus x")).toEqual([{ kind: "invalid", text: "@bogus x" }]);
    expect(highlightScenarioLine("akari:")).toEqual([{ kind: "invalid", text: "akari:" }]);
    expect(highlightScenarioLine("@choice")).toEqual([{ kind: "invalid", text: "@choice" }]);
  });

  it("splits say lines into speaker and text", () => {
    expect(highlightScenarioLine("akari: 早上好。")).toEqual([
      { kind: "speaker", text: "akari: " },
      { kind: "text", text: "早上好。" },
    ]);
    expect(highlightScenarioLine("明里： 你好")).toEqual([
      { kind: "speaker", text: "明里： " },
      { kind: "text", text: "你好" },
    ]);
  });

  it("treats plain prose as text and blank lines as empty", () => {
    expect(highlightScenarioLine("夜深了。")).toEqual([{ kind: "text", text: "夜深了。" }]);
    expect(highlightScenarioLine("")).toEqual([]);
    expect(highlightScenarioLine("   ")).toEqual([]);
  });
});
