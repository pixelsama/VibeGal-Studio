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
import {
  translateZhCN,
  useStudioI18n,
  type StudioTranslator,
} from "../../lib/i18n";

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
  const { t } = useStudioI18n();
  const rightWidth = inspectorCollapsed ? "0px" : inspectorPaneWidth ? `${inspectorPaneWidth}px` : "minmax(360px, 42%)";
  return (
    <div
      ref={rootRef}
      className="gs-node-editor-layout"
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
        <BottomSheet title={t("script.scenario.nodeSummary")} expandedHeight="48%">
          <div data-region="scenario-inspector" style={inspectorRegionStyle}>{inspector}</div>
        </BottomSheet>
      </section>
      <div style={railStyle}>
        <button
          type="button"
          className="gs-inspector-rail"
          aria-label={t("script.scenario.toggleInspector")}
          aria-controls={inspectorPaneId}
          aria-expanded={!inspectorCollapsed}
          title={inspectorCollapsed
            ? t("script.scenario.showInspector")
            : t("script.scenario.hideInspector")}
          onClick={onToggleInspectorPane}
          style={railButtonStyle}
        >
          {inspectorCollapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
        </button>
        <span style={railLabelStyle}>{t("script.scenario.properties")}</span>
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
  const { t } = useStudioI18n();
  return (
    <div style={inlinePanelStyle} aria-label={t("script.scenario.inlineControls")}>
      <span style={inlineTitleStyle}>{inlineInstructionTitle(instruction, t)}</span>
      <div style={inlineFieldsStyle}>
        {inlineInstructionFields(instruction, manifest, variables, onChange, t)}
      </div>
    </div>
  );
}

function inlineInstructionFields(
  instruction: Instruction,
  manifest: Manifest,
  variables: VariableRegistry | undefined,
  onChange: (instruction: Instruction) => void,
  t: StudioTranslator,
): ReactNode {
  switch (instruction.t) {
    case "say":
      return <>
        <CompactResourcePicker label={t("script.scenario.field.character")} manifest={manifest} kind="character" value={instruction.who} onChange={(who) => onChange({ ...instruction, who })} />
        <CompactResourcePicker label={t("script.scenario.field.expression")} manifest={manifest} kind="expression" characterId={instruction.who} value={instruction.expr ?? "default"} onChange={(expr) => onChange({ ...instruction, expr })} />
        <CompactResourcePicker label={t("script.scenario.field.lineVoice")} manifest={manifest} kind="voice" value={instruction.voice ?? ""} onChange={(voice) => onChange(withOptionalVoice(instruction, voice))} />
        <CompactNumber label={t("script.scenario.field.pause")} value={instruction.ms ?? 0} onChange={(ms) => onChange({ ...instruction, ms })} />
      </>;
    case "narrate":
      return <CompactNumber label={t("script.scenario.field.pause")} value={instruction.ms ?? 0} onChange={(ms) => onChange({ ...instruction, ms })} />;
    case "bg":
      return <>
        <CompactResourcePicker label={t("script.scenario.field.background")} manifest={manifest} kind="background" value={instruction.id} onChange={(id) => onChange({ ...instruction, id })} />
        <CompactSelect label={t("script.scenario.field.transition")} value={instruction.trans ?? "fade"} options={["fade", "cut", "dissolve"]} onChange={(trans) => onChange({ ...instruction, trans: trans as typeof instruction.trans })} />
        <CompactNumber label={t("script.scenario.field.duration")} value={instruction.ms ?? INSTRUCTION_DEFAULTS.bg.ms} onChange={(ms) => onChange({ ...instruction, ms })} />
      </>;
    case "char":
      return <>
        <CompactResourcePicker label={t("script.scenario.field.character")} manifest={manifest} kind="character" value={instruction.id} onChange={(id) => onChange({ ...instruction, id })} />
        <CompactResourcePicker label={t("script.scenario.field.expression")} manifest={manifest} kind="expression" characterId={instruction.id} value={instruction.expr ?? "default"} onChange={(expr) => onChange({ ...instruction, expr })} />
        <CompactSelect label={t("script.scenario.field.position")} value={instruction.pos ?? "center"} options={["left", "center", "right"]} onChange={(pos) => onChange({ ...instruction, pos })} />
        <CompactNumber label={t("script.scenario.field.scale")} value={instruction.scale ?? INSTRUCTION_DEFAULTS.char.scale} min={0.1} max={4} step={0.1} integer={false} onChange={(scale) => onChange({ ...instruction, scale })} />
        <CompactSwitch label={t("script.scenario.field.flip")} checked={instruction.flip ?? INSTRUCTION_DEFAULTS.char.flip} onChange={(flip) => onChange({ ...instruction, flip })} />
        <CompactNumber label={t("script.scenario.field.expressionTransition")} value={instruction.exprMs ?? INSTRUCTION_DEFAULTS.char.exprMs} onChange={(exprMs) => onChange({ ...instruction, exprMs })} />
        <CompactNumber label={t("script.scenario.field.duration")} value={instruction.ms ?? INSTRUCTION_DEFAULTS.char.ms} onChange={(ms) => onChange({ ...instruction, ms })} />
        <CompactSwitch label={t("script.scenario.field.clear")} checked={instruction.clear ?? false} onChange={(clear) => onChange({ ...instruction, clear })} />
        <CompactSwitch label={t("script.scenario.field.remove")} checked={instruction.remove ?? false} onChange={(remove) => onChange({ ...instruction, remove })} />
      </>;
    case "bgm":
      return <>
        <CompactResourcePicker label="BGM" manifest={manifest} kind="bgm" value={instruction.id} onChange={(id) => onChange({ ...instruction, id })} />
        <CompactNumber label={t("script.scenario.field.fadeIn")} value={instruction.fade ?? INSTRUCTION_DEFAULTS.bgm.fade} onChange={(fade) => onChange({ ...instruction, fade })} />
        <CompactSwitch label={t("script.scenario.field.loop")} checked={instruction.loop ?? true} onChange={(loop) => onChange({ ...instruction, loop })} />
      </>;
    case "sfx":
    case "voice":
      return <CompactResourcePicker label={instruction.t === "sfx" ? t("script.scenario.field.soundEffect") : t("script.scenario.field.voice")} manifest={manifest} kind={instruction.t} value={instruction.id} onChange={(id) => onChange({ ...instruction, id })} />;
    case "showCg":
      return <CompactResourcePicker label="CG" manifest={manifest} kind="cg" value={instruction.id} onChange={(id) => onChange({ ...instruction, id })} />;
    case "playVideo":
      return <>
        <CompactResourcePicker label={t("script.scenario.field.video")} manifest={manifest} kind="video" value={instruction.id} onChange={(id) => onChange({ ...instruction, id })} />
        <CompactSwitch label={t("script.scenario.field.skippable")} checked={instruction.skippable ?? true} onChange={(skippable) => onChange({ ...instruction, skippable })} />
      </>;
    case "wait":
      return <CompactNumber label={t("script.scenario.field.waitMs")} value={instruction.ms} onChange={(ms) => onChange({ ...instruction, ms })} />;
    case "effect":
      return <>
        <CompactSelect label={t("script.scenario.field.effect")} value={instruction.type} options={["shake", "flash", "blur"]} onChange={(type) => onChange({ ...instruction, type: type as typeof instruction.type })} />
        <CompactNumber label={t("script.scenario.field.intensity")} value={instruction.intensity ?? INSTRUCTION_DEFAULTS.effect.intensity} onChange={(intensity) => onChange({ ...instruction, intensity })} />
        <CompactNumber label={t("script.scenario.field.duration")} value={instruction.ms ?? INSTRUCTION_DEFAULTS.effect.ms} onChange={(ms) => onChange({ ...instruction, ms })} />
      </>;
    case "transition":
      return <>
        <CompactSelect label={t("script.scenario.field.transition")} value={instruction.type} options={["fade_in", "fade_out", "white_in", "white_out", "black"]} onChange={(type) => onChange({ ...instruction, type: type as typeof instruction.type })} />
        <CompactNumber label={t("script.scenario.field.duration")} value={instruction.ms ?? INSTRUCTION_DEFAULTS.transition.ms} onChange={(ms) => onChange({ ...instruction, ms })} />
      </>;
    case "set":
      return <StateChangeEditor instruction={instruction} variables={variables} onChange={onChange} />;
    case "inputName":
      return <>
        <CompactTextStatePicker label={t("script.scenario.field.saveAs")} manifest={manifest} variables={variables} value={instruction.key} onChange={(key) => onChange({ ...instruction, key })} />
        <CompactNumber label={t("script.scenario.field.maxCharacters")} value={instruction.maxLength ?? INSTRUCTION_DEFAULTS.inputName.maxLength} min={1} max={100} onChange={(maxLength) => onChange({ ...instruction, maxLength })} />
      </>;
    default:
      return <span style={mutedTextStyle}>{t("script.scenario.moreInInspector")}</span>;
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
  step = 1,
  integer = true,
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
  return <label style={inlineFieldStyle}><span>{label}</span><NumberInput aria-label={label} value={value} min={min} max={max} step={step} onChange={(next) => {
    const bounded = Math.max(min, Math.min(max ?? Number.POSITIVE_INFINITY, next));
    onChange(integer ? Math.round(bounded) : bounded);
  }} /></label>;
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
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="gs-input gs-select">
        {!states.some(([id]) => id === value) && <option value={value}>{value}</option>}
        {states.map(([id, declaration]) => (
          <option key={id} value={id}>{variableLabel(id, declaration, manifest)}</option>
        ))}
      </select>
    </label>
  );
}

function CompactSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label style={inlineFieldStyle}><span>{label}</span><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="gs-input gs-select">{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
}

function CompactSwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label style={inlineSwitchStyle}><span>{label}</span><Switch aria-label={label} checked={checked} onChange={onChange} /></label>;
}

function inlineInstructionTitle(
  instruction: Instruction,
  t: StudioTranslator = translateZhCN,
): string {
  // Spec 35：choice/if 暂无内联控件（结构化编辑属 Phase 2），这里只回退到原始 t。
  const key = ({
    say: "script.scenario.instruction.say",
    narrate: "script.scenario.instruction.narrate",
    bg: "script.scenario.instruction.bg",
    char: "script.scenario.instruction.char",
    bgm: "script.scenario.instruction.bgm",
    sfx: "script.scenario.instruction.sfx",
    voice: "script.scenario.instruction.voice",
    showCg: "script.scenario.instruction.showCg",
    playVideo: "script.scenario.instruction.playVideo",
    wait: "script.scenario.instruction.wait",
    effect: "script.scenario.instruction.effect",
    transition: "script.scenario.instruction.transition",
    set: "script.scenario.instruction.set",
    inputName: "script.scenario.instruction.inputName",
    pause: "script.scenario.instruction.pause",
    unlock: "script.scenario.instruction.unlock",
    completeEnding: "script.scenario.instruction.completeEnding",
    choice: undefined,
    if: undefined,
  } as const)[instruction.t];
  return key ? t(key) : instruction.t;
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
  const { t } = useStudioI18n();
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
                {t("script.scenario.diagnosticLine", {
                  line: diagnostic.line,
                  detail: diagnostic.message,
                })}
              </IssueText>
            ))}
          </div>
        ) : (
          <div style={mutedTextStyle}>{t("script.scenario.selectLineHint")}</div>
        )}
      </InspectorPanel>
    );
  }

  switch (instruction.t) {
    case "say":
      return (
        <InspectorPanel title={t("script.scenario.instruction.say")}>
          <ResourcePicker
            label={t("script.scenario.field.character")}
            manifest={manifest}
            kind="character"
            value={instruction.who}
            onChange={(who) => onReplaceInstruction({ ...instruction, who })}
          />
          <ExpressiveTextField
            label={t("script.scenario.currentLineText")}
            value={instruction.text}
            manifest={manifest}
            variables={variables}
            onChange={(text) => onReplaceInstruction({ ...instruction, text })}
          />
          <ResourcePicker
            label={t("script.scenario.field.expression")}
            manifest={manifest}
            kind="expression"
            characterId={instruction.who}
            value={instruction.expr ?? INSTRUCTION_DEFAULTS.say.expr}
            onChange={(expr) => onReplaceInstruction({ ...instruction, expr })}
          />
          <ResourcePicker
            label={t("script.scenario.field.lineVoice")}
            manifest={manifest}
            kind="voice"
            value={instruction.voice ?? ""}
            onChange={(voice) => onReplaceInstruction(withOptionalVoice(instruction, voice))}
          />
          <OptionalMillisecondsField
            label={t("script.scenario.autoPause")}
            value={instruction.ms}
            fallback={0}
            hint={t("script.scenario.autoPauseHint")}
            onChange={(ms) => onReplaceInstruction({ ...instruction, ms })}
          />
          <div style={mutedTextStyle}>{t("script.scenario.sayHint")}</div>
        </InspectorPanel>
      );
    case "narrate":
      return (
        <InspectorPanel title={t("script.scenario.instruction.narrate")}>
          <ExpressiveTextField
            label={t("script.scenario.currentLineText")}
            value={instruction.text}
            manifest={manifest}
            variables={variables}
            onChange={(text) => onReplaceInstruction({ ...instruction, text })}
          />
          <OptionalMillisecondsField
            label={t("script.scenario.autoPause")}
            value={instruction.ms}
            fallback={0}
            hint={t("script.scenario.autoPauseHint")}
            onChange={(ms) => onReplaceInstruction({ ...instruction, ms })}
          />
          <div style={mutedTextStyle}>{t("script.scenario.narrateHint")}</div>
        </InspectorPanel>
      );
    case "bg":
      return (
        <InspectorPanel title={t("script.scenario.instruction.bg")}>
          <ResourcePicker
            label={t("script.scenario.field.background")}
            manifest={manifest}
            kind="background"
            value={instruction.id}
            onChange={(id) => onReplaceInstruction({ ...instruction, id })}
          />
          <EnumField
            label={t("script.scenario.field.transition")}
            value={instruction.trans ?? "fade"}
            options={["fade", "cut", "dissolve"]}
            onChange={(trans) => onReplaceInstruction({ ...instruction, trans: trans as "fade" | "cut" | "dissolve" })}
          />
          <NumberField
            label={t("script.scenario.transitionDurationMs")}
            value={instruction.ms ?? INSTRUCTION_DEFAULTS.bg.ms}
            min={0}
            integer
            onChange={(ms) => onReplaceInstruction({ ...instruction, ms })}
          />
        </InspectorPanel>
      );
    case "char":
      return (
        <InspectorPanel title={t("script.scenario.instruction.char")}>
          <ResourcePicker
            label={t("script.scenario.field.character")}
            manifest={manifest}
            kind="character"
            value={instruction.id}
            onChange={(id) => onReplaceInstruction({ ...instruction, id })}
          />
          <ResourcePicker
            label={t("script.scenario.field.expression")}
            manifest={manifest}
            kind="expression"
            characterId={instruction.id}
            value={instruction.expr ?? "default"}
            onChange={(expr) => onReplaceInstruction({ ...instruction, expr })}
          />
          <TextField
            label={t("script.scenario.positionSlot")}
            value={instruction.pos ?? "center"}
            onChange={(pos) => onReplaceInstruction({ ...instruction, pos })}
          />
          <details className="gs-disclosure">
            <summary>{t("script.scenario.advancedOptions")}</summary>
            <div style={{ ...inspectorBodyStyle, marginTop: "var(--space-2)" }}>
              <TextField
                label={t("script.scenario.moveFromSlot")}
                value={instruction.moveFrom ?? ""}
                onChange={(moveFrom) => onReplaceInstruction(withOptionalMoveFrom(instruction, moveFrom))}
              />
              <NumberField
                label={t("script.scenario.field.scale")}
                value={instruction.scale ?? INSTRUCTION_DEFAULTS.char.scale}
                min={0.1}
                max={4}
                step={0.1}
                onChange={(scale) => onReplaceInstruction({ ...instruction, scale })}
              />
              <BooleanField
                label={t("script.scenario.horizontalFlip")}
                checked={instruction.flip ?? INSTRUCTION_DEFAULTS.char.flip}
                onChange={(flip) => onReplaceInstruction({ ...instruction, flip })}
              />
              <NumberField
                label={t("script.scenario.expressionTransitionMs")}
                value={instruction.exprMs ?? INSTRUCTION_DEFAULTS.char.exprMs}
                min={0}
                integer
                onChange={(exprMs) => onReplaceInstruction({ ...instruction, exprMs })}
              />
              <EnumField
                label={t("script.scenario.field.transition")}
                value={instruction.trans ?? "fade"}
                options={["fade", "cut", "slide"]}
                onChange={(trans) => onReplaceInstruction({ ...instruction, trans: trans as "fade" | "cut" | "slide" })}
              />
              <NumberField
                label={t("script.scenario.transitionDurationMs")}
                value={instruction.ms ?? INSTRUCTION_DEFAULTS.char.ms}
                min={0}
                integer
                onChange={(ms) => onReplaceInstruction({ ...instruction, ms })}
              />
              <BooleanField
                label={t("script.scenario.clearCharacters")}
                checked={instruction.clear ?? INSTRUCTION_DEFAULTS.char.clear}
                onChange={(clear) => onReplaceInstruction({ ...instruction, clear })}
              />
              <BooleanField
                label={t("script.scenario.removeCharacter")}
                checked={instruction.remove ?? INSTRUCTION_DEFAULTS.char.remove}
                onChange={(remove) => onReplaceInstruction({ ...instruction, remove })}
              />
            </div>
          </details>
        </InspectorPanel>
      );
    case "set":
      return (
        <InspectorPanel title={t("script.scenario.instruction.set")}>
          <StateChangeEditor
            instruction={instruction}
            variables={variables}
            onChange={onReplaceInstruction}
          />
        </InspectorPanel>
      );
    case "inputName":
      return (
        <InspectorPanel title={t("script.scenario.instruction.inputName")}>
          <TextStateField
            label={t("script.scenario.saveNameAs")}
            manifest={manifest}
            variables={variables}
            value={instruction.key}
            onChange={(key) => onReplaceInstruction({ ...instruction, key })}
          />
          <TextField
            label={t("script.scenario.askPlayer")}
            value={instruction.prompt}
            onChange={(prompt) => onReplaceInstruction({ ...instruction, prompt })}
          />
          <OptionalTextField
            label={t("script.scenario.defaultName")}
            value={instruction.default}
            onChange={(nextDefault) => onReplaceInstruction(withOptionalDefaultName(instruction, nextDefault))}
          />
          <NumberField
            label={t("script.scenario.nameMaxCharacters")}
            value={instruction.maxLength ?? INSTRUCTION_DEFAULTS.inputName.maxLength}
            min={1}
            max={100}
            integer
            onChange={(maxLength) => onReplaceInstruction({ ...instruction, maxLength })}
          />
          <div style={mutedTextStyle}>{t("script.scenario.inputNameHint")}</div>
        </InspectorPanel>
      );
    case "bgm":
      return (
        <InspectorPanel title={t("script.scenario.instruction.bgm")}>
          <ResourcePicker
            label="BGM"
            manifest={manifest}
            kind="bgm"
            value={instruction.id}
            onChange={(id) => onReplaceInstruction({ ...instruction, id })}
          />
          <NumberField
            label={t("script.scenario.fadeDurationMs")}
            value={instruction.fade ?? INSTRUCTION_DEFAULTS.bgm.fade}
            min={0}
            integer
            onChange={(fade) => onReplaceInstruction({ ...instruction, fade })}
          />
          <BooleanField
            label={t("script.scenario.loopPlayback")}
            checked={instruction.loop ?? INSTRUCTION_DEFAULTS.bgm.loop}
            onChange={(loop) => onReplaceInstruction({ ...instruction, loop })}
          />
        </InspectorPanel>
      );
    case "sfx":
      return (
        <InspectorPanel title={t("script.scenario.instruction.sfx")}>
          <ResourcePicker
            label={t("script.scenario.field.soundEffect")}
            manifest={manifest}
            kind="sfx"
            value={instruction.id}
            onChange={(id) => onReplaceInstruction({ ...instruction, id })}
          />
        </InspectorPanel>
      );
    case "voice":
      return (
        <InspectorPanel title={t("script.scenario.instruction.voice")}>
          <ResourcePicker
            label={t("script.scenario.field.voice")}
            manifest={manifest}
            kind="voice"
            value={instruction.id}
            onChange={(id) => onReplaceInstruction({ ...instruction, id })}
          />
        </InspectorPanel>
      );
    case "wait":
      return (
        <InspectorPanel title={t("script.scenario.instruction.wait")}>
          <NumberField
            label={t("script.scenario.milliseconds")}
            value={instruction.ms}
            min={0}
            onChange={(ms) => onReplaceInstruction({ ...instruction, ms: Math.round(ms) })}
          />
        </InspectorPanel>
      );
    case "effect":
      return (
        <InspectorPanel title={t("script.scenario.instruction.effect")}>
          <EnumField
            label={t("script.scenario.type")}
            value={instruction.type}
            options={["shake", "flash", "blur"]}
            onChange={(type) => onReplaceInstruction({ ...instruction, type: type as typeof instruction.type })}
          />
          <NumberField
            label={t("script.scenario.effectIntensity")}
            value={instruction.intensity ?? INSTRUCTION_DEFAULTS.effect.intensity}
            min={0}
            max={20}
            step={0.5}
            onChange={(intensity) => onReplaceInstruction({ ...instruction, intensity })}
          />
          <NumberField
            label={t("script.scenario.effectDurationMs")}
            value={instruction.ms ?? INSTRUCTION_DEFAULTS.effect.ms}
            min={0}
            integer
            onChange={(ms) => onReplaceInstruction({ ...instruction, ms })}
          />
        </InspectorPanel>
      );
    case "transition":
      return (
        <InspectorPanel title={t("script.scenario.instruction.transition")}>
          <EnumField
            label={t("script.scenario.type")}
            value={instruction.type}
            options={["fade_in", "fade_out", "white_in", "white_out", "black"]}
            optionLabels={{
              fade_in: t("script.scenario.transition.fadeIn"),
              fade_out: t("script.scenario.transition.fadeOut"),
              white_in: t("script.scenario.transition.whiteIn"),
              white_out: t("script.scenario.transition.whiteOut"),
              black: t("script.scenario.transition.black"),
            }}
            onChange={(type) => onReplaceInstruction({ ...instruction, type: type as typeof instruction.type })}
          />
          <NumberField
            label={t("script.scenario.transitionDurationMs")}
            value={instruction.ms ?? INSTRUCTION_DEFAULTS.transition.ms}
            min={0}
            integer
            onChange={(ms) => onReplaceInstruction({ ...instruction, ms })}
          />
        </InspectorPanel>
      );
    case "pause":
      return (
        <InspectorPanel title={t("script.scenario.instruction.pause")}>
          <div style={mutedTextStyle}>{t("script.scenario.pauseHint")}</div>
        </InspectorPanel>
      );
    case "unlock":
      return (
        <InspectorPanel title={t("script.scenario.instruction.unlock")}>
          <EnumField
            label={t("script.scenario.type")}
            value={instruction.kind}
            options={["cg", "music", "replay", "endings"]}
            onChange={(kind) => onReplaceInstruction({ ...instruction, kind: kind as typeof instruction.kind })}
          />
          <TextField
            label={t("script.scenario.unlockId")}
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
        <InspectorPanel title={t("script.scenario.instruction.playVideo")}>
          <ResourcePicker
            label={t("script.scenario.field.video")}
            manifest={manifest}
            kind="video"
            value={instruction.id}
            onChange={(id) => onReplaceInstruction({ ...instruction, id })}
          />
          <EnumField
            label={t("script.scenario.field.skippable")}
            value={instruction.skippable == null ? "default" : String(instruction.skippable)}
            options={["default", "true", "false"]}
            optionLabels={{ default: t("script.scenario.default"), true: t("script.scenario.yes"), false: t("script.scenario.no") }}
            onChange={(value) => onReplaceInstruction({
              ...instruction,
              skippable: value === "default" ? undefined : value === "true",
            })}
          />
        </InspectorPanel>
      );
    case "completeEnding":
      return (
        <InspectorPanel title={t("script.scenario.instruction.completeEnding")}>
          <TextField label={t("script.scenario.endingId")} value={instruction.endingId} onChange={(endingId) => onReplaceInstruction({ ...instruction, endingId })} />
          <div style={mutedTextStyle}>{t("script.scenario.endingHint")}</div>
        </InspectorPanel>
      );
    default:
      // 当前 switch 已覆盖全部指令类型；保留兜底以防未来新增指令类型时没有表单。
      return (
        <InspectorPanel title={(instruction as Instruction).t}>
          <div style={mutedTextStyle}>{t("script.scenario.directEditHint")}</div>
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
  const { t } = useStudioI18n();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [selectedState, setSelectedState] = useState(textStateOptions(variables)[0]?.[0] ?? "");
  const [pauseMs, setPauseMs] = useState(500);
  const [color, setColor] = useState("#FFD166");
  const [ruby, setRuby] = useState("");

  const insert = (
    before: string,
    after = "",
    fallback = t("script.scenario.textPlaceholder"),
  ) => {
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
      <label className="gs-field">
        <span className="gs-field__label">{label}</span>
        <input ref={inputRef} type="text" value={value} onChange={(event) => onChange(event.target.value)} className="gs-input" />
      </label>
      <details className="gs-disclosure">
        <summary>{t("script.scenario.format")}</summary>
        <div style={expressiveToolbarStyle} aria-label={t("script.scenario.expressiveTools")}>
          <label style={toolFieldStyle}>
            <span>{t("script.scenario.storyState")}</span>
            <select
              aria-label={t("script.scenario.insertState")}
              value={currentState}
              disabled={states.length === 0}
              onChange={(event) => setSelectedState(event.target.value)}
              className="gs-select"
              style={toolSelectStyle}
            >
              {states.length === 0 && <option value="">{t("script.scenario.noTextState")}</option>}
              {states.map(([id, declaration]) => <option key={id} value={id}>{variableLabel(id, declaration, manifest)}</option>)}
            </select>
          </label>
          <button type="button" disabled={!currentState} onClick={() => insert(`{${currentState}}`)} style={toolButtonStyle}>{t("script.scenario.insertStateAction")}</button>
          <label style={toolFieldStyle}>
            <span>{t("script.scenario.inlinePause")}</span>
            <NumberInput aria-label={t("script.scenario.inlinePauseMs")} value={pauseMs} min={0} onChange={(next) => setPauseMs(Math.max(0, Math.round(next)))} />
          </label>
          <button type="button" onClick={() => insert(`[pause=${pauseMs}]`)} style={toolButtonStyle}>{t("script.scenario.insertPauseAction")}</button>
          <button type="button" onClick={() => insert("[b]", "[/b]")} style={toolButtonStyle}>{t("script.scenario.bold")}</button>
          <label style={toolFieldStyle}>
            <span>{t("script.scenario.textColor")}</span>
            <select aria-label={t("script.scenario.textColor")} value={color} onChange={(event) => setColor(event.target.value)} className="gs-select" style={toolSelectStyle}>
              <option value="#FFD166">{t("script.scenario.color.warmYellow")}</option>
              <option value="#EF476F">{t("script.scenario.color.emphasisRed")}</option>
              <option value="#06D6A0">{t("script.scenario.color.freshGreen")}</option>
              <option value="#118AB2">{t("script.scenario.color.deepBlue")}</option>
              {themeColors.map(([id, resolved]) => <option key={id} value={id}>{id} · {resolved}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => insert(`[color=${color}]`, "[/color]")} style={toolButtonStyle}>{t("script.scenario.colorize")}</button>
          <label style={toolFieldStyle}>
            <span>{t("script.scenario.ruby")}</span>
            <input
              aria-label={t("script.scenario.rubyReading")}
              type="text"
              value={ruby}
              placeholder={t("script.scenario.readingPlaceholder")}
              onChange={(event) => setRuby(event.target.value)}
              style={toolInputStyle}
            />
          </label>
          <button type="button" disabled={!ruby.trim()} onClick={() => insert(`[ruby=${ruby.trim()}]`, "[/ruby]")} style={toolButtonStyle}>{t("script.scenario.addRuby")}</button>
        </div>
      </details>
      <div style={mutedTextStyle}>{t("script.scenario.expressiveHint")}</div>
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
    <label className="gs-field">
      <span className="gs-field__label">{label}</span>
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="gs-input gs-select">
        {!states.some(([id]) => id === value) && <option value={value}>{value}</option>}
        {states.map(([id, declaration]) => <option key={id} value={id}>{variableLabel(id, declaration, manifest)}</option>)}
      </select>
    </label>
  );
}

function OptionalTextField({ label, value, onChange }: { label: string; value?: string; onChange: (value: string) => void }) {
  return <TextField label={label} value={value ?? ""} onChange={onChange} />;
}

function withOptionalMoveFrom(
  instruction: Extract<Instruction, { t: "char" }>,
  moveFrom: string,
): Extract<Instruction, { t: "char" }> {
  const next = { ...instruction, moveFrom: moveFrom.trim() || undefined };
  if (next.moveFrom == null) delete next.moveFrom;
  return next;
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
    <label className="gs-field">
      <span className="gs-field__label">{label}</span>
      <input type="text" value={value} onChange={(event) => onChange(event.target.value)} className="gs-input" />
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
  const { t } = useStudioI18n();
  return (
    <Field label={t("script.scenario.millisecondsSuffix", { label })} hint={hint}>
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
  const { t } = useStudioI18n();
  return (
    <Field label={label}>
      {({ id, describedBy }) => (
        <Switch
          id={id}
          describedBy={describedBy}
          checked={checked}
          label={checked ? t("script.scenario.yes") : t("script.scenario.no")}
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
    <label className="gs-field">
      <span className="gs-field__label">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="gs-input gs-select">
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
  width: "100%",
  minWidth: 0,
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
  flex: "1 1 auto",
  flexWrap: "wrap",
  alignItems: "flex-end",
  gap: "var(--space-2)",
  minWidth: 0,
  maxWidth: "100%",
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

const toolSelectStyle: CSSProperties = {
  ...toolInputStyle,
  paddingRight: "var(--space-6)",
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
