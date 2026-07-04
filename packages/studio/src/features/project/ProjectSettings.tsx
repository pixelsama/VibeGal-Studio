import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { saveFile } from "../../lib/tauri";
import type { FileRevision, ProjectData } from "../../lib/types";
import {
  DEFAULT_STAGE_RESOLUTION,
  STAGE_HEIGHT_RANGE,
  STAGE_WIDTH_RANGE,
  readStageResolution,
  withStageResolution,
  type StageResolution,
} from "../../lib/projectMeta";

type SaveFileFn = (
  projectPath: string,
  relPath: string,
  content: string,
  expectedRevision?: FileRevision | null,
) => Promise<void>;

const STAGE_PRESETS: StageResolution[] = [
  DEFAULT_STAGE_RESOLUTION,
  { width: 1920, height: 1080 },
  { width: 960, height: 540 },
  { width: 1024, height: 768 },
];

export async function saveProjectStageResolution({
  project,
  stage,
  saveFileFn = saveFile,
}: {
  project: ProjectData;
  stage: StageResolution;
  saveFileFn?: SaveFileFn;
}): Promise<void> {
  const nextMeta = withStageResolution(project.content.meta, stage);
  await saveFileFn(
    project.path,
    "content/meta.json",
    JSON.stringify(nextMeta, null, 2),
    project.metaRevision,
  );
}

export function ProjectSettings({
  project,
  onSaved,
}: {
  project: ProjectData;
  onSaved: () => void | Promise<void>;
}) {
  const initialStage = useMemo(() => readStageResolution(project.content.meta), [project.content.meta]);
  const [widthText, setWidthText] = useState(String(initialStage.width));
  const [heightText, setHeightText] = useState(String(initialStage.height));
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setWidthText(String(initialStage.width));
    setHeightText(String(initialStage.height));
    setStatus(null);
  }, [initialStage]);

  const draft = parseStageDraft(widthText, heightText);
  const activePreset = draft
    ? STAGE_PRESETS.find((preset) => preset.width === draft.width && preset.height === draft.height)
    : null;

  const handlePreset = (stage: StageResolution) => {
    setWidthText(String(stage.width));
    setHeightText(String(stage.height));
    setStatus(null);
  };

  const handleSave = async () => {
    if (!draft || saving) return;
    setSaving(true);
    setStatus(null);
    try {
      await saveProjectStageResolution({ project, stage: draft });
      await onSaved();
      setStatus("已保存");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={pageStyle}>
      <section style={sectionStyle}>
        <div style={headerRowStyle}>
          <h2 style={sectionTitleStyle}>项目</h2>
          {status && <span style={statusStyle}>{status}</span>}
        </div>

        <div style={fieldGroupStyle}>
          <span style={fieldLabelStyle}>舞台分辨率</span>
          <div style={presetRowStyle}>
            {STAGE_PRESETS.map((preset) => {
              const active = activePreset === preset;
              return (
                <button
                  key={`${preset.width}x${preset.height}`}
                  type="button"
                  onClick={() => handlePreset(preset)}
                  aria-pressed={active}
                  style={{
                    ...presetButtonStyle,
                    borderColor: active ? "var(--accent)" : "var(--border-strong)",
                    color: active ? "var(--text-bright)" : "var(--text-secondary)",
                  }}
                >
                  {preset.width} x {preset.height}
                </button>
              );
            })}
          </div>
          <div style={numberRowStyle}>
            <NumberField label="宽" value={widthText} onChange={setWidthText} />
            <NumberField label="高" value={heightText} onChange={setHeightText} />
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!draft || saving}
              style={{
                ...saveButtonStyle,
                opacity: !draft || saving ? 0.55 : 1,
                cursor: !draft || saving ? "default" : "pointer",
              }}
            >
              {saving ? "保存中" : "保存"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function parseStageDraft(widthText: string, heightText: string): StageResolution | null {
  const width = Number(widthText);
  const height = Number(heightText);
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < STAGE_WIDTH_RANGE.min ||
    width > STAGE_WIDTH_RANGE.max ||
    height < STAGE_HEIGHT_RANGE.min ||
    height > STAGE_HEIGHT_RANGE.max
  ) {
    return null;
  }
  return { width, height };
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label style={numberFieldStyle}>
      <span style={numberLabelStyle}>{label}</span>
      <input
        type="number"
        value={value}
        min={label === "宽" ? STAGE_WIDTH_RANGE.min : STAGE_HEIGHT_RANGE.min}
        max={label === "宽" ? STAGE_WIDTH_RANGE.max : STAGE_HEIGHT_RANGE.max}
        step={1}
        onChange={(event) => onChange(event.target.value)}
        style={numberInputStyle}
      />
    </label>
  );
}

const pageStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  overflowY: "auto",
  background: "var(--bg-app)",
  padding: "32px 48px",
};

const sectionStyle: CSSProperties = {
  maxWidth: 720,
  display: "flex",
  flexDirection: "column",
  gap: 20,
};

const headerRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
};

const sectionTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 16,
  fontWeight: 650,
  color: "var(--text-bright)",
};

const statusStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--text-muted)",
};

const fieldGroupStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const fieldLabelStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "var(--text-primary)",
};

const presetRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
};

const presetButtonStyle: CSSProperties = {
  height: 32,
  padding: "0 12px",
  borderRadius: 6,
  border: "1px solid",
  background: "var(--bg-panel)",
  fontSize: 12,
};

const numberRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "end",
  flexWrap: "wrap",
  gap: 10,
};

const numberFieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const numberLabelStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--text-muted)",
};

const numberInputStyle: CSSProperties = {
  width: 120,
  height: 32,
  borderRadius: 6,
  border: "1px solid var(--border-input)",
  background: "var(--bg-inset)",
  color: "var(--text-primary)",
  padding: "0 10px",
};

const saveButtonStyle: CSSProperties = {
  height: 32,
  padding: "0 16px",
  borderRadius: 6,
  border: "1px solid var(--accent)",
  background: "var(--accent)",
  color: "#fff",
  fontSize: 13,
};
