import type { CSSProperties, ReactNode } from "react";
import {
  formatScenarioInstruction,
  parseScenarioLine,
  parseScenarioText,
  type ScenarioDiagnostic,
  type Instruction,
} from "@galstudio/engine";
import { ResourcePicker } from "../assets/ResourcePicker";
import type { GraphNode, Manifest } from "../../lib/types";

export type ScenarioSelectionKind =
  | "empty"
  | "say"
  | "narrate"
  | "bg"
  | "bgm"
  | "sfx"
  | "voice"
  | "char"
  | "wait"
  | "effect"
  | "transition"
  | "choice"
  | "pause"
  | "invalid";

export interface ScenarioSelection {
  kind: ScenarioSelectionKind;
  line: number;
  startLine: number;
  endLine: number;
  lineText: string;
  instruction?: Instruction;
  message?: string;
}

export function getScenarioSelection(text: string, cursorOffset: number): ScenarioSelection {
  const lines = splitLines(text);
  const line = lineNumberAtOffset(text, cursorOffset);
  const lineIndex = Math.max(0, Math.min(line - 1, lines.length - 1));
  const lineText = lines[lineIndex] ?? "";
  const trimmed = lineText.trim();

  if (trimmed === "@choice" || trimmed.startsWith("-")) {
    const choiceStart = findChoiceStart(lines, lineIndex);
    if (choiceStart != null) {
      const choiceEnd = findChoiceEnd(lines, choiceStart);
      const block = lines.slice(choiceStart, choiceEnd + 1).join("\n");
      const result = parseScenarioText(block);
      const choice = result.instructions.find((instruction) => instruction.t === "choice");
      if (choice) {
        return {
          kind: "choice",
          line,
          startLine: choiceStart + 1,
          endLine: choiceEnd + 1,
          lineText,
          instruction: choice,
        };
      }
      return {
        kind: "invalid",
        line,
        startLine: choiceStart + 1,
        endLine: choiceEnd + 1,
        lineText,
        message: result.diagnostics[0]?.message ?? "choice 块格式不合法。",
      };
    }
  }

  if (trimmed.length === 0) {
    return { kind: "empty", line, startLine: line, endLine: line, lineText };
  }

  const parsed = parseScenarioLine(trimmed);
  if (!parsed.ok) {
    return { kind: "invalid", line, startLine: line, endLine: line, lineText, message: parsed.message };
  }
  if (!parsed.instruction) {
    return { kind: "empty", line, startLine: line, endLine: line, lineText };
  }

  return {
    kind: parsed.instruction.t,
    line,
    startLine: line,
    endLine: line,
    lineText,
    instruction: parsed.instruction,
  };
}

export function replaceScenarioSelectionInstruction(
  text: string,
  selection: ScenarioSelection,
  instruction: Instruction,
): string {
  const lines = splitLines(text);
  const replacement = formatScenarioInstruction(instruction).split("\n");
  lines.splice(selection.startLine - 1, selection.endLine - selection.startLine + 1, ...replacement);
  return lines.join("\n");
}

export function ScenarioNodeLayout({
  editor,
  preview,
  inspector,
}: {
  editor: ReactNode;
  preview: ReactNode;
  inspector: ReactNode;
}) {
  return (
    <div style={layoutStyle}>
      <section data-region="scenario-editor" style={editorRegionStyle}>{editor}</section>
      <section style={rightRegionStyle}>
        <div data-region="node-preview" style={previewRegionStyle}>{preview}</div>
        <div data-region="scenario-inspector" style={inspectorRegionStyle}>{inspector}</div>
      </section>
    </div>
  );
}

export function ScenarioInspector({
  selection,
  manifest,
  graphNodes,
  diagnostics,
  onReplaceInstruction,
}: {
  selection: ScenarioSelection;
  manifest: Manifest;
  graphNodes: GraphNode[];
  diagnostics: ScenarioDiagnostic[];
  onReplaceInstruction: (instruction: Instruction) => void;
}) {
  const instruction = selection.instruction;

  if (!instruction) {
    return (
      <InspectorPanel title="节点摘要">
        {selection.message && <IssueText>{selection.message}</IssueText>}
        {diagnostics.length > 0 ? (
          <div style={issueListStyle}>
            {diagnostics.map((diagnostic) => (
              <IssueText key={`${diagnostic.line}-${diagnostic.message}`}>
                第 {diagnostic.line} 行：{diagnostic.message}
              </IssueText>
            ))}
          </div>
        ) : (
          <div style={mutedTextStyle}>选择一行剧本后可在这里编辑命令参数。</div>
        )}
      </InspectorPanel>
    );
  }

  switch (instruction.t) {
    case "say":
      return (
        <InspectorPanel title="台词">
          <ResourcePicker
            label="角色"
            manifest={manifest}
            kind="character"
            value={instruction.who}
            onChange={(who) => onReplaceInstruction({ ...instruction, who })}
          />
          <TextField
            label="当前行文本"
            value={instruction.text}
            onChange={(text) => onReplaceInstruction({ ...instruction, text })}
          />
          <div style={mutedTextStyle}>表情变化请使用 @char 行；这里编辑的内容会同步回左侧当前行。</div>
        </InspectorPanel>
      );
    case "narrate":
      return (
        <InspectorPanel title="旁白">
          <TextField
            label="当前行文本"
            value={instruction.text}
            onChange={(text) => onReplaceInstruction({ ...instruction, text })}
          />
          <div style={mutedTextStyle}>这里编辑的内容会同步回左侧当前行。</div>
        </InspectorPanel>
      );
    case "bg":
      return (
        <InspectorPanel title="背景">
          <ResourcePicker
            label="背景"
            manifest={manifest}
            kind="background"
            value={instruction.id}
            onChange={(id) => onReplaceInstruction({ ...instruction, id })}
          />
          <EnumField
            label="转场"
            value={instruction.trans}
            options={["fade", "cut", "dissolve"]}
            onChange={(trans) => onReplaceInstruction({ ...instruction, trans: trans as "fade" | "cut" | "dissolve" })}
          />
        </InspectorPanel>
      );
    case "char":
      return (
        <InspectorPanel title="角色">
          <ResourcePicker
            label="角色"
            manifest={manifest}
            kind="character"
            value={instruction.id}
            onChange={(id) => onReplaceInstruction({ ...instruction, id })}
          />
          <ResourcePicker
            label="表情"
            manifest={manifest}
            kind="expression"
            characterId={instruction.id}
            value={instruction.expr}
            onChange={(expr) => onReplaceInstruction({ ...instruction, expr })}
          />
          <TextField
            label="位置槽"
            value={instruction.pos}
            onChange={(pos) => onReplaceInstruction({ ...instruction, pos })}
          />
          <EnumField
            label="转场"
            value={instruction.trans}
            options={["fade", "cut", "slide"]}
            onChange={(trans) => onReplaceInstruction({ ...instruction, trans: trans as "fade" | "cut" | "slide" })}
          />
        </InspectorPanel>
      );
    case "choice":
      return (
        <InspectorPanel title="选择">
          {instruction.choices.map((choice, index) => (
            <div key={index} style={choiceRowStyle}>
              <TextField
                label="选项文本"
                value={choice.text}
                onChange={(text) => {
                  const choices = instruction.choices.map((item, currentIndex) => (
                    currentIndex === index ? { ...item, text } : item
                  ));
                  onReplaceInstruction({ ...instruction, choices });
                }}
              />
              <label style={fieldStyle}>
                <span style={fieldLabelStyle}>目标节点</span>
                <select
                  value={choice.to}
                  onChange={(event) => {
                    const to = event.target.value;
                    const choices = instruction.choices.map((item, currentIndex) => (
                      currentIndex === index ? { ...item, to } : item
                    ));
                    onReplaceInstruction({ ...instruction, choices });
                  }}
                  style={inputStyle}
                >
                  <option value="">选择节点</option>
                  {choice.to && !graphNodes.some((node) => node.id === choice.to) && (
                    <option value={choice.to}>{`缺失：${choice.to}`}</option>
                  )}
                  {graphNodes.map((node) => (
                    <option key={node.id} value={node.id}>{node.title || node.id}</option>
                  ))}
                </select>
              </label>
            </div>
          ))}
          <button
            type="button"
            style={miniButtonStyle}
            onClick={() => onReplaceInstruction({
              ...instruction,
              choices: [...instruction.choices, { text: "选项", to: "" }],
            })}
          >
            添加选项
          </button>
        </InspectorPanel>
      );
    default:
      return (
        <InspectorPanel title={instruction.t}>
          <div style={mutedTextStyle}>该命令可直接在剧本文本中编辑。</div>
        </InspectorPanel>
      );
  }
}

function InspectorPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={inspectorPanelStyle}>
      <div style={inspectorTitleStyle}>{title}</div>
      <div style={inspectorBodyStyle}>{children}</div>
    </div>
  );
}

function IssueText({ children }: { children: ReactNode }) {
  return <div style={issueTextStyle}>{children}</div>;
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label style={fieldStyle}>
      <span style={fieldLabelStyle}>{label}</span>
      <input type="text" value={value} onChange={(event) => onChange(event.target.value)} style={inputStyle} />
    </label>
  );
}

function EnumField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label style={fieldStyle}>
      <span style={fieldLabelStyle}>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} style={inputStyle}>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function lineNumberAtOffset(text: string, cursorOffset: number): number {
  const clamped = Math.max(0, Math.min(cursorOffset, text.length));
  let line = 1;
  for (let index = 0; index < clamped; index += 1) {
    if (text[index] === "\n") line += 1;
  }
  return line;
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split("\n");
}

function findChoiceStart(lines: string[], lineIndex: number): number | null {
  if (lines[lineIndex]?.trim() === "@choice") return lineIndex;
  for (let index = lineIndex; index >= 0; index -= 1) {
    const line = lines[index]?.trim() ?? "";
    if (line === "@choice") return index;
    if (line.length === 0) return null;
    if (index !== lineIndex && !line.startsWith("-")) return null;
  }
  return null;
}

function findChoiceEnd(lines: string[], startIndex: number): number {
  let index = startIndex;
  while (index + 1 < lines.length && lines[index + 1].trim().startsWith("-")) {
    index += 1;
  }
  return index;
}

const layoutStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(360px, 42%)",
  width: "100%",
  height: "100%",
  background: "var(--bg-inset)",
};

const editorRegionStyle: CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  borderRight: "1px solid var(--border)",
};

const rightRegionStyle: CSSProperties = {
  display: "grid",
  gridTemplateRows: "minmax(240px, 52%) minmax(220px, 48%)",
  minWidth: 0,
  minHeight: 0,
};

const previewRegionStyle: CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  background: "var(--bg-app)",
  borderBottom: "1px solid var(--border)",
};

const inspectorRegionStyle: CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  overflow: "auto",
  background: "var(--bg-panel)",
};

const inspectorPanelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: 16,
};

const inspectorTitleStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: "var(--text-bright)",
};

const inspectorBodyStyle: CSSProperties = {
  display: "grid",
  gap: 12,
};

const fieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const fieldLabelStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--text-secondary)",
};

const inputStyle: CSSProperties = {
  minWidth: 0,
  padding: "7px 9px",
  borderRadius: 6,
  border: "1px solid var(--border-strong)",
  background: "var(--bg-app)",
  color: "var(--text-primary)",
  fontSize: 13,
};

const choiceRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
  gap: 10,
};

const miniButtonStyle: CSSProperties = {
  justifySelf: "start",
  padding: "5px 10px",
  borderRadius: 6,
  border: "1px solid var(--border-input)",
  background: "var(--bg-app)",
  color: "var(--text-secondary)",
  cursor: "pointer",
  fontSize: 12,
};

const mutedTextStyle: CSSProperties = {
  color: "var(--text-muted)",
  fontSize: 13,
  lineHeight: 1.6,
};

const issueListStyle: CSSProperties = {
  display: "grid",
  gap: 6,
};

const issueTextStyle: CSSProperties = {
  color: "var(--status-error-text)",
  fontSize: 12,
  lineHeight: 1.5,
};
