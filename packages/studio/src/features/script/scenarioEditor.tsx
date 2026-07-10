import type { CSSProperties, ReactNode, Ref } from "react";
import {
  formatScenarioInstruction,
  parseScenarioLine,
  type ScenarioDiagnostic,
  type Instruction,
} from "@vibegal/engine";
import { ResourcePicker } from "../assets/ResourcePicker";
import type { Manifest } from "../../lib/types";

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
  | "set"
  | "pause"
  | "unlock"
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
    kind: parsed.instruction.t as ScenarioSelectionKind,
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
  rootRef,
  inspectorPaneId,
  inspectorCollapsed = false,
  inspectorPaneWidth,
  draggingInspector = false,
  controls,
  resizeHandle,
}: {
  editor: ReactNode;
  preview: ReactNode;
  inspector: ReactNode;
  rootRef?: Ref<HTMLDivElement>;
  inspectorPaneId?: string;
  inspectorCollapsed?: boolean;
  inspectorPaneWidth?: number;
  draggingInspector?: boolean;
  controls?: ReactNode;
  resizeHandle?: ReactNode;
}) {
  const rightWidth = inspectorCollapsed ? "0px" : inspectorPaneWidth ? `${inspectorPaneWidth}px` : "minmax(360px, 42%)";
  return (
    <div
      ref={rootRef}
      data-node-view-layout="editor-preview-inspector"
      data-node-inspector-state={inspectorCollapsed ? "collapsed" : "expanded"}
      style={{
        ...layoutStyle,
        gridTemplateColumns: `minmax(0, 1fr) ${rightWidth}`,
        transition: draggingInspector ? "none" : "grid-template-columns 160ms ease",
      }}
    >
      <section data-region="scenario-editor" style={editorRegionStyle}>{editor}</section>
      <section
        id={inspectorPaneId}
        aria-hidden={inspectorCollapsed || undefined}
        style={{
          ...rightRegionStyle,
          visibility: inspectorCollapsed ? "hidden" : "visible",
        }}
      >
        <div data-region="node-preview" style={previewRegionStyle}>{preview}</div>
        <div data-region="scenario-inspector" style={inspectorRegionStyle}>{inspector}</div>
      </section>
      {resizeHandle}
      {controls}
    </div>
  );
}

export function ScenarioInspector({
  selection,
  manifest,
  diagnostics,
  onReplaceInstruction,
}: {
  selection: ScenarioSelection;
  manifest: Manifest;
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
            value={instruction.trans ?? "fade"}
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
            value={instruction.expr ?? "default"}
            onChange={(expr) => onReplaceInstruction({ ...instruction, expr })}
          />
          <TextField
            label="位置槽"
            value={instruction.pos ?? "center"}
            onChange={(pos) => onReplaceInstruction({ ...instruction, pos })}
          />
          <EnumField
            label="转场"
            value={instruction.trans ?? "fade"}
            options={["fade", "cut", "slide"]}
            onChange={(trans) => onReplaceInstruction({ ...instruction, trans: trans as "fade" | "cut" | "slide" })}
          />
        </InspectorPanel>
      );
    case "set":
      return (
        <InspectorPanel title="变量">
          <TextField label="变量名" value={instruction.key} onChange={(key) => onReplaceInstruction({ ...instruction, key })} />
          <TextField
            label="变量值"
            value={formatVariableValue(instruction.value)}
            onChange={(value) => onReplaceInstruction({ ...instruction, value: parseVariableValue(value) })}
          />
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

function parseVariableValue(raw: string): string | number | boolean | null {
  const value = raw.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  const numberValue = Number(value);
  if (Number.isFinite(numberValue) && value !== "") return numberValue;
  return value;
}

function formatVariableValue(value: string | number | boolean | null): string {
  return value == null ? "null" : String(value);
}

const layoutStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(360px, 42%)",
  position: "relative",
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
  overflow: "hidden",
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
  gap: "var(--space-3)",
  padding: "var(--space-4)",
};

const inspectorTitleStyle: CSSProperties = {
  fontSize: "var(--text-md)",
  fontWeight: 700,
  color: "var(--text-bright)",
};

const inspectorBodyStyle: CSSProperties = {
  display: "grid",
  gap: "var(--space-3)",
};

const fieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-1)",
};

const fieldLabelStyle: CSSProperties = {
  fontSize: "var(--text-sm)",
  color: "var(--text-secondary)",
};

const inputStyle: CSSProperties = {
  minWidth: 0,
  padding: "7px var(--space-2)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-strong)",
  background: "var(--bg-app)",
  color: "var(--text-primary)",
  fontSize: "var(--text-base)",
};

const mutedTextStyle: CSSProperties = {
  color: "var(--text-muted)",
  fontSize: "var(--text-base)",
  lineHeight: 1.6,
};

const issueListStyle: CSSProperties = {
  display: "grid",
  gap: "var(--space-1)",
};

const issueTextStyle: CSSProperties = {
  color: "var(--status-error-text)",
  fontSize: "var(--text-sm)",
  lineHeight: 1.5,
};
