import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { saveFile } from "../../lib/tauri";
import type { FileRevision, ProjectData } from "../../lib/types";
import {
  clearProjectDraft,
  getSessionDraftStorage,
  loadProjectDraft,
  projectDraftStorageKey,
  saveProjectDraft,
  type DraftStorage,
} from "../../lib/draftRecovery";
import { isDraftSnapshotCurrent, preventUnloadWhenDirty } from "../script/unsavedChanges";
import { useSaveShortcut } from "../common/useSaveShortcut";
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
) => Promise<void | FileRevision | null>;

const STAGE_PRESETS: StageResolution[] = [
  DEFAULT_STAGE_RESOLUTION,
  { width: 1920, height: 1080 },
  { width: 960, height: 540 },
  { width: 1024, height: 768 },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

const DEFAULT_PROJECT_META_SETTINGS: ProjectMetaSettings = {
  title: "",
  typingSpeedCps: 30,
  autoAdvanceMs: 1200,
  chapterGapMs: 1500,
  stage: DEFAULT_STAGE_RESOLUTION,
};

export interface ProjectMetaSettings {
  title: string;
  typingSpeedCps: number;
  autoAdvanceMs: number;
  chapterGapMs: number;
  stage: StageResolution;
}

export interface ProjectSettingsFormDraft {
  titleText: string;
  typingSpeedText: string;
  autoAdvanceText: string;
  chapterGapText: string;
  widthText: string;
  heightText: string;
}

export async function saveProjectStageResolution({
  project,
  stage,
  expectedRevision = project.metaRevision,
  saveFileFn = saveFile,
}: {
  project: ProjectData;
  stage: StageResolution;
  expectedRevision?: FileRevision | null;
  saveFileFn?: SaveFileFn;
}): Promise<void | FileRevision | null> {
  const nextMeta = withStageResolution(project.content.meta, stage);
  return saveFileFn(
    project.path,
    "content/meta.json",
    JSON.stringify(nextMeta, null, 2),
    expectedRevision,
  );
}

export async function saveProjectSettings({
  project,
  settings,
  expectedRevision = project.metaRevision,
  saveFileFn = saveFile,
}: {
  project: ProjectData;
  settings: ProjectMetaSettings;
  expectedRevision?: FileRevision | null;
  saveFileFn?: SaveFileFn;
}): Promise<void | FileRevision | null> {
  const nextMeta = withProjectMetaSettings(project.content.meta, settings);
  return saveFileFn(
    project.path,
    "content/meta.json",
    JSON.stringify(nextMeta, null, 2),
    expectedRevision,
  );
}

export function readProjectMetaSettings(meta: unknown): ProjectMetaSettings {
  const record = isRecord(meta) ? meta : {};
  return {
    title: typeof record.title === "string" ? record.title : DEFAULT_PROJECT_META_SETTINGS.title,
    typingSpeedCps: typeof record.typingSpeedCps === "number" && record.typingSpeedCps > 0
      ? record.typingSpeedCps
      : DEFAULT_PROJECT_META_SETTINGS.typingSpeedCps,
    autoAdvanceMs: validInteger(record.autoAdvanceMs, 0, Number.MAX_SAFE_INTEGER)
      ? record.autoAdvanceMs
      : DEFAULT_PROJECT_META_SETTINGS.autoAdvanceMs,
    chapterGapMs: validInteger(record.chapterGapMs, 0, Number.MAX_SAFE_INTEGER)
      ? record.chapterGapMs
      : DEFAULT_PROJECT_META_SETTINGS.chapterGapMs,
    stage: readStageResolution(meta),
  };
}

export function withProjectMetaSettings(meta: unknown, settings: ProjectMetaSettings): Record<string, unknown> {
  const base = isRecord(meta) ? { ...meta } : {};
  return {
    ...base,
    title: settings.title,
    typingSpeedCps: settings.typingSpeedCps,
    autoAdvanceMs: settings.autoAdvanceMs,
    chapterGapMs: settings.chapterGapMs,
    stage: {
      width: settings.stage.width,
      height: settings.stage.height,
    },
  };
}

export interface StoredStageSettingsDraft {
  version: 1;
  widthText: string;
  heightText: string;
  baseStage?: StageResolution;
  baseRevision?: FileRevision | null;
}

export function loadStageSettingsDraft(storage: DraftStorage | null, key: string): StoredStageSettingsDraft | null {
  const value = loadProjectDraft(storage, key);
  if (!value || typeof value !== "object") return null;
  const draft = value as Partial<StoredStageSettingsDraft>;
  if (draft.version !== 1 || typeof draft.widthText !== "string" || typeof draft.heightText !== "string") return null;
  return draft as StoredStageSettingsDraft;
}

export function isStageDraftDirty(base: StageResolution, widthText: string, heightText: string): boolean {
  return widthText !== String(base.width) || heightText !== String(base.height);
}

export interface StoredProjectSettingsDraft extends ProjectSettingsFormDraft {
  version: 2;
  baseSettings?: ProjectMetaSettings;
  baseRevision?: FileRevision | null;
}

export function loadProjectSettingsDraft(storage: DraftStorage | null, key: string): StoredProjectSettingsDraft | null {
  const value = loadProjectDraft(storage, key);
  if (!value || typeof value !== "object") return null;
  const draft = value as Partial<StoredProjectSettingsDraft>;
  if (
    draft.version !== 2 ||
    typeof draft.titleText !== "string" ||
    typeof draft.typingSpeedText !== "string" ||
    typeof draft.autoAdvanceText !== "string" ||
    typeof draft.chapterGapText !== "string" ||
    typeof draft.widthText !== "string" ||
    typeof draft.heightText !== "string"
  ) {
    return null;
  }
  return draft as StoredProjectSettingsDraft;
}

export function isProjectSettingsDraftDirty(base: ProjectMetaSettings, draft: ProjectSettingsFormDraft): boolean {
  return (
    draft.titleText !== base.title ||
    draft.typingSpeedText !== String(base.typingSpeedCps) ||
    draft.autoAdvanceText !== String(base.autoAdvanceMs) ||
    draft.chapterGapText !== String(base.chapterGapMs) ||
    draft.widthText !== String(base.stage.width) ||
    draft.heightText !== String(base.stage.height)
  );
}

export function projectSettingsDraftStorageKey(projectPath: string): string {
  return projectDraftStorageKey(projectPath, "content/meta.json:settings");
}

export function ProjectSettings({
  project,
  onSaved,
  onDirtyChange,
}: {
  project: ProjectData;
  onSaved: () => void | Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const initialSettings = useMemo(() => readProjectMetaSettings(project.content.meta), [project.content.meta]);
  const draftStorage = useMemo(getSessionDraftStorage, []);
  const draftStorageKey = useMemo(
    () => projectSettingsDraftStorageKey(project.path),
    [project.path],
  );
  const restoredDraft = useMemo(
    () => loadProjectSettingsDraft(draftStorage, draftStorageKey),
    [draftStorage, draftStorageKey],
  );
  const [titleText, setTitleText] = useState(restoredDraft?.titleText ?? initialSettings.title);
  const [typingSpeedText, setTypingSpeedText] = useState(restoredDraft?.typingSpeedText ?? String(initialSettings.typingSpeedCps));
  const [autoAdvanceText, setAutoAdvanceText] = useState(restoredDraft?.autoAdvanceText ?? String(initialSettings.autoAdvanceMs));
  const [chapterGapText, setChapterGapText] = useState(restoredDraft?.chapterGapText ?? String(initialSettings.chapterGapMs));
  const [widthText, setWidthText] = useState(restoredDraft?.widthText ?? String(initialSettings.stage.width));
  const [heightText, setHeightText] = useState(restoredDraft?.heightText ?? String(initialSettings.stage.height));
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draftBaseVersion, setDraftBaseVersion] = useState(0);
  const baseSettingsRef = useRef(restoredDraft?.baseSettings ?? initialSettings);
  const loadedRevisionRef = useRef<FileRevision | null | undefined>(
    restoredDraft?.baseRevision ?? project.metaRevision,
  );
  const draftVersionRef = useRef(0);
  const formDraft: ProjectSettingsFormDraft = {
    titleText,
    typingSpeedText,
    autoAdvanceText,
    chapterGapText,
    widthText,
    heightText,
  };
  const dirty = isProjectSettingsDraftDirty(baseSettingsRef.current, formDraft);

  useEffect(() => {
    if (dirty) return;
    if (loadedRevisionRef.current !== undefined && loadedRevisionRef.current !== project.metaRevision) return;
    baseSettingsRef.current = initialSettings;
    loadedRevisionRef.current = project.metaRevision;
    setTitleText(initialSettings.title);
    setTypingSpeedText(String(initialSettings.typingSpeedCps));
    setAutoAdvanceText(String(initialSettings.autoAdvanceMs));
    setChapterGapText(String(initialSettings.chapterGapMs));
    setWidthText(String(initialSettings.stage.width));
    setHeightText(String(initialSettings.stage.height));
    setStatus(null);
  }, [dirty, initialSettings, project.metaRevision]);

  useEffect(() => {
    if (dirty) {
      saveProjectDraft(draftStorage, draftStorageKey, {
        version: 2,
        titleText,
        typingSpeedText,
        autoAdvanceText,
        chapterGapText,
        widthText,
        heightText,
        baseSettings: baseSettingsRef.current,
        baseRevision: loadedRevisionRef.current,
      } satisfies StoredProjectSettingsDraft);
    } else {
      clearProjectDraft(draftStorage, draftStorageKey);
    }
    onDirtyChange?.(dirty);
  }, [autoAdvanceText, chapterGapText, dirty, draftBaseVersion, draftStorage, draftStorageKey, heightText, onDirtyChange, titleText, typingSpeedText, widthText]);

  useEffect(() => () => {
    onDirtyChange?.(false);
  }, [onDirtyChange]);

  useEffect(() => {
    if (!dirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      preventUnloadWhenDirty(event, true);
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  const draft = parseProjectSettingsDraft(formDraft);
  const activePreset = draft
    ? STAGE_PRESETS.find((preset) => preset.width === draft.stage.width && preset.height === draft.stage.height)
    : null;

  const handlePreset = (stage: StageResolution) => {
    draftVersionRef.current += 1;
    setWidthText(String(stage.width));
    setHeightText(String(stage.height));
    setStatus(null);
  };

  const handleSave = async () => {
    if (!draft || saving) return;
    const savedDraftVersion = draftVersionRef.current;
    setSaving(true);
    setStatus(null);
    try {
      const nextRevision = await saveProjectSettings({
        project,
        settings: draft,
        expectedRevision: loadedRevisionRef.current,
      });
      loadedRevisionRef.current = nextRevision ?? undefined;
      baseSettingsRef.current = draft;
      setDraftBaseVersion((version) => version + 1);
      await onSaved();
      setStatus(isDraftSnapshotCurrent(savedDraftVersion, draftVersionRef.current)
        ? "已保存"
        : "已保存；保存期间的新改动仍未保存。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  useSaveShortcut(dirty && !saving, () => void handleSave());

  const handleWidthChange = (value: string) => {
    draftVersionRef.current += 1;
    setWidthText(value);
    setStatus(null);
  };

  const handleHeightChange = (value: string) => {
    draftVersionRef.current += 1;
    setHeightText(value);
    setStatus(null);
  };

  const setDraftText = (setter: (value: string) => void, value: string) => {
    draftVersionRef.current += 1;
    setter(value);
    setStatus(null);
  };

  return (
    <div style={pageStyle}>
      <section style={sectionStyle}>
        <div style={headerRowStyle}>
          <h2 style={sectionTitleStyle}>项目</h2>
          {status && <span style={statusStyle}>{status}</span>}
        </div>

        <div style={fieldGroupStyle}>
          <span style={fieldLabelStyle}>基础信息</span>
          <TextField label="项目标题" value={titleText} onChange={(value) => setDraftText(setTitleText, value)} />
          <div style={numberRowStyle}>
            <NumberField
              label="默认打字速度"
              value={typingSpeedText}
              min={0.1}
              step={0.1}
              onChange={(value) => setDraftText(setTypingSpeedText, value)}
            />
            <NumberField
              label="默认自动播放间隔"
              value={autoAdvanceText}
              min={0}
              step={1}
              onChange={(value) => setDraftText(setAutoAdvanceText, value)}
            />
            <NumberField
              label="章节间隔"
              value={chapterGapText}
              min={0}
              step={1}
              onChange={(value) => setDraftText(setChapterGapText, value)}
            />
          </div>
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
            <NumberField
              label="宽"
              value={widthText}
              min={STAGE_WIDTH_RANGE.min}
              max={STAGE_WIDTH_RANGE.max}
              step={1}
              onChange={handleWidthChange}
            />
            <NumberField
              label="高"
              value={heightText}
              min={STAGE_HEIGHT_RANGE.min}
              max={STAGE_HEIGHT_RANGE.max}
              step={1}
              onChange={handleHeightChange}
            />
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

function parseProjectSettingsDraft(draft: ProjectSettingsFormDraft): ProjectMetaSettings | null {
  const stage = parseStageDraft(draft.widthText, draft.heightText);
  const typingSpeedCps = Number(draft.typingSpeedText);
  const autoAdvanceMs = Number(draft.autoAdvanceText);
  const chapterGapMs = Number(draft.chapterGapText);
  if (!stage) return null;
  if (!Number.isFinite(typingSpeedCps) || typingSpeedCps <= 0) return null;
  if (!Number.isInteger(autoAdvanceMs) || autoAdvanceMs < 0) return null;
  if (!Number.isInteger(chapterGapMs) || chapterGapMs < 0) return null;
  return {
    title: draft.titleText,
    typingSpeedCps,
    autoAdvanceMs,
    chapterGapMs,
    stage,
  };
}

function TextField({
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
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={textInputStyle}
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: string;
  min: number;
  max?: number;
  step: number;
  onChange: (value: string) => void;
}) {
  return (
    <label style={numberFieldStyle}>
      <span style={numberLabelStyle}>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
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
  padding: "var(--space-8) var(--space-12)",
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
  gap: "var(--space-3)",
};

const sectionTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: "var(--text-lg)",
  fontWeight: 650,
  color: "var(--text-bright)",
};

const statusStyle: CSSProperties = {
  fontSize: "var(--text-sm)",
  color: "var(--text-muted)",
};

const fieldGroupStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-3)",
};

const fieldLabelStyle: CSSProperties = {
  fontSize: "var(--text-base)",
  fontWeight: 600,
  color: "var(--text-primary)",
};

const presetRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--space-2)",
};

const presetButtonStyle: CSSProperties = {
  height: "var(--control-lg)",
  padding: "0 var(--space-3)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid",
  background: "var(--bg-panel)",
  fontSize: "var(--text-sm)",
};

const numberRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "end",
  flexWrap: "wrap",
  gap: "var(--space-2)",
};

const numberFieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-1)",
};

const numberLabelStyle: CSSProperties = {
  fontSize: "var(--text-sm)",
  color: "var(--text-muted)",
};

const numberInputStyle: CSSProperties = {
  width: 120,
  height: "var(--control-lg)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-input)",
  background: "var(--bg-inset)",
  color: "var(--text-primary)",
  padding: "0 var(--space-2)",
};

const textInputStyle: CSSProperties = {
  ...numberInputStyle,
  width: 320,
  maxWidth: "100%",
};

const saveButtonStyle: CSSProperties = {
  height: "var(--control-lg)",
  padding: "0 var(--space-4)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--accent)",
  background: "var(--accent)",
  color: "var(--text-on-accent)",
  fontSize: "var(--text-base)",
};
