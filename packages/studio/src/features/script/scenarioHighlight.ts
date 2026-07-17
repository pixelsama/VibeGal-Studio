/**
 * 剧本文本的行级语法高亮分词（纯函数）。
 *
 * 透明 textarea + 底层高亮共用同一字体度量，这里只负责把每行拆成
 * 带类别的小段；颜色映射在 ScenarioTextEditor 组件内完成。
 */
import { parseScenarioLine } from "@vibegal/engine";

export type ScenarioTokenKind = "command" | "param" | "speaker" | "text" | "dim" | "invalid";

export interface ScenarioLineToken {
  kind: ScenarioTokenKind;
  text: string;
}

export function highlightScenarioLine(line: string): ScenarioLineToken[] {
  const trimmed = line.trim();
  if (trimmed.length === 0) return [];

  if (trimmed.startsWith("@")) {
    const parsed = parseScenarioLine(trimmed);
    if (!parsed.ok) return [{ kind: "invalid", text: line }];
    if (trimmed === "@continue") return [{ kind: "dim", text: line }];
    if (trimmed === "@instruction" || trimmed.startsWith("@instruction ")) {
      const commandEnd = line.indexOf("@instruction") + "@instruction".length;
      return [
        { kind: "command", text: line.slice(0, commandEnd) },
        { kind: "dim", text: line.slice(commandEnd) },
      ];
    }
    const commandMatch = line.match(/^(\s*@\S+)([\s\S]*)$/);
    if (commandMatch) {
      const [, command, rest] = commandMatch;
      return rest.length > 0
        ? [{ kind: "command", text: command }, { kind: "param", text: rest }]
        : [{ kind: "command", text: command }];
    }
    return [{ kind: "command", text: line }];
  }

  const parsed = parseScenarioLine(trimmed);
  if (!parsed.ok) return [{ kind: "invalid", text: line }];

  const speakerMatch = line.match(/^(\s*[^:：\s][^:：]*?\s*[:：]\s*)([\s\S]*)$/);
  if (speakerMatch && parsed.instruction?.t === "say") {
    return [
      { kind: "speaker", text: speakerMatch[1] },
      { kind: "text", text: speakerMatch[2] },
    ];
  }
  return [{ kind: "text", text: line }];
}
