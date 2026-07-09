import type { CSSProperties } from "react";
import type {
  Instruction,
  Manifest as EngineManifest,
} from "@vibegal/engine";
import type { ProjectData } from "../../lib/types";
import { ResourcePicker } from "../assets/ResourcePicker";

export function InstructionBlock({
  index,
  instruction,
  manifest,
  issues,
  onUpdate,
  onDuplicate,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  index: number;
  instruction: Instruction;
  manifest: EngineManifest;
  issues: Array<{ code: string; message: string; jsonPath?: string }>;
  onUpdate: (instruction: Instruction) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  return (
    <div style={blockStyle}>
      <div style={blockHeaderStyle}>
        <strong>{String(index + 1).padStart(2, "0")} · {instruction.t}</strong>
        <div style={blockActionsStyle}>
          <button type="button" style={miniButtonStyle} onClick={onMoveUp}>上移</button>
          <button type="button" style={miniButtonStyle} onClick={onMoveDown}>下移</button>
          <button type="button" style={miniButtonStyle} onClick={onDuplicate}>复制</button>
          <button type="button" style={miniButtonStyle} onClick={onDelete}>删除</button>
        </div>
      </div>
      {issues.length > 0 && (
        <div style={issueListStyle}>
          {issues.map((issue) => (
            <div key={`${issue.code}-${issue.jsonPath ?? issue.message}`} style={issueItemStyle}>
              {issue.code}: {issue.message}
            </div>
          ))}
        </div>
      )}
      {instruction.t === "say" ? (
        <div style={blockFieldsStyle}>
          <ResourcePicker
            label="角色"
            manifest={manifest as ProjectData["content"]["manifest"]}
            kind="character"
            value={instruction.who}
            onChange={(who) => onUpdate({ ...instruction, who })}
          />
          <ResourcePicker
            label="表情"
            manifest={manifest as ProjectData["content"]["manifest"]}
            kind="expression"
            characterId={instruction.who}
            value={instruction.expr}
            onChange={(expr) => onUpdate({ ...instruction, expr })}
          />
          <label style={fieldStyle}>
            <span style={fieldLabelStyle}>文本</span>
            <textarea
              value={instruction.text}
              onChange={(event) => onUpdate({ ...instruction, text: event.target.value })}
              style={blockTextareaStyle}
            />
          </label>
          <NumberField
            label="停顿 ms"
            value={instruction.ms}
            onChange={(value) => onUpdate({ ...instruction, ms: value })}
          />
        </div>
      ) : null}
      {instruction.t === "narrate" ? (
        <div style={blockFieldsStyle}>
          <label style={fieldStyle}>
            <span style={fieldLabelStyle}>旁白</span>
            <textarea
              value={instruction.text}
              onChange={(event) => onUpdate({ ...instruction, text: event.target.value })}
              style={blockTextareaStyle}
            />
          </label>
          <NumberField
            label="停顿 ms"
            value={instruction.ms}
            onChange={(value) => onUpdate({ ...instruction, ms: value })}
          />
        </div>
      ) : null}
      {instruction.t === "bg" ? (
        <div style={blockFieldsStyle}>
          <ResourcePicker
            label="背景"
            manifest={manifest as ProjectData["content"]["manifest"]}
            kind="background"
            value={instruction.id}
            onChange={(id) => onUpdate({ ...instruction, id })}
          />
          <EnumField
            label="转场"
            value={instruction.trans}
            options={["fade", "cut", "dissolve"]}
            onChange={(trans) => onUpdate({ ...instruction, trans: trans as "fade" | "cut" | "dissolve" })}
          />
          <NumberField label="时长 ms" value={instruction.ms} onChange={(ms) => onUpdate({ ...instruction, ms: ms ?? 0 })} />
        </div>
      ) : null}
      {instruction.t === "bgm" ? (
        <div style={blockFieldsStyle}>
          <ResourcePicker
            label="BGM"
            manifest={manifest as ProjectData["content"]["manifest"]}
            kind="bgm"
            value={instruction.id}
            onChange={(id) => onUpdate({ ...instruction, id })}
          />
          <NumberField label="淡入 ms" value={instruction.fade} onChange={(fade) => onUpdate({ ...instruction, fade: fade ?? 0 })} />
          <label style={checkboxFieldStyle}>
            <input
              type="checkbox"
              checked={instruction.loop}
              onChange={(event) => onUpdate({ ...instruction, loop: event.target.checked })}
            />
            循环
          </label>
        </div>
      ) : null}
      {instruction.t === "sfx" ? (
        <div style={blockFieldsStyle}>
          <ResourcePicker
            label="音效"
            manifest={manifest as ProjectData["content"]["manifest"]}
            kind="sfx"
            value={instruction.id}
            onChange={(id) => onUpdate({ ...instruction, id })}
          />
        </div>
      ) : null}
      {instruction.t === "voice" ? (
        <div style={blockFieldsStyle}>
          <ResourcePicker
            label="语音"
            manifest={manifest as ProjectData["content"]["manifest"]}
            kind="voice"
            value={instruction.id}
            onChange={(id) => onUpdate({ ...instruction, id })}
          />
        </div>
      ) : null}
      {instruction.t === "char" ? (
        <div style={blockFieldsStyle}>
          <ResourcePicker
            label="角色"
            manifest={manifest as ProjectData["content"]["manifest"]}
            kind="character"
            value={instruction.id}
            onChange={(id) => onUpdate({ ...instruction, id })}
          />
          <ResourcePicker
            label="表情"
            manifest={manifest as ProjectData["content"]["manifest"]}
            kind="expression"
            characterId={instruction.id}
            value={instruction.expr}
            onChange={(expr) => onUpdate({ ...instruction, expr })}
          />
          <TextField label="位置" value={instruction.pos} onChange={(pos) => onUpdate({ ...instruction, pos })} />
          <EnumField
            label="转场"
            value={instruction.trans}
            options={["fade", "cut", "slide"]}
            onChange={(trans) => onUpdate({ ...instruction, trans: trans as "fade" | "cut" | "slide" })}
          />
          <NumberField label="时长 ms" value={instruction.ms} onChange={(ms) => onUpdate({ ...instruction, ms: ms ?? 0 })} />
          <label style={checkboxFieldStyle}>
            <input
              type="checkbox"
              checked={instruction.clear}
              onChange={(event) => onUpdate({ ...instruction, clear: event.target.checked })}
            />
            入场前清空
          </label>
          <label style={checkboxFieldStyle}>
            <input
              type="checkbox"
              checked={instruction.remove}
              onChange={(event) => onUpdate({ ...instruction, remove: event.target.checked })}
            />
            退场
          </label>
        </div>
      ) : null}
      {instruction.t === "wait" ? (
        <div style={blockFieldsStyle}>
          <NumberField label="等待 ms" value={instruction.ms} onChange={(ms) => onUpdate({ ...instruction, ms: ms ?? 0 })} />
        </div>
      ) : null}
      {instruction.t === "effect" ? (
        <div style={blockFieldsStyle}>
          <EnumField
            label="效果"
            value={instruction.type}
            options={["shake", "flash", "blur"]}
            onChange={(type) => onUpdate({ ...instruction, type: type as "shake" | "flash" | "blur" })}
          />
          <NumberField label="强度" value={instruction.intensity} onChange={(intensity) => onUpdate({ ...instruction, intensity: intensity ?? 0 })} />
          <NumberField label="时长 ms" value={instruction.ms} onChange={(ms) => onUpdate({ ...instruction, ms: ms ?? 0 })} />
        </div>
      ) : null}
      {instruction.t === "transition" ? (
        <div style={blockFieldsStyle}>
          <EnumField
            label="转场"
            value={instruction.type}
            options={["fade_in", "fade_out", "white_in", "white_out", "black"]}
            onChange={(type) => onUpdate({ ...instruction, type: type as "fade_in" | "fade_out" | "white_in" | "white_out" | "black" })}
          />
          <NumberField label="时长 ms" value={instruction.ms} onChange={(ms) => onUpdate({ ...instruction, ms: ms ?? 0 })} />
        </div>
      ) : null}
      {instruction.t === "set" ? (
        <div style={blockFieldsStyle}>
          <TextField label="变量名" value={instruction.key} onChange={(key) => onUpdate({ ...instruction, key })} />
          <TextField
            label="变量值"
            value={formatVariableValue(instruction.value)}
            onChange={(value) => onUpdate({ ...instruction, value: parseVariableValue(value) })}
          />
        </div>
      ) : null}
    </div>
  );
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
  onChange,
}: {
  label: string;
  value?: number;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <label style={fieldStyle}>
      <span style={fieldLabelStyle}>{label}</span>
      <input
        type="number"
        min={0}
        value={value ?? ""}
        onChange={(event) => {
          const raw = event.target.value;
          onChange(raw === "" ? undefined : Math.max(0, Number.parseInt(raw, 10) || 0));
        }}
        style={inputStyle}
      />
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
      <select value={value} onChange={(event) => onChange(event.target.value)} style={selectStyle}>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

const blockStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
  padding: "var(--space-3)",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border)",
  background: "var(--bg-app)",
};

const blockHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--space-3)",
};

const blockActionsStyle: CSSProperties = {
  display: "flex",
  gap: "var(--space-1)",
};

const miniButtonStyle: CSSProperties = {
  padding: "var(--space-1) var(--space-2)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-input)",
  background: "var(--bg-panel)",
  color: "var(--text-secondary)",
  cursor: "pointer",
  fontSize: "var(--text-xs)",
};

const blockFieldsStyle: CSSProperties = {
  display: "grid",
  gap: "var(--space-2)",
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

const blockTextareaStyle: CSSProperties = {
  minHeight: 90,
  padding: "var(--space-2) var(--space-2)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-strong)",
  background: "var(--bg-panel)",
  color: "var(--text-primary)",
  fontSize: "var(--text-base)",
  resize: "vertical",
};

const inputStyle: CSSProperties = {
  minWidth: 0,
  padding: "var(--space-2) var(--space-2)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-strong)",
  background: "var(--bg-panel)",
  color: "var(--text-primary)",
  fontSize: "var(--text-base)",
};

const selectStyle: CSSProperties = {
  ...inputStyle,
};

const checkboxFieldStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  color: "var(--text-secondary)",
  fontSize: "var(--text-base)",
};

const issueListStyle: CSSProperties = {
  display: "grid",
  gap: "var(--space-1)",
  padding: "var(--space-2) var(--space-2)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--status-error)",
  background: "var(--bg-tag-error)",
};

const issueItemStyle: CSSProperties = {
  color: "var(--status-error-text)",
  fontSize: "var(--text-sm)",
  lineHeight: 1.5,
};
