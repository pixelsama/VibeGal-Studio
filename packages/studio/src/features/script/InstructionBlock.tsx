import type { CSSProperties } from "react";
import type {
  Instruction,
  Manifest as EngineManifest,
} from "@galstudio/engine";
import type { GraphNode, ProjectData } from "../../lib/types";
import { ResourcePicker } from "../assets/ResourcePicker";

export function InstructionBlock({
  index,
  instruction,
  manifest,
  graphNodes,
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
  graphNodes?: GraphNode[];
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
      {instruction.t === "choice" ? (
        <div style={blockFieldsStyle}>
          {instruction.choices.map((choice, choiceIndex) => (
            <div key={choiceIndex} style={choiceRowStyle}>
              <TextField
                label="选项文本"
                value={choice.text}
                onChange={(text) => {
                  const choices = instruction.choices.map((item, currentIndex) => (
                    currentIndex === choiceIndex ? { ...item, text } : item
                  ));
                  onUpdate({ ...instruction, choices });
                }}
              />
              <label style={fieldStyle}>
                <span style={fieldLabelStyle}>目标节点</span>
                <div style={pickerRowStyle}>
                  <select
                    value={choice.to}
                    onChange={(event) => {
                      const to = event.target.value;
                      const choices = instruction.choices.map((item, currentIndex) => (
                        currentIndex === choiceIndex ? { ...item, to } : item
                      ));
                      onUpdate({ ...instruction, choices });
                    }}
                    style={selectStyle}
                  >
                    <option value="">选择节点</option>
                    {choice.to && !graphNodes?.some((node) => node.id === choice.to) && (
                      <option value={choice.to}>{`缺失：${choice.to}`}</option>
                    )}
                    {(graphNodes ?? []).map((node) => (
                      <option key={node.id} value={node.id}>{node.title || node.id}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={choice.to}
                    onChange={(event) => {
                      const to = event.target.value;
                      const choices = instruction.choices.map((item, currentIndex) => (
                        currentIndex === choiceIndex ? { ...item, to } : item
                      ));
                      onUpdate({ ...instruction, choices });
                    }}
                    style={inputStyle}
                  />
                </div>
              </label>
              <button
                type="button"
                style={miniButtonStyle}
                onClick={() => {
                  const choices = instruction.choices.filter((_, currentIndex) => currentIndex !== choiceIndex);
                  onUpdate({ ...instruction, choices: choices.length > 0 ? choices : [{ text: "选项", to: "" }] });
                }}
              >
                删除选项
              </button>
            </div>
          ))}
          <button
            type="button"
            style={miniButtonStyle}
            onClick={() => onUpdate({ ...instruction, choices: [...instruction.choices, { text: "选项", to: "" }] })}
          >
            添加选项
          </button>
        </div>
      ) : null}
    </div>
  );
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
  gap: 10,
  padding: 12,
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--bg-app)",
};

const blockHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const blockActionsStyle: CSSProperties = {
  display: "flex",
  gap: 6,
};

const miniButtonStyle: CSSProperties = {
  padding: "4px 8px",
  borderRadius: 6,
  border: "1px solid var(--border-input)",
  background: "var(--bg-panel)",
  color: "var(--text-secondary)",
  cursor: "pointer",
  fontSize: 11,
};

const blockFieldsStyle: CSSProperties = {
  display: "grid",
  gap: 10,
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

const blockTextareaStyle: CSSProperties = {
  minHeight: 90,
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid var(--border-strong)",
  background: "var(--bg-panel)",
  color: "var(--text-primary)",
  fontSize: 13,
  resize: "vertical",
};

const inputStyle: CSSProperties = {
  minWidth: 0,
  padding: "7px 9px",
  borderRadius: 6,
  border: "1px solid var(--border-strong)",
  background: "var(--bg-panel)",
  color: "var(--text-primary)",
  fontSize: 13,
};

const selectStyle: CSSProperties = {
  ...inputStyle,
};

const pickerRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(120px, 0.8fr)",
  gap: 8,
};

const checkboxFieldStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  color: "var(--text-secondary)",
  fontSize: 13,
};

const choiceRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(160px, 1fr) minmax(220px, 1.4fr) auto",
  gap: 10,
  alignItems: "end",
};

const issueListStyle: CSSProperties = {
  display: "grid",
  gap: 4,
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid var(--status-error)",
  background: "var(--bg-tag-error)",
};

const issueItemStyle: CSSProperties = {
  color: "var(--status-error-text)",
  fontSize: 12,
  lineHeight: 1.5,
};
