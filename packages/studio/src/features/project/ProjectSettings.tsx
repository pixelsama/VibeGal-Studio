import { DistributionConfigSchema, type DistributionConfig } from "@vibegal/engine";
import { AlertTriangle, Info } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
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
import { isExternalRevisionChange } from "../script/nodeEditorModel";
import { useDebouncedCallback } from "../common/useDebouncedCallback";
import { useSaveShortcut } from "../common/useSaveShortcut";
import { usePageUndoHistory } from "../common/usePageUndoHistory";
import { useStudioI18n } from "../../lib/i18n";
import {
  DEFAULT_STAGE_RESOLUTION,
  STAGE_HEIGHT_RANGE,
  STAGE_WIDTH_RANGE,
  readStageResolution,
  withStageResolution,
  type StageResolution,
} from "../../lib/projectMeta";

/** 项目设置自动保存防抖：连续击键合并为一次落盘（Spec 33 §6.1）。 */
const SETTINGS_SAVE_DEBOUNCE_MS = 800;

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
  const { t } = useStudioI18n();
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

  // 自动保存：任何字段变更后防抖落盘（Spec 33 §6.1）。无需手动保存按钮。
  const autoSave = useDebouncedCallback(() => {
    void handleSave();
  }, SETTINGS_SAVE_DEBOUNCE_MS);

  // cmd+z 恢复整页快照（页面级撤销，接管 input 原生撤销）。
  const applyFormDraft = (snapshot: ProjectSettingsFormDraft) => {
    draftVersionRef.current += 1;
    setTitleText(snapshot.titleText);
    setTypingSpeedText(snapshot.typingSpeedText);
    setAutoAdvanceText(snapshot.autoAdvanceText);
    setChapterGapText(snapshot.chapterGapText);
    setWidthText(snapshot.widthText);
    setHeightText(snapshot.heightText);
    setDistributionVersionText(snapshot.distributionVersionText);
    setDistributionProductNameText(snapshot.distributionProductNameText);
    setDistributionIconText(snapshot.distributionIconText);
    setDistributionViewportMode(snapshot.distributionViewportMode);
    setDistributionViewportWidthText(snapshot.distributionViewportWidthText);
    setDistributionViewportHeightText(snapshot.distributionViewportHeightText);
    setStatus(null);
    autoSave.schedule();
  };
  const undoHistory = usePageUndoHistory<ProjectSettingsFormDraft>({
    current: () => formDraft,
    apply: applyFormDraft,
  });

  useEffect(() => {
    if (dirty) return;
    // 已加载/刚保存的 revision 与刷新结果同值 = 无外部改动（含自己的
    // 保存+刷新往返），保持表单现状。必须按值比较：openProject 每次返回
    // 新对象实例，引用比较会让下方的外部改动覆盖分支永不触发。
    if (!isExternalRevisionChange(loadedRevisionRef.current, project.metaRevision)) return;
    // 外部改动覆盖前：取消待落盘草稿并清空撤销栈，防抖不得把旧草稿写盘覆盖外部改动。
    autoSave.cancel();
    undoHistory.reset();
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
  }, [dirty, initialSettings, project.metaRevision, undoHistory.reset]);

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
    undoHistory.record(formDraft);
    draftVersionRef.current += 1;
    setWidthText(String(stage.width));
    setHeightText(String(stage.height));
    setStatus(t("projectSettings.pendingSave"));
    autoSave.schedule();
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
        ? t("projectSettings.saved")
        : t("projectSettings.savedWithChanges"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  // Cmd+S = 立即落盘（跳过防抖窗口）。
  useSaveShortcut(dirty && !saving, () => {
    autoSave.flush();
  });

  const handleWidthChange = (value: string) => {
    undoHistory.record(formDraft);
    draftVersionRef.current += 1;
    setWidthText(value);
    setStatus(t("projectSettings.pendingSave"));
    autoSave.schedule();
  };

  const handleHeightChange = (value: string) => {
    undoHistory.record(formDraft);
    draftVersionRef.current += 1;
    setHeightText(value);
    setStatus(t("projectSettings.pendingSave"));
    autoSave.schedule();
  };

  const setDraftText = (setter: (value: string) => void, value: string) => {
    undoHistory.record(formDraft);
    draftVersionRef.current += 1;
    setter(value);
    setStatus(t("projectSettings.pendingSave"));
    autoSave.schedule();
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
      setSupportFileStatus(repaired.length > 0
        ? t("projectSettings.support.repaired", { count: repaired.length })
        : t("projectSettings.support.complete"));
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
          <h2 className="gs-page-title" style={sectionTitleStyle}>{t("projectSettings.title")}</h2>
          <span style={statusStyle}>{status ?? t("projectSettings.autoSaveHint")}</span>
        </div>

        {project.galstudioIgnored === false && (
          <div role="status" style={noticeInfoStyle}>
            <Info size={15} style={noticeInfoIconStyle} aria-hidden />
            <div style={noticeBodyStyle}>
              <strong style={noticeTitleStyle}>{t("projectSettings.gitignore.title")}</strong>
              <span style={noticeTextStyle}>
                {t("projectSettings.gitignore.description")} <code>.galstudio/</code>
              </span>
            </div>
          </div>
        )}

        {missingSupportFiles.length > 0 && (
          <div role="status" style={noticeWarnStyle}>
            <AlertTriangle size={15} style={noticeWarnIconStyle} aria-hidden />
            <div style={noticeBodyStyle}>
              <strong style={noticeTitleStyle}>{t("projectSettings.support.title")}</strong>
              <span style={noticeTextStyle}>{t("projectSettings.support.description")}</span>
              <ul style={supportFilesListStyle}>
                {missingSupportFiles.map((path) => <li key={path}>{path}</li>)}
              </ul>
              {supportFileStatus && <span style={noticeStatusStyle}>{supportFileStatus}</span>}
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
              {repairingSupportFiles ? t("projectSettings.support.repairing") : t("projectSettings.support.repair")}
            </button>
          </div>
        )}

        <SettingsSection title={t("projectSettings.basic")}>
          <SettingsRow
            wrapsControl
            label={t("projectSettings.workTitle")}
            hint={t("projectSettings.workTitleHint")}
          >
            <input
              type="text"
              value={titleText}
              onChange={(event) => setDraftText(setTitleText, event.target.value)}
              style={rowTextInputStyle}
            />
          </SettingsRow>
          <SettingsRow
            wrapsControl
            label={t("projectSettings.typingSpeed")}
            hint={t("projectSettings.typingSpeedHint")}
          >
            <input
              type="number"
              value={typingSpeedText}
              min={0.1}
              step={0.1}
              onChange={(event) => setDraftText(setTypingSpeedText, event.target.value)}
              style={rowNumberInputStyle}
            />
          </SettingsRow>
          <SettingsRow
            wrapsControl
            label={t("projectSettings.autoAdvance")}
            hint={t("projectSettings.autoAdvanceHint")}
          >
            <input
              type="number"
              value={autoAdvanceText}
              min={0}
              step={1}
              onChange={(event) => setDraftText(setAutoAdvanceText, event.target.value)}
              style={rowNumberInputStyle}
            />
          </SettingsRow>
          <SettingsRow
            wrapsControl
            label={t("projectSettings.chapterGap")}
            hint={t("projectSettings.chapterGapHint")}
          >
            <input
              type="number"
              value={chapterGapText}
              min={0}
              step={1}
              onChange={(event) => setDraftText(setChapterGapText, event.target.value)}
              style={rowNumberInputStyle}
            />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title={t("projectSettings.stage")}>
          <SettingsRow
            label={t("projectSettings.stagePresets")}
            hint={t("projectSettings.stagePresetsHint")}
          >
            <div style={segmentedStyle} role="group" aria-label={t("projectSettings.stagePresets")}>
              {STAGE_PRESETS.map((preset, index) => {
                const active = activePreset === preset;
                return (
                  <button
                    key={`${preset.width}x${preset.height}`}
                    type="button"
                    onClick={() => handlePreset(preset)}
                    aria-pressed={active}
                    style={{
                      ...segmentStyle,
                      borderLeft: index > 0 ? "1px solid var(--border)" : 0,
                      background: active ? "var(--accent-secondary-soft)" : "transparent",
                      color: active ? "var(--accent-secondary-bright)" : "var(--text-secondary)",
                      fontWeight: active ? 600 : 400,
                    }}
                  >
                    {preset.width} × {preset.height}
                  </button>
                );
              })}
              {!activePreset && (
                <span style={{ ...segmentStyle, ...customSegmentStyle }}>
                  {t("projectSettings.customPreset")}
                </span>
              )}
            </div>
          </SettingsRow>
          <SettingsRow
            label={t("projectSettings.customSize")}
            hint={t("projectSettings.customSizeHint", {
              wMin: STAGE_WIDTH_RANGE.min,
              wMax: STAGE_WIDTH_RANGE.max,
              hMin: STAGE_HEIGHT_RANGE.min,
              hMax: STAGE_HEIGHT_RANGE.max,
            })}
          >
            <div style={sizeControlStyle}>
              <input
                type="number"
                aria-label={t("projectSettings.width")}
                value={widthText}
                min={STAGE_WIDTH_RANGE.min}
                max={STAGE_WIDTH_RANGE.max}
                step={1}
                onChange={(event) => handleWidthChange(event.target.value)}
                style={rowNumberInputStyle}
              />
              <span style={sizeTimesStyle}>×</span>
              <input
                type="number"
                aria-label={t("projectSettings.height")}
                value={heightText}
                min={STAGE_HEIGHT_RANGE.min}
                max={STAGE_HEIGHT_RANGE.max}
                step={1}
                onChange={(event) => handleHeightChange(event.target.value)}
                style={rowNumberInputStyle}
              />
            </div>
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title={t("projectSettings.distribution")}>
          <SettingsRow
            wrapsControl
            label={t("projectSettings.version")}
            hint={t("projectSettings.versionHint")}
          >
            <input
              type="text"
              value={distributionVersionText}
              onChange={(event) => setDraftText(setDistributionVersionText, event.target.value)}
              style={rowTextInputStyle}
            />
          </SettingsRow>
          <SettingsRow
            wrapsControl
            label={t("projectSettings.packageName")}
            hint={t("projectSettings.packageNameHint")}
          >
            <input
              type="text"
              value={distributionProductNameText}
              onChange={(event) => setDraftText(setDistributionProductNameText, event.target.value)}
              style={rowTextInputStyle}
            />
          </SettingsRow>
          <SettingsRow
            wrapsControl
            label={t("projectSettings.iconPath")}
            hint={t("projectSettings.iconPathHint")}
          >
            <input
              type="text"
              value={distributionIconText}
              onChange={(event) => setDraftText(setDistributionIconText, event.target.value)}
              style={rowTextInputStyle}
            />
          </SettingsRow>
          <SettingsRow
            wrapsControl
            label={t("projectSettings.viewport")}
            hint={t("projectSettings.viewportHint")}
          >
            <select
              value={distributionViewportMode}
              onChange={(event) => setDraftText(
                (value) => setDistributionViewportMode(value as "fit" | "fill" | "responsive"),
                event.target.value,
              )}
              style={rowSelectStyle}
            >
              <option value="fit">{t("projectSettings.viewport.fit")}</option>
              <option value="fill">{t("projectSettings.viewport.fill")}</option>
              <option value="responsive">{t("projectSettings.viewport.responsive")}</option>
            </select>
          </SettingsRow>
          <SettingsRow
            label={t("projectSettings.designSize")}
            hint={t("projectSettings.designSizeHint")}
          >
            <div style={sizeControlStyle}>
              <input
                type="number"
                aria-label={t("projectSettings.designWidth")}
                value={distributionViewportWidthText}
                min={STAGE_WIDTH_RANGE.min}
                max={STAGE_WIDTH_RANGE.max}
                step={1}
                onChange={(event) => setDraftText(setDistributionViewportWidthText, event.target.value)}
                style={rowNumberInputStyle}
              />
              <span style={sizeTimesStyle}>×</span>
              <input
                type="number"
                aria-label={t("projectSettings.designHeight")}
                value={distributionViewportHeightText}
                min={STAGE_HEIGHT_RANGE.min}
                max={STAGE_HEIGHT_RANGE.max}
                step={1}
                onChange={(event) => setDraftText(setDistributionViewportHeightText, event.target.value)}
                style={rowNumberInputStyle}
              />
            </div>
          </SettingsRow>
        </SettingsSection>
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

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section data-settings-section style={settingsSectionStyle}>
      <h3 style={settingsSectionTitleStyle}>{title}</h3>
      <div style={settingsRowsStyle}>{children}</div>
    </section>
  );
}

/**
 * 行式设置项：左侧标签 + 描述，右侧控件。
 * `wrapsControl` 时整行渲染为 <label>（仅用于单控件行），既保留点击聚焦，
 * 也维持 E2E 通过「label 文案找输入框」的定位方式（qa/agent XPath）。
 */
function SettingsRow({
  label,
  hint,
  wrapsControl = false,
  children,
}: {
  label: string;
  hint?: string;
  wrapsControl?: boolean;
  children: ReactNode;
}) {
  const content = (
    <>
      <div style={rowTextStyle}>
        <span style={rowLabelStyle}>{label}</span>
        {hint && <span style={rowHintStyle}>{hint}</span>}
      </div>
      <div style={rowControlStyle}>{children}</div>
    </>
  );
  if (wrapsControl) {
    return <label data-settings-row style={rowStyle}>{content}</label>;
  }
  return <div data-settings-row style={rowStyle}>{content}</div>;
}

const pageStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-6)",
};

const sectionStyle: CSSProperties = {
  width: "min(720px, 100%)",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-5)",
};

const headerRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: "var(--space-3)",
};

const sectionTitleStyle: CSSProperties = {};

const statusStyle: CSSProperties = {
  flexShrink: 0,
  fontSize: "var(--text-sm)",
  color: "var(--text-muted)",
};

const noticeBaseStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: "var(--space-3)",
  padding: "var(--space-3) var(--space-4)",
  borderRadius: "var(--radius-md)",
};

const noticeInfoStyle: CSSProperties = {
  ...noticeBaseStyle,
  border: "1px solid var(--border)",
  background: "var(--bg-panel)",
};

const noticeWarnStyle: CSSProperties = {
  ...noticeBaseStyle,
  border: "1px solid var(--border-warn)",
  background: "var(--bg-tag-warn)",
};

const noticeIconBaseStyle: CSSProperties = {
  flexShrink: 0,
  marginTop: 2,
};

const noticeInfoIconStyle: CSSProperties = {
  ...noticeIconBaseStyle,
  color: "var(--text-muted)",
};

const noticeWarnIconStyle: CSSProperties = {
  ...noticeIconBaseStyle,
  color: "var(--status-warn-text)",
};

const noticeBodyStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-1)",
};

const noticeTitleStyle: CSSProperties = {
  color: "var(--text-bright)",
  fontSize: "var(--text-sm)",
  fontWeight: 600,
};

const noticeTextStyle: CSSProperties = {
  color: "var(--text-secondary)",
  fontSize: "var(--text-xs)",
  lineHeight: 1.5,
};

const noticeStatusStyle: CSSProperties = {
  fontSize: "var(--text-xs)",
  color: "var(--text-muted)",
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
  height: "var(--control-sm)",
  padding: "0 var(--space-3)",
  border: "1px solid var(--accent)",
  borderRadius: "var(--radius-sm)",
  color: "var(--accent-bright)",
  background: "transparent",
  fontSize: "var(--text-sm)",
  fontWeight: 500,
};

const settingsSectionStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-1)",
};

const settingsSectionTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: "var(--text-sm)",
  fontWeight: 600,
  color: "var(--text-secondary)",
};

const settingsRowsStyle: CSSProperties = {
  borderTop: "1px solid var(--border)",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  flexWrap: "wrap",
  gap: "var(--space-2) var(--space-6)",
  padding: "var(--space-3) 0",
  borderBottom: "1px solid var(--border-subtle)",
};

const rowTextStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  minWidth: 0,
};

const rowLabelStyle: CSSProperties = {
  fontSize: "var(--text-base)",
  fontWeight: 500,
  color: "var(--text-primary)",
};

const rowHintStyle: CSSProperties = {
  maxWidth: 420,
  fontSize: "var(--text-xs)",
  color: "var(--text-muted)",
  lineHeight: 1.5,
};

const rowControlStyle: CSSProperties = {
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
};

const rowInputBaseStyle: CSSProperties = {
  height: "var(--control-lg)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-input)",
  background: "var(--bg-panel)",
  color: "var(--text-primary)",
  padding: "0 var(--space-2)",
  fontSize: "var(--text-md)",
};

const rowTextInputStyle: CSSProperties = {
  ...rowInputBaseStyle,
  width: 240,
  maxWidth: "100%",
};

const rowSelectStyle: CSSProperties = {
  ...rowInputBaseStyle,
  width: 240,
};

const rowNumberInputStyle: CSSProperties = {
  ...rowInputBaseStyle,
  width: 88,
  textAlign: "right",
};

const segmentedStyle: CSSProperties = {
  display: "inline-flex",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-sm)",
  overflow: "hidden",
  background: "var(--bg-panel)",
};

const segmentStyle: CSSProperties = {
  height: "var(--control-lg)",
  display: "inline-flex",
  alignItems: "center",
  padding: "0 var(--space-3)",
  border: 0,
  background: "transparent",
  fontSize: "var(--text-sm)",
  whiteSpace: "nowrap",
  cursor: "pointer",
};

const customSegmentStyle: CSSProperties = {
  borderLeft: "1px solid var(--border)",
  background: "var(--accent-secondary-soft)",
  color: "var(--accent-secondary-bright)",
  fontWeight: 600,
  cursor: "default",
};

const sizeControlStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
};

const sizeTimesStyle: CSSProperties = {
  color: "var(--text-muted)",
  fontSize: "var(--text-sm)",
};

