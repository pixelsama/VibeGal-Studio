import { useRef, useState, type CSSProperties, type ComponentProps, type ReactNode, type Ref } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import {
  formatScenarioInstruction,
  INSTRUCTION_DEFAULTS,
  parseScenarioLine,
  type ScenarioDiagnostic,
  type Instruction,
} from "@vibegal/engine";
import { ResourcePicker } from "../assets/ResourcePicker";
import { StateChangeEditor } from "./StateChangeEditor";
import { variableKind, type VariableDeclaration } from "@vibegal/engine";
import { variableLabel } from "./storyState";
import { BottomSheet } from "../common/BottomSheet";
import { Field, NumberInput, Switch } from "../common/Form";
import type { Manifest } from "../../lib/types";
import type { VariableRegistry } from "@vibegal/engine";

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
  | "inputName"
  | "pause"
  | "unlock"
  | "showCg"
  | "playVideo"
  | "completeEnding"
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

export const INSPECTOR_RAIL_WIDTH = 30;

export function ScenarioNodeLayout({
  editor,
  preview,
  inspector,
  rootRef,
  inspectorPaneId,
  inspectorCollapsed = false,
  inspectorPaneWidth,
  draggingInspector = false,
  onToggleInspectorPane,
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
  onToggleInspectorPane: () => void;
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
        gridTemplateColumns: `minmax(0, 1fr) ${rightWidth} ${INSPECTOR_RAIL_WIDTH}px`,
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
        <BottomSheet title="节点摘要" expandedHeight="48%">
          <div data-region="scenario-inspector" style={inspectorRegionStyle}>{inspector}</div>
        </BottomSheet>
      </section>
      <div style={railStyle}>
        <button
          type="button"
          className="gs-inspector-rail"
          aria-label="切换属性面板"
          aria-controls={inspectorPaneId}
          aria-expanded={!inspectorCollapsed}
          title={inspectorCollapsed ? "显示属性面板" : "收起属性面板"}
          onClick={onToggleInspectorPane}
          style={railButtonStyle}
        >
          {inspectorCollapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
        </button>
        <span style={railLabelStyle}>属性</span>
      </div>
      {resizeHandle}
    </div>
  );
}

export function ScenarioInlineControls({
  instruction,
  manifest,
  variables,
  onChange,
}: {
  instruction: Instruction;
  manifest: Manifest;
  variables?: VariableRegistry;
  onChange: (instruction: Instruction) => void;
}) {
  return (
    <div style={inlinePanelStyle} aria-label="当前行可视化控件">
      <span style={inlineTitleStyle}>{inlineInstructionTitle(instruction)}</span>
      <div style={inlineFieldsStyle}>
        {inlineInstructionFields(instruction, manifest, variables, onChange)}
      </div>
    </div>
  );
}

function inlineInstructionFields(
  instruction: Instruction,
  manifest: Manifest,
  variables: VariableRegistry | undefined,
  onChange: (instruction: Instruction) => void,
): ReactNode {
  switch (instruction.t) {
    case "say":
      return <>
        <CompactResourcePicker label="角色" manifest={manifest} kind="character" value={instruction.who} onChange={(who) => onChange({ ...instruction, who })} />
        <CompactResourcePicker label="表情" manifest={manifest} kind="expression" characterId={instruction.who} value={instruction.expr ?? "default"} onChange={(expr) => onChange({ ...instruction, expr })} />
        <CompactResourcePicker label="本句语音" manifest={manifest} kind="voice" value={instruction.voice ?? ""} onChange={(voice) => onChange(withOptionalVoice(instruction, voice))} />
        <CompactNumber label="停顿" value={instruction.ms ?? 0} onChange={(ms) => onChange({ ...instruction, ms })} />
      </>;
    case "narrate":
      return <CompactNumber label="停顿" value={instruction.ms ?? 0} onChange={(ms) => onChange({ ...instruction, ms })} />;
    case "bg":
      return <>
        <CompactResourcePicker label="背景" manifest={manifest} kind="background" value={instruction.id} onChange={(id) => onChange({ ...instruction, id })} />
        <CompactSelect label="转场" value={instruction.trans ?? "fade"} options={["fade", "cut", "dissolve"]} onChange={(trans) => onChange({ ...instruction, trans: trans as typeof instruction.trans })} />
        <CompactNumber label="时长" value={instruction.ms ?? INSTRUCTION_DEFAULTS.bg.ms} onChange={(ms) => onChange({ ...instruction, ms })} />
      </>;
    case "char":
      return <>
        <CompactResourcePicker label="角色" manifest={manifest} kind="character" value={instruction.id} onChange={(id) => onChange({ ...instruction, id })} />
        <CompactResourcePicker label="表情" manifest={manifest} kind="expression" characterId={instruction.id} value={instruction.expr ?? "default"} onChange={(expr) => onChange({ ...instruction, expr })} />
        <CompactSelect label="位置" value={instruction.pos ?? "center"} options={["left", "center", "right"]} onChange={(pos) => onChange({ ...instruction, pos })} />
        <CompactNumber label="时长" value={instruction.ms ?? INSTRUCTION_DEFAULTS.char.ms} onChange={(ms) => onChange({ ...instruction, ms })} />
        <CompactSwitch label="清场" checked={instruction.clear ?? false} onChange={(clear) => onChange({ ...instruction, clear })} />
        <CompactSwitch label="退场" checked={instruction.remove ?? false} onChange={(remove) => onChange({ ...instruction, remove })} />
      </>;
    case "bgm":
      return <>
        <CompactResourcePicker label="BGM" manifest={manifest} kind="bgm" value={instruction.id} onChange={(id) => onChange({ ...instruction, id })} />
        <CompactNumber label="淡入" value={instruction.fade ?? INSTRUCTION_DEFAULTS.bgm.fade} onChange={(fade) => onChange({ ...instruction, fade })} />
        <CompactSwitch label="循环" checked={instruction.loop ?? true} onChange={(loop) => onChange({ ...instruction, loop })} />
      </>;
    case "sfx":
    case "voice":
      return <CompactResourcePicker label={instruction.t === "sfx" ? "音效" : "语音"} manifest={manifest} kind={instruction.t} value={instruction.id} onChange={(id) => onChange({ ...instruction, id })} />;
    case "showCg":
      return <CompactResourcePicker label="CG" manifest={manifest} kind="cg" value={instruction.id} onChange={(id) => onChange({ ...instruction, id })} />;
    case "playVideo":
      return <>
        <CompactResourcePicker label="视频" manifest={manifest} kind="video" value={instruction.id} onChange={(id) => onChange({ ...instruction, id })} />
        <CompactSwitch label="可跳过" checked={instruction.skippable ?? true} onChange={(skippable) => onChange({ ...instruction, skippable })} />
      </>;
    case "wait":
      return <CompactNumber label="等待毫秒" value={instruction.ms} onChange={(ms) => onChange({ ...instruction, ms })} />;
    case "effect":
      return <>
        <CompactSelect label="效果" value={instruction.type} options={["shake", "flash", "blur"]} onChange={(type) => onChange({ ...instruction, type: type as typeof instruction.type })} />
        <CompactNumber label="强度" value={instruction.intensity ?? INSTRUCTION_DEFAULTS.effect.intensity} onChange={(intensity) => onChange({ ...instruction, intensity })} />
        <CompactNumber label="时长" value={instruction.ms ?? INSTRUCTION_DEFAULTS.effect.ms} onChange={(ms) => onChange({ ...instruction, ms })} />
      </>;
    case "transition":
      return <>
        <CompactSelect label="转场" value={instruction.type} options={["fade_in", "fade_out", "white_in", "white_out", "black"]} onChange={(type) => onChange({ ...instruction, type: type as typeof instruction.type })} />
        <CompactNumber label="时长" value={instruction.ms ?? INSTRUCTION_DEFAULTS.transition.ms} onChange={(ms) => onChange({ ...instruction, ms })} />
      </>;
    case "set":
      return <StateChangeEditor instruction={instruction} variables={variables} onChange={onChange} />;
    case "inputName":
      return <>
        <CompactTextStatePicker label="保存为" manifest={manifest} variables={variables} value={instruction.key} onChange={(key) => onChange({ ...instruction, key })} />
        <CompactNumber label="最多字符" value={instruction.maxLength ?? INSTRUCTION_DEFAULTS.inputName.maxLength} min={1} max={100} onChange={(maxLength) => onChange({ ...instruction, maxLength })} />
      </>;
    default:
      return <span style={mutedTextStyle}>更多参数可在属性面板中编辑。</span>;
  }
}

function CompactResourcePicker(props: ComponentProps<typeof ResourcePicker>) {
  return <div style={inlineFieldStyle}><ResourcePicker {...props} /></div>;
}

function withOptionalVoice(
  instruction: Extract<Instruction, { t: "say" }>,
  voice: string,
): Extract<Instruction, { t: "say" }> {
  const next = { ...instruction, voice: voice || undefined };
  if (next.voice == null) delete next.voice;
  return next;
}

function CompactNumber({
  label,
  value,
  min = 0,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  return <label style={inlineFieldStyle}><span>{label}</span><NumberInput aria-label={label} value={value} min={min} max={max} onChange={(next) => onChange(Math.max(min, Math.min(max ?? Number.POSITIVE_INFINITY, Math.round(next))))} /></label>;
}

function CompactTextStatePicker({
  label,
  manifest,
  variables,
  value,
  onChange,
}: {
  label: string;
  manifest: Manifest;
  variables?: VariableRegistry;
  value: string;
  onChange: (value: string) => void;
}) {
  const states = textStateOptions(variables);
  return (
    <label style={inlineFieldStyle}>
      <span>{label}</span>
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} style={inputStyle}>
        {!states.some(([id]) => id === value) && <option value={value}>{value}</option>}
        {states.map(([id, declaration]) => (
          <option key={id} value={id}>{variableLabel(id, declaration, manifest)}</option>
        ))}
      </select>
    </label>
  );
}

function CompactSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label style={inlineFieldStyle}><span>{label}</span><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} style={inputStyle}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
}

function CompactSwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label style={inlineSwitchStyle}><span>{label}</span><Switch aria-label={label} checked={checked} onChange={onChange} /></label>;
}

function inlineInstructionTitle(instruction: Instruction): string {
  return ({ say: "台词", narrate: "旁白", bg: "背景", char: "角色", bgm: "背景音乐", sfx: "音效", voice: "语音", showCg: "CG", playVideo: "视频", wait: "等待", effect: "画面效果", transition: "转场", set: "改变故事状态", inputName: "玩家命名" } as Record<string, string>)[instruction.t] ?? instruction.t;
}

export function ScenarioInspector({
  selection,
  manifest,
  diagnostics,
  onReplaceInstruction,
  variables,
}: {
  selection: ScenarioSelection;
  manifest: Manifest;
  diagnostics: ScenarioDiagnostic[];
  onReplaceInstruction: (instruction: Instruction) => void;
  variables?: VariableRegistry;
}) {
  const instruction = selection.instruction;

  if (!instruction) {
    // 空闲态不再重复"节点摘要"标题——外层 BottomSheet 标题栏已经标明
    return (
      <InspectorPanel>
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
          <ExpressiveTextField
            label="当前行文本"
            value={instruction.text}
            manifest={manifest}
            variables={variables}
            onChange={(text) => onReplaceInstruction({ ...instruction, text })}
          />
          <ResourcePicker
            label="表情"
            manifest={manifest}
            kind="expression"
            characterId={instruction.who}
            value={instruction.expr ?? INSTRUCTION_DEFAULTS.say.expr}
            onChange={(expr) => onReplaceInstruction({ ...instruction, expr })}
          />
          <ResourcePicker
            label="本句语音"
            manifest={manifest}
            kind="voice"
            value={instruction.voice ?? ""}
            onChange={(voice) => onReplaceInstruction(withOptionalVoice(instruction, voice))}
          />
          <OptionalMillisecondsField
            label="自动播放停顿"
            value={instruction.ms}
            fallback={0}
            hint="0 表示跟随作品的全局自动播放停顿。"
            onChange={(ms) => onReplaceInstruction({ ...instruction, ms })}
          />
          <div style={mutedTextStyle}>这里编辑的内容会同步回左侧当前行；立绘登场与位置变化请使用角色命令。</div>
        </InspectorPanel>
      );
    case "narrate":
      return (
        <InspectorPanel title="旁白">
          <ExpressiveTextField
            label="当前行文本"
            value={instruction.text}
            manifest={manifest}
            variables={variables}
            onChange={(text) => onReplaceInstruction({ ...instruction, text })}
          />
          <OptionalMillisecondsField
            label="自动播放停顿"
            value={instruction.ms}
            fallback={0}
            hint="0 表示跟随作品的全局自动播放停顿。"
            onChange={(ms) => onReplaceInstruction({ ...instruction, ms })}
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
          <NumberField
            label="转场时长（毫秒）"
            value={instruction.ms ?? INSTRUCTION_DEFAULTS.bg.ms}
            min={0}
            integer
            onChange={(ms) => onReplaceInstruction({ ...instruction, ms })}
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
          <NumberField
            label="转场时长（毫秒）"
            value={instruction.ms ?? INSTRUCTION_DEFAULTS.char.ms}
            min={0}
            integer
            onChange={(ms) => onReplaceInstruction({ ...instruction, ms })}
          />
          <BooleanField
            label="登场前清空其他角色"
            checked={instruction.clear ?? INSTRUCTION_DEFAULTS.char.clear}
            onChange={(clear) => onReplaceInstruction({ ...instruction, clear })}
          />
          <BooleanField
            label="让角色退场"
            checked={instruction.remove ?? INSTRUCTION_DEFAULTS.char.remove}
            onChange={(remove) => onReplaceInstruction({ ...instruction, remove })}
          />
        </InspectorPanel>
      );
    case "set":
      return (
        <InspectorPanel title="改变故事状态">
          <StateChangeEditor
            instruction={instruction}
            variables={variables}
            onChange={onReplaceInstruction}
          />
        </InspectorPanel>
      );
    case "inputName":
      return (
        <InspectorPanel title="玩家命名">
          <TextStateField
            label="把名字保存为"
            manifest={manifest}
            variables={variables}
            value={instruction.key}
            onChange={(key) => onReplaceInstruction({ ...instruction, key })}
          />
          <TextField
            label="向玩家提问"
            value={instruction.prompt}
            onChange={(prompt) => onReplaceInstruction({ ...instruction, prompt })}
          />
          <OptionalTextField
            label="默认名字（可选）"
            value={instruction.default}
            onChange={(nextDefault) => onReplaceInstruction(withOptionalDefaultName(instruction, nextDefault))}
          />
          <NumberField
            label="名字最多字符"
            value={instruction.maxLength ?? INSTRUCTION_DEFAULTS.inputName.maxLength}
            min={1}
            max={100}
            integer
            onChange={(maxLength) => onReplaceInstruction({ ...instruction, maxLength })}
          />
          <div style={mutedTextStyle}>玩家填写后，名字会自动写入所选故事状态，后续台词可以直接插入它。</div>
        </InspectorPanel>
      );
    case "bgm":
      return (
        <InspectorPanel title="背景音乐">
          <ResourcePicker
            label="BGM"
            manifest={manifest}
            kind="bgm"
            value={instruction.id}
            onChange={(id) => onReplaceInstruction({ ...instruction, id })}
          />
          <NumberField
            label="淡入时长（毫秒）"
            value={instruction.fade ?? INSTRUCTION_DEFAULTS.bgm.fade}
            min={0}
            integer
            onChange={(fade) => onReplaceInstruction({ ...instruction, fade })}
          />
          <BooleanField
            label="循环播放"
            checked={instruction.loop ?? INSTRUCTION_DEFAULTS.bgm.loop}
            onChange={(loop) => onReplaceInstruction({ ...instruction, loop })}
          />
        </InspectorPanel>
      );
    case "sfx":
      return (
        <InspectorPanel title="音效">
          <ResourcePicker
            label="音效"
            manifest={manifest}
            kind="sfx"
            value={instruction.id}
            onChange={(id) => onReplaceInstruction({ ...instruction, id })}
          />
        </InspectorPanel>
      );
    case "voice":
      return (
        <InspectorPanel title="语音">
          <ResourcePicker
            label="语音"
            manifest={manifest}
            kind="voice"
            value={instruction.id}
            onChange={(id) => onReplaceInstruction({ ...instruction, id })}
          />
        </InspectorPanel>
      );
    case "wait":
      return (
        <InspectorPanel title="等待">
          <NumberField
            label="毫秒"
            value={instruction.ms}
            min={0}
            onChange={(ms) => onReplaceInstruction({ ...instruction, ms: Math.round(ms) })}
          />
        </InspectorPanel>
      );
    case "effect":
      return (
        <InspectorPanel title="画面效果">
          <EnumField
            label="类型"
            value={instruction.type}
            options={["shake", "flash", "blur"]}
            onChange={(type) => onReplaceInstruction({ ...instruction, type: type as typeof instruction.type })}
          />
          <NumberField
            label="效果强度"
            value={instruction.intensity ?? INSTRUCTION_DEFAULTS.effect.intensity}
            min={0}
            max={20}
            step={0.5}
            onChange={(intensity) => onReplaceInstruction({ ...instruction, intensity })}
          />
          <NumberField
            label="持续时长（毫秒）"
            value={instruction.ms ?? INSTRUCTION_DEFAULTS.effect.ms}
            min={0}
            integer
            onChange={(ms) => onReplaceInstruction({ ...instruction, ms })}
          />
        </InspectorPanel>
      );
    case "transition":
      return (
        <InspectorPanel title="转场">
          <EnumField
            label="类型"
            value={instruction.type}
            options={["fade_in", "fade_out", "white_in", "white_out", "black"]}
            optionLabels={{
              fade_in: "淡入",
              fade_out: "淡出",
              white_in: "白场淡入",
              white_out: "白场淡出",
              black: "黑场",
            }}
            onChange={(type) => onReplaceInstruction({ ...instruction, type: type as typeof instruction.type })}
          />
          <NumberField
            label="转场时长（毫秒）"
            value={instruction.ms ?? INSTRUCTION_DEFAULTS.transition.ms}
            min={0}
            integer
            onChange={(ms) => onReplaceInstruction({ ...instruction, ms })}
          />
        </InspectorPanel>
      );
    case "pause":
      return (
        <InspectorPanel title="停顿">
          <div style={mutedTextStyle}>等待玩家点击后继续。空行会自动产生停顿，一般无需手动插入 @pause。</div>
        </InspectorPanel>
      );
    case "unlock":
      return (
        <InspectorPanel title="解锁">
          <EnumField
            label="类型"
            value={instruction.kind}
            options={["cg", "music", "replay", "endings"]}
            onChange={(kind) => onReplaceInstruction({ ...instruction, kind: kind as typeof instruction.kind })}
          />
          <TextField
            label="解锁 ID"
            value={instruction.id}
            onChange={(id) => onReplaceInstruction({ ...instruction, id })}
          />
        </InspectorPanel>
      );
    case "showCg":
      return (
        <InspectorPanel title="CG">
          <ResourcePicker
            label="CG"
            manifest={manifest}
            kind="cg"
            value={instruction.id}
            onChange={(id) => onReplaceInstruction({ ...instruction, id })}
          />
        </InspectorPanel>
      );
    case "playVideo":
      return (
        <InspectorPanel title="视频">
          <ResourcePicker
            label="视频"
            manifest={manifest}
            kind="video"
            value={instruction.id}
            onChange={(id) => onReplaceInstruction({ ...instruction, id })}
          />
          <EnumField
            label="可跳过"
            value={instruction.skippable == null ? "default" : String(instruction.skippable)}
            options={["default", "true", "false"]}
            optionLabels={{ default: "默认", true: "是", false: "否" }}
            onChange={(value) => onReplaceInstruction({
              ...instruction,
              skippable: value === "default" ? undefined : value === "true",
            })}
          />
        </InspectorPanel>
      );
    case "completeEnding":
      return (
        <InspectorPanel title="正式结局结算">
          <TextField label="结局 ID" value={instruction.endingId} onChange={(endingId) => onReplaceInstruction({ ...instruction, endingId })} />
          <div style={mutedTextStyle}>结算会解锁结局，并在当前 playthrough 首次达成时增加周目计数。</div>
        </InspectorPanel>
      );
    default:
      // 当前 switch 已覆盖全部指令类型；保留兜底以防未来新增指令类型时没有表单。
      return (
        <InspectorPanel title={(instruction as Instruction).t}>
          <div style={mutedTextStyle}>该命令可直接在剧本文本中编辑。</div>
        </InspectorPanel>
      );
  }
}

function InspectorPanel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div style={inspectorPanelStyle}>
      {title && <div style={inspectorTitleStyle}>{title}</div>}
      <div style={inspectorBodyStyle}>{children}</div>
    </div>
  );
}

function IssueText({ children }: { children: ReactNode }) {
  return <div style={issueTextStyle}>{children}</div>;
}

function ExpressiveTextField({
  label,
  value,
  manifest,
  variables,
  onChange,
}: {
  label: string;
  value: string;
  manifest: Manifest;
  variables?: VariableRegistry;
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [selectedState, setSelectedState] = useState(textStateOptions(variables)[0]?.[0] ?? "");
  const [pauseMs, setPauseMs] = useState(500);
  const [color, setColor] = useState("#FFD166");
  const [ruby, setRuby] = useState("");

  const insert = (before: string, after = "", fallback = "文字") => {
    const input = inputRef.current;
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? start;
    const selected = value.slice(start, end) || (after ? fallback : "");
    const replacement = `${before}${selected}${after}`;
    onChange(`${value.slice(0, start)}${replacement}${value.slice(end)}`);
    queueMicrotask(() => {
      const next = inputRef.current;
      if (!next) return;
      const cursor = start + replacement.length;
      next.focus();
      next.setSelectionRange(cursor, cursor);
    });
  };

  const states = textStateOptions(variables);
  const themeColors = registeredThemeColors(manifest);
  const currentState = states.some(([id]) => id === selectedState) ? selectedState : states[0]?.[0] ?? "";

  return (
    <div style={expressiveFieldStyle}>
      <label style={fieldStyle}>
        <span style={fieldLabelStyle}>{label}</span>
        <input ref={inputRef} type="text" value={value} onChange={(event) => onChange(event.target.value)} style={inputStyle} />
      </label>
      <div style={expressiveToolbarStyle} aria-label="文本表达工具">
        <label style={toolFieldStyle}>
          <span>故事状态</span>
          <select aria-label="要插入的故事状态" value={currentState} disabled={states.length === 0} onChange={(event) => setSelectedState(event.target.value)} style={toolInputStyle}>
            {states.length === 0 && <option value="">还没有文本故事状态</option>}
            {states.map(([id, declaration]) => <option key={id} value={id}>{variableLabel(id, declaration, manifest)}</option>)}
          </select>
        </label>
        <button type="button" disabled={!currentState} onClick={() => insert(`{${currentState}}`)} style={toolButtonStyle}>插入</button>
        <label style={toolFieldStyle}>
          <span>行内停顿</span>
          <NumberInput aria-label="行内停顿毫秒" value={pauseMs} min={0} onChange={(next) => setPauseMs(Math.max(0, Math.round(next)))} />
        </label>
        <button type="button" onClick={() => insert(`[pause=${pauseMs}]`)} style={toolButtonStyle}>插入</button>
        <button type="button" onClick={() => insert("[b]", "[/b]")} style={toolButtonStyle}>加粗</button>
        <label style={toolFieldStyle}>
          <span>文字颜色</span>
          <select aria-label="文字颜色" value={color} onChange={(event) => setColor(event.target.value)} style={toolInputStyle}>
            <option value="#FFD166">暖黄色</option>
            <option value="#EF476F">强调红</option>
            <option value="#06D6A0">清新绿</option>
            <option value="#118AB2">深海蓝</option>
            {themeColors.map(([id, resolved]) => <option key={id} value={id}>{id} · {resolved}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => insert(`[color=${color}]`, "[/color]")} style={toolButtonStyle}>变色</button>
        <label style={toolFieldStyle}>
          <span>注音</span>
          <input aria-label="注音读音" type="text" value={ruby} placeholder="读音" onChange={(event) => setRuby(event.target.value)} style={toolInputStyle} />
        </label>
        <button type="button" disabled={!ruby.trim()} onClick={() => insert(`[ruby=${ruby.trim()}]`, "[/ruby]")} style={toolButtonStyle}>加注音</button>
      </div>
      <div style={mutedTextStyle}>先选中文字再点加粗、变色或加注音；没有选择时会插入一段可直接替换的示例文字。</div>
    </div>
  );
}

function TextStateField({
  label,
  manifest,
  variables,
  value,
  onChange,
}: {
  label: string;
  manifest: Manifest;
  variables?: VariableRegistry;
  value: string;
  onChange: (value: string) => void;
}) {
  const states = textStateOptions(variables);
  return (
    <label style={fieldStyle}>
      <span style={fieldLabelStyle}>{label}</span>
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} style={inputStyle}>
        {!states.some(([id]) => id === value) && <option value={value}>{value}</option>}
        {states.map(([id, declaration]) => <option key={id} value={id}>{variableLabel(id, declaration, manifest)}</option>)}
      </select>
    </label>
  );
}

function OptionalTextField({ label, value, onChange }: { label: string; value?: string; onChange: (value: string) => void }) {
  return <TextField label={label} value={value ?? ""} onChange={onChange} />;
}

function withOptionalDefaultName(
  instruction: Extract<Instruction, { t: "inputName" }>,
  nextDefault: string,
): Extract<Instruction, { t: "inputName" }> {
  const next = { ...instruction, default: nextDefault || undefined };
  if (next.default == null) delete next.default;
  return next;
}

function textStateOptions(variables?: VariableRegistry): Array<[string, VariableDeclaration]> {
  return Object.entries(variables?.variables ?? {})
    .filter(([, declaration]) => declaration.type === "string" && variableKind(declaration) === "text");
}

function registeredThemeColors(manifest: Manifest): Array<[string, string]> {
  const skins = manifest.uiSkins ?? {};
  const tokens = (skins.default ?? skins[Object.keys(skins)[0] ?? ""])?.tokens ?? {};
  return Object.entries(tokens)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && /^#[0-9a-fA-F]{6}$/.test(entry[1]));
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label style={fieldStyle}>
      <span style={fieldLabelStyle}>{label}</span>
      <input type="text" value={value} onChange={(event) => onChange(event.target.value)} style={inputStyle} />
    </label>
  );
}

function NumberField({
  label,
  value,
  min = 0,
  max,
  step,
  integer = false,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label}>
      {({ id, describedBy, invalid }) => (
        <NumberInput
          id={id}
          describedBy={describedBy}
          invalid={invalid}
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(next) => {
            const normalized = integer ? Math.round(next) : next;
            if (normalized >= min && (max == null || normalized <= max)) onChange(normalized);
          }}
        />
      )}
    </Field>
  );
}

function OptionalMillisecondsField({
  label,
  value,
  fallback,
  hint,
  onChange,
}: {
  label: string;
  value: number | undefined;
  fallback: number;
  hint: string;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={`${label}（毫秒）`} hint={hint}>
      {({ id, describedBy, invalid }) => (
        <NumberInput
          id={id}
          describedBy={describedBy}
          invalid={invalid}
          value={value ?? fallback}
          min={0}
          step={1}
          onChange={(next) => onChange(Math.max(0, Math.round(next)))}
        />
      )}
    </Field>
  );
}

function BooleanField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <Field label={label}>
      {({ id, describedBy }) => (
        <Switch
          id={id}
          describedBy={describedBy}
          checked={checked}
          label={checked ? "是" : "否"}
          onChange={onChange}
        />
      )}
    </Field>
  );
}

function EnumField({
  label,
  value,
  options,
  optionLabels,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  optionLabels?: Record<string, string>;
  onChange: (value: string) => void;
}) {
  return (
    <label style={fieldStyle}>
      <span style={fieldLabelStyle}>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} style={inputStyle}>
        {options.map((option) => (
          <option key={option} value={option}>{optionLabels?.[option] ?? option}</option>
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

const inlinePanelStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  gap: "var(--space-2)",
  maxWidth: "100%",
};

const inlineTitleStyle: CSSProperties = {
  alignSelf: "center",
  flexShrink: 0,
  color: "var(--text-bright)",
  fontSize: "var(--text-sm)",
  fontWeight: 700,
};

const inlineFieldsStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  gap: "var(--space-2)",
  maxWidth: "100%",
  overflowX: "auto",
};

const inlineFieldStyle: CSSProperties = {
  display: "grid",
  gap: 2,
  minWidth: 96,
  color: "var(--text-secondary)",
  fontSize: "var(--text-xs)",
};

const inlineSwitchStyle: CSSProperties = {
  ...inlineFieldStyle,
  minWidth: 60,
};

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
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  minHeight: 0,
  height: "100%",
};

const previewRegionStyle: CSSProperties = {
  flex: "1 1 0",
  minWidth: 0,
  minHeight: 0,
  overflow: "hidden",
  background: "var(--bg-app)",
};

const inspectorRegionStyle: CSSProperties = {
  height: "100%",
  minWidth: 0,
  minHeight: 0,
  overflowY: "auto",
  background: "var(--bg-panel)",
};

/* 常驻竖轨：顶部是与顶栏按钮同高的紧凑切换按钮（配色/hover 走 .gs-inspector-rail），下方竖排标签。 */
const railStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "var(--space-2)",
  padding: "var(--space-2) 0",
  borderLeft: "1px solid var(--border)",
  background: "var(--bg-panel)",
};

const railButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 5,
  fontFamily: "inherit",
  cursor: "pointer",
};

const railLabelStyle: CSSProperties = {
  writingMode: "vertical-rl",
  letterSpacing: 2,
  color: "var(--text-muted)",
  fontSize: "var(--text-xs)",
  userSelect: "none",
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

const expressiveFieldStyle: CSSProperties = {
  display: "grid",
  gap: "var(--space-2)",
};

const expressiveToolbarStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  flexWrap: "wrap",
  gap: "var(--space-2)",
  padding: "var(--space-2)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  background: "var(--bg-inset)",
};

const toolFieldStyle: CSSProperties = {
  display: "grid",
  gap: 2,
  minWidth: 96,
  color: "var(--text-secondary)",
  fontSize: "var(--text-xs)",
};

const toolInputStyle: CSSProperties = {
  ...inputStyle,
  padding: "5px var(--space-2)",
  fontSize: "var(--text-sm)",
};

const toolButtonStyle: CSSProperties = {
  minHeight: 30,
  padding: "5px var(--space-2)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-sm)",
  background: "var(--bg-panel)",
  color: "var(--text-primary)",
  fontFamily: "inherit",
  cursor: "pointer",
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
