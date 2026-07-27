import { DistributionConfigSchema, type DistributionConfig } from "@vibegal/engine";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  repairProjectSupportFiles as repairProjectSupportFilesInBackend,
  saveFile,
} from "../../lib/tauri";
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

type RepairProjectSupportFilesFn = (projectPath: string) => Promise<string[]>;

export function repairProjectSupportFiles(
  projectPath: string,
  repair: RepairProjectSupportFilesFn = repairProjectSupportFilesInBackend,
): Promise<string[]> {
  return repair(projectPath);
}

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
  distribution: { version: "0.1.0" },
};

export interface ProjectMetaSettings {
  title: string;
  typingSpeedCps: number;
  autoAdvanceMs: number;
  chapterGapMs: number;
  stage: StageResolution;
  distribution: DistributionConfig;
}

export interface ProjectSettingsFormDraft {
  titleText: string;
  typingSpeedText: string;
  autoAdvanceText: string;
  chapterGapText: string;
  widthText: string;
  heightText: string;
  distributionVersionText: string;
  distributionProductNameText: string;
  distributionIconText: string;
  distributionViewportMode: "fit" | "fill" | "responsive";
  distributionViewportWidthText: string;
  distributionViewportHeightText: string;
  distributionUpdates?: DistributionConfig["updates"];
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
  const distribution = DistributionConfigSchema.safeParse(record.distribution);
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
    distribution: distribution.success
      ? distribution.data
      : DEFAULT_PROJECT_META_SETTINGS.distribution,
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
    distribution: settings.distribution,
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
  version: 3;
  baseSettings?: ProjectMetaSettings;
  baseRevision?: FileRevision | null;
}

export function loadProjectSettingsDraft(storage: DraftStorage | null, key: string): StoredProjectSettingsDraft | null {
  const value = loadProjectDraft(storage, key);
  if (!value || typeof value !== "object") return null;
  const draft = value as Partial<StoredProjectSettingsDraft>;
  if (
    draft.version !== 3 ||
    typeof draft.titleText !== "string" ||
    typeof draft.typingSpeedText !== "string" ||
    typeof draft.autoAdvanceText !== "string" ||
    typeof draft.chapterGapText !== "string" ||
    typeof draft.widthText !== "string" ||
    typeof draft.heightText !== "string" ||
    typeof draft.distributionVersionText !== "string" ||
    typeof draft.distributionProductNameText !== "string" ||
    typeof draft.distributionIconText !== "string" ||
    !["fit", "fill", "responsive"].includes(draft.distributionViewportMode ?? "") ||
    typeof draft.distributionViewportWidthText !== "string" ||
    typeof draft.distributionViewportHeightText !== "string"
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
    draft.heightText !== String(base.stage.height) ||
    draft.distributionVersionText !== base.distribution.version ||
    draft.distributionProductNameText !== (base.distribution.productName ?? "") ||
    draft.distributionIconText !== (base.distribution.icon ?? "") ||
    draft.distributionViewportMode !== (base.distribution.viewport?.mode ?? "fit") ||
    draft.distributionViewportWidthText !== String(base.distribution.viewport?.width ?? base.stage.width) ||
    draft.distributionViewportHeightText !== String(base.distribution.viewport?.height ?? base.stage.height)
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
  const [distributionVersionText, setDistributionVersionText] = useState(
    restoredDraft?.distributionVersionText ?? initialSettings.distribution.version,
  );
  const [distributionProductNameText, setDistributionProductNameText] = useState(
    restoredDraft?.distributionProductNameText ?? initialSettings.distribution.productName ?? "",
  );
  const [distributionIconText, setDistributionIconText] = useState(
    restoredDraft?.distributionIconText ?? initialSettings.distribution.icon ?? "",
  );
  const [distributionViewportMode, setDistributionViewportMode] = useState<"fit" | "fill" | "responsive">(
    restoredDraft?.distributionViewportMode ?? initialSettings.distribution.viewport?.mode ?? "fit",
  );
  const [distributionViewportWidthText, setDistributionViewportWidthText] = useState(
    restoredDraft?.distributionViewportWidthText
      ?? String(initialSettings.distribution.viewport?.width ?? initialSettings.stage.width),
  );
  const [distributionViewportHeightText, setDistributionViewportHeightText] = useState(
    restoredDraft?.distributionViewportHeightText
      ?? String(initialSettings.distribution.viewport?.height ?? initialSettings.stage.height),
  );
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [missingSupportFiles, setMissingSupportFiles] = useState(project.missingSupportFiles ?? []);
  const [repairingSupportFiles, setRepairingSupportFiles] = useState(false);
  const [supportFileStatus, setSupportFileStatus] = useState<string | null>(null);
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
    distributionVersionText,
    distributionProductNameText,
    distributionIconText,
    distributionViewportMode,
    distributionViewportWidthText,
    distributionViewportHeightText,
    distributionUpdates: restoredDraft?.distributionUpdates ?? initialSettings.distribution.updates,
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
    setDistributionVersionText(initialSettings.distribution.version);
    setDistributionProductNameText(initialSettings.distribution.productName ?? "");
    setDistributionIconText(initialSettings.distribution.icon ?? "");
    setDistributionViewportMode(initialSettings.distribution.viewport?.mode ?? "fit");
    setDistributionViewportWidthText(String(initialSettings.distribution.viewport?.width ?? initialSettings.stage.width));
    setDistributionViewportHeightText(String(initialSettings.distribution.viewport?.height ?? initialSettings.stage.height));
    setStatus(null);
  }, [dirty, initialSettings, project.metaRevision]);

  useEffect(() => {
    setMissingSupportFiles(project.missingSupportFiles ?? []);
    setSupportFileStatus(null);
  }, [project.missingSupportFiles]);

  useEffect(() => {
    if (dirty) {
      saveProjectDraft(draftStorage, draftStorageKey, {
        version: 3,
        titleText,
        typingSpeedText,
        autoAdvanceText,
        chapterGapText,
        widthText,
        heightText,
        distributionVersionText,
        distributionProductNameText,
        distributionIconText,
        distributionViewportMode,
        distributionViewportWidthText,
        distributionViewportHeightText,
        distributionUpdates: formDraft.distributionUpdates,
        baseSettings: baseSettingsRef.current,
        baseRevision: loadedRevisionRef.current,
      } satisfies StoredProjectSettingsDraft);
    } else {
      clearProjectDraft(draftStorage, draftStorageKey);
    }
    onDirtyChange?.(dirty);
  }, [
    autoAdvanceText,
    chapterGapText,
    dirty,
    distributionIconText,
    distributionProductNameText,
    distributionVersionText,
    distributionViewportHeightText,
    distributionViewportMode,
    distributionViewportWidthText,
    draftBaseVersion,
    draftStorage,
    draftStorageKey,
    heightText,
    onDirtyChange,
    titleText,
    typingSpeedText,
    widthText,
  ]);

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

  const handleRepairSupportFiles = async () => {
    if (repairingSupportFiles || missingSupportFiles.length === 0) return;
    setRepairingSupportFiles(true);
    setSupportFileStatus(null);
    try {
      const repaired = await repairProjectSupportFiles(project.path);
      const repairedSet = new Set(repaired);
      setMissingSupportFiles((current) => current.filter((path) => !repairedSet.has(path)));
      await onSaved();
      setSupportFileStatus(repaired.length > 0 ? `已补齐 ${repaired.length} 个辅助文件` : "辅助文件已是完整状态");
    } catch (error) {
      setSupportFileStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setRepairingSupportFiles(false);
    }
  };

  return (
    <div className="gs-page-shell" style={pageStyle}>
      <section style={sectionStyle}>
        <div style={headerRowStyle}>
          <h2 className="gs-page-title" style={sectionTitleStyle}>项目设置</h2>
          {status && <span style={statusStyle}>{status}</span>}
        </div>

        {missingSupportFiles.length > 0 && (
          <div role="status" style={supportFilesNoticeStyle}>
            <div style={supportFilesHeaderStyle}>
              <div>
                <strong style={supportFilesTitleStyle}>项目辅助文件不完整</strong>
                <p style={supportFilesTextStyle}>
                  打开项目时不会自动写入文件。补齐后可恢复类型提示和项目结构说明，已有文件不会被覆盖。
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleRepairSupportFiles()}
                disabled={repairingSupportFiles}
                style={{
                  ...repairButtonStyle,
                  opacity: repairingSupportFiles ? 0.55 : 1,
                  cursor: repairingSupportFiles ? "default" : "pointer",
                }}
              >
                {repairingSupportFiles ? "补齐中" : "一键补齐"}
              </button>
            </div>
            <ul style={supportFilesListStyle}>
              {missingSupportFiles.map((path) => <li key={path}>{path}</li>)}
            </ul>
            {supportFileStatus && <span style={statusStyle}>{supportFileStatus}</span>}
          </div>
        )}

        <div className="gs-settings-grid">
          <div className="gs-settings-card" style={fieldGroupStyle}>
            <span style={fieldLabelStyle}>基础信息</span>
            <TextField
              label="作品标题"
              hint="玩家在标题画面和导出物里看到的名字。左上角的项目名只是磁盘上的文件夹标识。"
              value={titleText}
              onChange={(value) => setDraftText(setTitleText, value)}
            />
            <div style={numberRowStyle}>
              <NumberField
                label="默认打字速度"
                hint="每秒显示几个字"
                value={typingSpeedText}
                min={0.1}
                step={0.1}
                onChange={(value) => setDraftText(setTypingSpeedText, value)}
              />
              <NumberField
                label="默认自动播放间隔"
                hint="自动播放时每句停留的毫秒数"
                value={autoAdvanceText}
                min={0}
                step={1}
                onChange={(value) => setDraftText(setAutoAdvanceText, value)}
              />
              <NumberField
                label="章节间隔"
                hint="切换章节时的停顿毫秒数"
                value={chapterGapText}
                min={0}
                step={1}
                onChange={(value) => setDraftText(setChapterGapText, value)}
              />
            </div>
          </div>

          <div className="gs-settings-card" style={fieldGroupStyle}>
            <span style={fieldLabelStyle}>舞台分辨率</span>
            <div style={presetRowStyle}>
              {STAGE_PRESETS.map((preset) => {
                const active = activePreset === preset;
                return (
                  <button
                    key={`${preset.width}x${preset.height}`}
                    type="button"
                    className="gs-selected-surface"
                    onClick={() => handlePreset(preset)}
                    aria-pressed={active}
                    style={{
                      ...presetButtonStyle,
                      borderColor: active ? "var(--accent-secondary)" : "var(--border-strong)",
                      color: active ? "var(--accent-secondary-bright)" : "var(--text-secondary)",
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

          <div className="gs-settings-card" style={fieldGroupStyle}>
            <span style={fieldLabelStyle}>导出信息</span>
            <div style={numberRowStyle}>
              <TextField
                label="作品版本"
                hint="独立于 Studio 版本，使用 SemVer，例如 1.0.0。"
                value={distributionVersionText}
                onChange={(value) => setDraftText(setDistributionVersionText, value)}
              />
              <TextField
                label="安装包名称"
                hint="只控制包和窗口显示名；留空时沿用作品标题。"
                value={distributionProductNameText}
                onChange={(value) => setDraftText(setDistributionProductNameText, value)}
              />
              <TextField
                label="图标路径"
                hint="可选，只接受 assets/ 下的项目相对路径；构建不会改写源图。"
                value={distributionIconText}
                onChange={(value) => setDraftText(setDistributionIconText, value)}
              />
            </div>
            <label style={numberFieldStyle}>
              <span style={numberLabelStyle}>窗口适配</span>
              <select
                value={distributionViewportMode}
                onChange={(event) => setDraftText(
                  (value) => setDistributionViewportMode(value as "fit" | "fill" | "responsive"),
                  event.target.value,
                )}
                style={textInputStyle}
              >
                <option value="fit">保持比例并留边</option>
                <option value="fill">保持比例并裁切</option>
                <option value="responsive">由界面风格自适应决定</option>
              </select>
            </label>
            <div style={numberRowStyle}>
              <NumberField
                label="设计宽度"
                value={distributionViewportWidthText}
                min={STAGE_WIDTH_RANGE.min}
                max={STAGE_WIDTH_RANGE.max}
                step={1}
                onChange={(value) => setDraftText(setDistributionViewportWidthText, value)}
              />
              <NumberField
                label="设计高度"
                value={distributionViewportHeightText}
                min={STAGE_HEIGHT_RANGE.min}
                max={STAGE_HEIGHT_RANGE.max}
                step={1}
                onChange={(value) => setDraftText(setDistributionViewportHeightText, value)}
              />
            </div>
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
  const distributionViewport = parseStageDraft(
    draft.distributionViewportWidthText,
    draft.distributionViewportHeightText,
  );
  if (!distributionViewport) return null;
  const distribution = DistributionConfigSchema.safeParse({
    version: draft.distributionVersionText,
    ...(draft.distributionProductNameText.trim()
      ? { productName: draft.distributionProductNameText.trim() }
      : {}),
    ...(draft.distributionIconText.trim()
      ? { icon: draft.distributionIconText.trim() }
      : {}),
    viewport: {
      mode: draft.distributionViewportMode,
      ...distributionViewport,
    },
    ...(draft.distributionUpdates ? { updates: draft.distributionUpdates } : {}),
  });
  if (!distribution.success) return null;
  return {
    title: draft.titleText,
    typingSpeedCps,
    autoAdvanceMs,
    chapterGapMs,
    stage,
    distribution: distribution.data,
  };
}

function TextField({
  label,
  value,
  hint,
  onChange,
}: {
  label: string;
  value: string;
  hint?: string;
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
      {hint && <span style={fieldHintStyle}>{hint}</span>}
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  hint,
  onChange,
}: {
  label: string;
  value: string;
  min: number;
  max?: number;
  step: number;
  hint?: string;
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
      {hint && <span style={fieldHintStyle}>{hint}</span>}
    </label>
  );
}

const pageStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-6)",
};

const sectionStyle: CSSProperties = {
  width: "100%",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-5)",
};

const headerRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-3)",
};

const sectionTitleStyle: CSSProperties = {};

const statusStyle: CSSProperties = {
  fontSize: "var(--text-sm)",
  color: "var(--text-muted)",
};

const supportFilesNoticeStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
  padding: "var(--space-4)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-md)",
  background: "var(--bg-panel)",
};

const supportFilesHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: "var(--space-4)",
};

const supportFilesTitleStyle: CSSProperties = {
  color: "var(--text-bright)",
  fontSize: "var(--text-sm)",
};

const supportFilesTextStyle: CSSProperties = {
  margin: "var(--space-1) 0 0",
  color: "var(--text-secondary)",
  fontSize: "var(--text-xs)",
  lineHeight: 1.5,
};

const supportFilesListStyle: CSSProperties = {
  margin: 0,
  paddingLeft: "var(--space-5)",
  color: "var(--text-muted)",
  fontFamily: "var(--font-mono, monospace)",
  fontSize: "var(--text-xs)",
  overflowWrap: "anywhere",
};

const repairButtonStyle: CSSProperties = {
  flexShrink: 0,
  height: "var(--control-lg)",
  padding: "0 var(--space-3)",
  border: 0,
  borderRadius: "var(--radius-sm)",
  color: "white",
  background: "var(--accent)",
  fontWeight: 600,
};

const fieldGroupStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-3)",
};

const fieldLabelStyle: CSSProperties = {
  fontSize: "var(--text-lg)",
  fontWeight: 700,
  color: "var(--text-bright)",
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
  fontWeight: 650,
  color: "var(--text-primary)",
};

const fieldHintStyle: CSSProperties = {
  maxWidth: 420,
  fontSize: "var(--text-xs)",
  color: "var(--text-muted)",
  lineHeight: 1.5,
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
