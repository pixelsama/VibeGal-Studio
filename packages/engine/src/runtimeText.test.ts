import { describe, expect, it } from "vitest";
import {
  formatRuntimeText,
  interpolateRuntimeText,
  parseRuntimeText,
  runtimeTextPauseAt,
} from "./runtimeText";

const registry = {
  version: 1 as const,
  variables: {
    playerName: {
      kind: "text" as const,
      label: "玩家名字",
      type: "string" as const,
      default: "旅行者",
      nullable: false,
      scope: "run" as const,
    },
  },
};

describe("runtime text", () => {
  it("interpolates scalar state by stable ID or unique display label", () => {
    const values = {
      playerName: "小满",
      affection: 42,
      trusted: true,
      secret: null,
    };

    expect(interpolateRuntimeText(
      "{playerName}/{玩家名字}/{affection}/{trusted}/{secret}",
      values,
      registry,
    )).toEqual({
      text: "小满/小满/42/true/null",
      diagnostics: [],
    });
  });

  it("escapes braces and preserves undefined or expression-like placeholders", () => {
    const result = interpolateRuntimeText(
      "{{playerName}} {missing} {playerName.toUpperCase()} {playerName + 1}",
      { playerName: "小满" },
      registry,
    );

    expect(result.text).toBe("{playerName} {missing} {playerName.toUpperCase()} {playerName + 1}");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "text_unknown_variable",
      "text_unknown_variable",
      "text_unknown_variable",
    ]);
  });

  it("parses safe pause color ruby and bold tokens without HTML", () => {
    const content = parseRuntimeText(
      "早上[b]好[/b][pause=500][color=#ff0099]呀[/color][ruby=せかい]世界[/ruby]。",
    );

    expect(content.plainText).toBe("早上好呀世界。");
    expect(content.tokens).toEqual([
      { type: "text", text: "早上" },
      { type: "text", text: "好", bold: true },
      { type: "pause", ms: 500 },
      { type: "text", text: "呀", color: "#FF0099" },
      { type: "text", text: "世界", ruby: "せかい" },
      { type: "text", text: "。" },
    ]);
    expect(runtimeTextPauseAt(content, 3)).toBe(500);
  });

  it("keeps unknown malformed and unsafe markup visible", () => {
    const content = parseRuntimeText(
      "[script]x[/script] [color=red]危险[/color] [b]未闭合",
    );

    expect(content.plainText).toContain("[script]x[/script]");
    expect(content.plainText).toContain("[color=red]危险[/color]");
    expect(content.plainText).toContain("[b]未闭合");
    expect(content.diagnostics.length).toBeGreaterThan(0);
  });

  it("accepts registered theme colors only when they resolve to safe hex", () => {
    expect(parseRuntimeText(
      "[color=dialogueBox.textColor]主题色[/color]",
      { "dialogueBox.textColor": "#123abc" },
    ).tokens).toEqual([{ type: "text", text: "主题色", color: "#123ABC" }]);

    expect(parseRuntimeText(
      "[color=unsafe]正文[/color]",
      { unsafe: "url(javascript:alert(1))" },
    ).plainText).toBe("[color=unsafe]正文[/color]");
  });

  it("formats interpolation before markup parsing", () => {
    expect(formatRuntimeText(
      "你好，[b]{玩家名字}[/b]。",
      { playerName: "小满" },
      registry,
    )).toEqual(expect.objectContaining({
      source: "你好，[b]{玩家名字}[/b]。",
      plainText: "你好，小满。",
      tokens: [
        { type: "text", text: "你好，" },
        { type: "text", text: "小满", bold: true },
        { type: "text", text: "。" },
      ],
      diagnostics: [],
    }));
  });
});
