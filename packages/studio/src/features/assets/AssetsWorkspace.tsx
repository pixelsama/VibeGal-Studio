/**
 * AssetsWorkspace —— 资产页主容器。
 *
 * 布局：左侧分类边栏 + 右侧（工具栏 + 网格/角色编辑器）+ 右下角状态指示器。
 *
 * 数据流（镜像 ScriptWorkspace）：
 *   - project.content.manifest 作为数据源（类型化为 Manifest）
 *   - useAssets 拉取磁盘清单 + 派生孤儿/悬空视图
 *   - 导入/删除/保存 manifest 后调用 onSaved → refreshProject → openProject 重读
 *   - content/ 已被 watcher 监听，外部改动自动热重载
 *
 * 根容器 position: relative 以锚定右下角的 StatusPanel（absolute）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Inbox } from "lucide-react";
import { ManifestSchema } from "@vibegal/engine";
import { EMPTY_MANIFEST, type ProjectData, type AssetEntry, type AssetKind, type FileRevision, type Manifest } from "../../lib/types";
import {
  deleteAsset,
  importAsset,
  pickAssetFiles,
  saveManifest,
} from "../../lib/tauri";
import { CollapsibleSidebar } from "../common/CollapsibleSidebar";
import { ConfirmDialog } from "../common/Dialogs";
import { EmptyState } from "../common/EmptyState";
import { Toast, type ToastInput, type ToastMessage } from "../common/Toast";
// 注：全局 StatusPanel 现挂载在 Workspace 根容器，资产页不再自带。
import { AssetsSidebar, type AssetSection } from "./AssetsSidebar";
import { AssetsToolbar } from "./AssetsToolbar";
import { AssetGrid } from "./AssetGrid";
import { AssetCard, DanglingCard } from "./AssetCard";
import { analyzeAssetUsage } from "./assetUsage";
import { CharacterEditor } from "./CharacterEditor";
import { useAssets } from "./useAssets";
import { baseName } from "./assetPreview";
import { RevisionedProjectMutationQueue } from "../../lib/projectMutation";
import {
  clearProjectDraft,
  getSessionDraftStorage,
  loadProjectDraft,
  projectDraftStorageKey,
  saveProjectDraft,
  type DraftStorage,
} from "../../lib/draftRecovery";
import { isDraftSnapshotCurrent, isSaveKeyboardShortcut, preventUnloadWhenDirty } from "../script/unsavedChanges";

interface AssetsWorkspaceProps {
  project: ProjectData;
  refreshKey: number;
  sidebarCollapsed: boolean;
  onSidebarCollapsedChange: (collapsed: boolean) => void;
  onSaved: () => void | Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}

type RegistrableAssetKind = Exclude<AssetKind, "character" | "unknown">;
type ExtendedAssetSection = "cg" | "video" | "font" | "ui" | "animation";

function isRegistrableAssetKind(kind: AssetSection): kind is RegistrableAssetKind {
  return kind !== "overview" && kind !== "character" && kind !== "unknown";
}

function isExtendedAssetSection(section: AssetSection): section is ExtendedAssetSection {
  return section === "cg" || section === "video" || section === "font" || section === "ui" || section === "animation";
}

export function AssetsWorkspace({
  project,
  refreshKey,
  sidebarCollapsed,
  onSidebarCollapsedChange,
  onSaved,
  onDirtyChange,
}: AssetsWorkspaceProps) {
  const [section, setSection] = useState<AssetSection>("overview");
  const [search, setSearch] = useState("");
  const draftStorage = useMemo(getSessionDraftStorage, []);
  const draftStorageKey = useMemo(
    () => projectDraftStorageKey(project.path, "content/manifest.json"),
    [project.path],
  );
  const restoredManifestDraft = useMemo(
    () => loadManifestDraft(draftStorage, draftStorageKey),
    [draftStorage, draftStorageKey],
  );
  const [draftManifest, setDraftManifest] = useState<Manifest | null>(restoredManifestDraft?.manifest ?? null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftBaseVersion, setDraftBaseVersion] = useState(0);
  const draftVersionRef = useRef(0);
  const draftBaseRevisionRef = useRef<FileRevision | null | undefined>(
    restoredManifestDraft?.baseRevision ?? project.manifestRevision,
  );
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const manifestMutationQueue = useMemo(
    () => new RevisionedProjectMutationQueue(draftBaseRevisionRef.current),
    [project.path],
  );

  useEffect(() => {
    if (draftManifest) return;
    manifestMutationQueue.synchronizeRevision(project.manifestRevision);
    draftBaseRevisionRef.current = manifestMutationQueue.revision;
  }, [draftManifest, manifestMutationQueue, project.manifestRevision]);

  useEffect(() => {
    if (draftManifest) {
      saveProjectDraft(draftStorage, draftStorageKey, {
        version: 1,
        manifest: draftManifest,
        baseRevision: draftBaseRevisionRef.current,
      } satisfies StoredManifestDraft);
    } else {
      clearProjectDraft(draftStorage, draftStorageKey);
    }
    onDirtyChange?.(draftManifest !== null);
  }, [draftBaseVersion, draftManifest, draftStorage, draftStorageKey, onDirtyChange]);

  useEffect(() => () => {
    onDirtyChange?.(false);
  }, [onDirtyChange]);

  useEffect(() => {
    if (!draftManifest) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      preventUnloadWhenDirty(event, true);
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [draftManifest]);

  const handleStageManifestDraft = (next: Manifest) => {
    draftVersionRef.current += 1;
    stageManifestDraft(next, setDraftManifest);
  };

  const handleDiscardManifestDraft = () => {
    draftVersionRef.current += 1;
    discardDraftManifest(setDraftManifest);
  };

  const handleSaveManifestDraft = async () => {
    if (!draftManifest || savingDraft) return;
    const savedDraftVersion = draftVersionRef.current;
    setSavingDraft(true);
    try {
      await saveDraftManifest({
        projectPath: project.path,
        draftManifest,
        expectedRevision: project.manifestRevision,
        saveManifestFn: saveManifestQueued,
        onSaved,
        setDraftManifest,
        notify,
        isDraftSnapshotCurrent: () => isDraftSnapshotCurrent(savedDraftVersion, draftVersionRef.current),
      });
    } finally {
      setSavingDraft(false);
    }
  };

  useEffect(() => {
    const handleSaveShortcut = (event: globalThis.KeyboardEvent) => {
      if (!isSaveKeyboardShortcut(event) || !draftManifest) return;
      event.preventDefault();
      void handleSaveManifestDraft();
    };
    window.addEventListener("keydown", handleSaveShortcut);
    return () => window.removeEventListener("keydown", handleSaveShortcut);
  }, [draftManifest, savingDraft]);

  // 防崩：project.content.manifest 类型声明为 Manifest，但运行时可能是坏数据
  // （如旧 flat audio）。用 ManifestSchema.safeParse 兜底——解析失败则用
  // EMPTY_MANIFEST，避免 Object.values(undefined) 崩溃。坏 manifest 的结构错误
  // 已由后端 validate_manifest_structure 进全局 projectReport，资产页只需保证不崩。
  const projectParsedManifest = useMemo(() => ManifestSchema.safeParse(project.content.manifest), [project.content.manifest]);
  const manifest: Manifest = draftManifest ?? (projectParsedManifest.success ? projectParsedManifest.data : EMPTY_MANIFEST);
  const manifestInvalid = !projectParsedManifest.success;
  const readOnly = !canMutateAssets(manifestInvalid);
  const isDirty = draftManifest !== null;

  const view = useAssets(project.path, refreshKey, manifest, project.assetReport);
  const assetUsage = useMemo(() => analyzeAssetUsage(manifest, project.nodes), [manifest, project.nodes]);

  function notify(input: ToastInput) {
    setToast({ id: Date.now(), ...input });
  }

  async function saveManifestQueued(projectPath: string, next: Manifest): Promise<FileRevision | null> {
    const nextRevision = await manifestMutationQueue.enqueue((expectedRevision) => (
      saveManifest(projectPath, next, expectedRevision)
    ));
    draftBaseRevisionRef.current = nextRevision;
    setDraftBaseVersion((version) => version + 1);
    return nextRevision;
  }

  // 磁盘路径 → 被多少 manifest 条目引用
  const refCountByPath = useMemo(() => countRefs(manifest), [manifest]);

  // 按 section + 搜索过滤磁盘资产
  const filteredDisk = useMemo(() => {
    const q = search.trim().toLowerCase();
    return view.onDisk.filter((entry) => {
      if (section !== "overview" && entry.kind !== section) return false;
      if (!q) return true;
      const id = baseName(entry.relPath).toLowerCase();
      return id.includes(q) || entry.relPath.toLowerCase().includes(q);
    });
  }, [view.onDisk, section, search]);

  const filteredDangling = useMemo(() => {
    const q = search.trim().toLowerCase();
    return view.dangling.filter((d) => {
      if (section !== "overview" && d.kind !== section) return false;
      if (!q) return true;
      return d.id.toLowerCase().includes(q) || d.path.toLowerCase().includes(q);
    });
  }, [view.dangling, section, search]);
  const cleanupProposal = useMemo(
    () => buildAssetCleanupProposal(manifest, {
      unusedManifestPaths: assetUsage.unusedManifestPaths,
      missingManifestSources: filteredDangling.map((entry) => entry.source),
      unregisteredDiskPaths: filteredDisk.filter((entry) => view.orphanPaths.has(entry.relPath)).map((entry) => entry.relPath),
    }),
    [assetUsage.unusedManifestPaths, filteredDangling, filteredDisk, manifest, view.orphanPaths],
  );

  async function handleImport() {
    if (readOnly) return;
    const savedDraftVersion = draftVersionRef.current;
    const kind = section === "overview" ? "background" : section;
    if (!isRegistrableAssetKind(kind)) return;
    const files = await pickAssetFiles(kind);
    if (files.length === 0) return;

    // 逐个导入；目标路径 = assets/<分类目录>/<原文件名>
    const subDir = kindDir(kind);
    const errors: string[] = [];
    const newPaths: { id: string; path: string; kind: RegistrableAssetKind }[] = [];
    for (const src of files) {
      const fileName = src.split(/[/\\]/).pop() ?? "asset";
      const id = baseName(fileName);
      const destRel = `assets/${subDir}/${fileName}`;
      try {
        await importAsset(project.path, src, destRel);
        newPaths.push({ id, path: destRel, kind });
      } catch (e) {
        errors.push(`${fileName}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 自动登记到 manifest
    let manifestSaveError: unknown = null;
    if (newPaths.length > 0) {
      const next = applyAssetRegistrations(manifest, newPaths);
      try {
        await saveManifestQueued(project.path, next);
        if (isDraftSnapshotCurrent(savedDraftVersion, draftVersionRef.current)) setDraftManifest(null);
      } catch (e) {
        manifestSaveError = e;
        if (isDraftSnapshotCurrent(savedDraftVersion, draftVersionRef.current)) setDraftManifest(next);
      }
    }

    if (manifestSaveError) {
      const failure = createManifestSaveFailureToast(manifestSaveError);
      notify({
        ...failure,
        detail: errors.length > 0
          ? `${failure.detail}\n\n同时有 ${errors.length} 个资源导入失败：\n${errors.join("\n")}`
          : failure.detail,
      });
    } else if (errors.length > 0) {
      notify(createImportFailureToast(errors, newPaths.length));
    } else if (newPaths.length > 0) {
      notify({ kind: "success", message: `已导入 ${newPaths.length} 个资源` });
    }
    await onSaved();
  }

  async function handleDelete(relPath: string, assetRevision?: FileRevision) {
    if (readOnly) return;
    const savedDraftVersion = draftVersionRef.current;
    // 删除资产时同步移除所有指向它的 manifest 引用，
    // 否则会立刻制造 missing_asset（悬空引用）。
    const result = await deleteAssetAndPruneManifestRefs({
      projectPath: project.path,
      relPath,
      manifest,
      refCountByPath,
      assetRevision,
      manifestRevision: project.manifestRevision,
      deleteAssetFn: deleteAsset,
      saveManifestFn: saveManifestQueued,
    });
    const failureToast = createAssetDeleteFailureToast(result, relPath);
    if (failureToast) {
      notify(failureToast);
    }
    if (result.manifestSaved && isDraftSnapshotCurrent(savedDraftVersion, draftVersionRef.current)) {
      setDraftManifest(null);
    }
    await onSaved();
  }

  function handleRegisterOrphan(entry: AssetEntry) {
    if (readOnly) return;
    void persistManifest(registerOrphanAssets(manifest, [entry]));
  }

  function handleRemoveDanglingRef(source: string) {
    if (readOnly) return;
    // source 形如 "backgrounds.sky" / "audio.bgm.theme" / "characters.h.sprites.default"
    const next = removeManifestEntry(manifest, source);
    void persistManifest(next);
  }

  async function handleRegisterAllOrphans() {
    if (readOnly) return;
    const candidates = filteredDisk.filter((entry) => view.orphanPaths.has(entry.relPath));
    if (candidates.length === 0) return;
    await persistManifest(registerOrphanAssets(manifest, candidates));
  }

  async function handleRemoveAllDanglingRefs() {
    if (readOnly || filteredDangling.length === 0) return;
    await persistManifest(removeDanglingRefs(manifest, filteredDangling.map((entry) => entry.source)));
  }

  function handleCleanupManifestEntries() {
    if (readOnly || cleanupProposal.removeSources.length === 0) return;
    setConfirm({
      message: [
        `将从 manifest 移除 ${cleanupProposal.removeSources.length} 个未使用或悬空条目。`,
        "不会删除磁盘文件。",
        ...cleanupProposal.diffPreview.slice(0, 8),
      ].join("\n"),
      onConfirm: () => void persistManifest(applyAssetCleanupProposal(manifest, cleanupProposal)),
    });
  }

  function handleDeleteAllOrphans() {
    if (readOnly) return;
    const candidates = filteredDisk.filter((entry) => view.orphanPaths.has(entry.relPath));
    if (candidates.length === 0) return;
    setConfirm({
      message: `确定删除当前筛选下的 ${candidates.length} 个孤儿资源？`,
      onConfirm: async () => {
        for (const entry of candidates) {
          await handleDelete(entry.relPath, entry.revision);
        }
      },
    });
  }

  async function persistManifest(next: Manifest) {
    if (readOnly) return;
    const savedDraftVersion = draftVersionRef.current;
    await persistManifestWithFeedback({
      projectPath: project.path,
      next,
      expectedRevision: project.manifestRevision,
      saveManifestFn: saveManifestQueued,
      onSaved,
      setDraftManifest,
      notify,
      isDraftSnapshotCurrent: () => isDraftSnapshotCurrent(savedDraftVersion, draftVersionRef.current),
    });
  }

  const totalShown = filteredDisk.length + filteredDangling.length;

  return (
    <div style={rootStyle}>
      <CollapsibleSidebar
        title="资产"
        collapsed={sidebarCollapsed}
        onCollapsedChange={onSidebarCollapsedChange}
        expandedWidth={132}
        collapsedLabel="资产"
      >
        <AssetsSidebar active={section} onSelect={setSection} />
      </CollapsibleSidebar>
      <div style={mainStyle}>
        {manifestInvalid && (
          <div style={invalidBannerStyle}>
            manifest 结构异常（可能是旧格式），资产操作已禁用。详见右下角问题面板。
          </div>
        )}
        {section === "character" ? (
          <CharacterEditor
            projectPath={project.path}
            manifest={manifest}
            disabled={readOnly}
            onChange={handleStageManifestDraft}
            onFeedback={notify}
          />
        ) : (
          <>
            <AssetsToolbar
              section={section}
              search={search}
              onSearch={setSearch}
              onImport={handleImport}
              count={totalShown}
              orphanCount={filteredDisk.filter((entry) => view.orphanPaths.has(entry.relPath)).length}
              danglingCount={filteredDangling.length}
              onRegisterOrphans={handleRegisterAllOrphans}
              onRemoveDanglingRefs={handleRemoveAllDanglingRefs}
              onDeleteOrphans={handleDeleteAllOrphans}
              disabled={readOnly}
            />
            {isExtendedAssetSection(section) && (
              <ExtendedAssetRegistryEditor
                section={section}
                manifest={manifest}
                disabled={readOnly}
                onChange={handleStageManifestDraft}
              />
            )}
            {cleanupProposal.removeSources.length > 0 && (
              <div style={cleanupBarStyle}>
                <span>{`Cleanup dry-run: ${cleanupProposal.removeSources.length} 个 manifest 条目可清理，${cleanupProposal.unregisteredDiskPaths.length} 个磁盘文件未注册`}</span>
                <button type="button" style={cleanupButtonStyle} onClick={handleCleanupManifestEntries} disabled={readOnly}>
                  确认清理 manifest
                </button>
              </div>
            )}
            <div style={scrollStyle}>
              <AssetGrid emptyHint="没有匹配的资源">
                {filteredDisk.map((entry) => (
                  <AssetCard
                    key={entry.relPath}
                    entry={entry}
                    projectPath={project.path}
                    isOrphan={view.orphanPaths.has(entry.relPath)}
                    refCount={refCountByPath.get(entry.relPath) ?? 0}
                    usageCount={assetUsage.usageCountByPath.get(entry.relPath) ?? 0}
                    unusedInStory={assetUsage.unusedManifestPaths.has(entry.relPath)}
                    readOnly={readOnly}
                    onDelete={handleDelete}
                    onRegisterOrphan={handleRegisterOrphan}
                  />
                ))}
                {filteredDangling.map((d) => (
                  <DanglingCard
                    key={`dangling-${d.source}`}
                    id={d.id}
                    path={d.path}
                    source={d.source}
                    readOnly={readOnly}
                    onRemoveRef={handleRemoveDanglingRef}
                  />
                ))}
              </AssetGrid>
            </div>
          </>
        )}
      </div>

      {/* 草稿提示（角色编辑等本地未保存时） */}
      <DraftManifestBanner
        isDirty={isDirty}
        canSave={!readOnly && !manifestInvalid && !savingDraft}
        saving={savingDraft}
        onSave={() => void handleSaveManifestDraft()}
        onDiscard={handleDiscardManifestDraft}
      />

      <Toast toast={toast} onClose={() => setToast(null)} />

      {confirm && (
        <ConfirmDialog
          message={confirm.message}
          danger
          confirmLabel="删除"
          onConfirm={confirm.onConfirm}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

// ── manifest / 资产操作辅助（便于单测） ──

export function canMutateAssets(manifestInvalid: boolean): boolean {
  return !manifestInvalid;
}

export interface StoredManifestDraft {
  version: 1;
  manifest: Manifest;
  baseRevision?: FileRevision | null;
}

export function loadManifestDraft(storage: DraftStorage | null, key: string): StoredManifestDraft | null {
  const value = loadProjectDraft(storage, key);
  if (!value || typeof value !== "object") return null;
  const draft = value as Partial<StoredManifestDraft>;
  if (draft.version !== 1) return null;
  const parsed = ManifestSchema.safeParse(draft.manifest);
  return parsed.success ? { ...draft, manifest: parsed.data } as StoredManifestDraft : null;
}

/** Character fields are edited locally and only persisted from the draft banner. */
export function stageManifestDraft(
  next: Manifest,
  setDraftManifest: (manifest: Manifest | null) => void,
): void {
  setDraftManifest(next);
}

export interface SaveDraftManifestParams {
  projectPath: string;
  draftManifest: Manifest | null;
  expectedRevision?: FileRevision | null;
  saveManifestFn: (projectPath: string, manifest: Manifest, expectedRevision?: FileRevision | null) => Promise<FileRevision | null | void>;
  onSaved: () => void | Promise<void>;
  setDraftManifest: (manifest: Manifest | null) => void;
  notify: (toast: ToastInput) => void;
  isDraftSnapshotCurrent?: () => boolean;
}

export async function saveDraftManifest({
  projectPath,
  draftManifest,
  expectedRevision,
  saveManifestFn,
  onSaved,
  setDraftManifest,
  notify,
  isDraftSnapshotCurrent,
}: SaveDraftManifestParams): Promise<void> {
  if (!draftManifest) return;
  await persistManifestWithFeedback({
    projectPath,
    next: draftManifest,
    expectedRevision,
    saveManifestFn,
    onSaved,
    setDraftManifest,
    notify,
    isDraftSnapshotCurrent,
  });
}

export function discardDraftManifest(setDraftManifest: (manifest: Manifest | null) => void): void {
  setDraftManifest(null);
}

export interface PersistManifestWithFeedbackParams {
  projectPath: string;
  next: Manifest;
  saveManifestFn: (projectPath: string, manifest: Manifest, expectedRevision?: FileRevision | null) => Promise<FileRevision | null | void>;
  onSaved: () => void | Promise<void>;
  setDraftManifest: (manifest: Manifest | null) => void;
  notify: (toast: ToastInput) => void;
  expectedRevision?: FileRevision | null;
  isDraftSnapshotCurrent?: () => boolean;
}

export async function persistManifestWithFeedback({
  projectPath,
  next,
  expectedRevision,
  saveManifestFn,
  onSaved,
  setDraftManifest,
  notify,
  isDraftSnapshotCurrent = () => true,
}: PersistManifestWithFeedbackParams): Promise<void> {
  try {
    await saveManifestFn(projectPath, next, expectedRevision);
    if (isDraftSnapshotCurrent()) setDraftManifest(null);
    await onSaved();
  } catch (error) {
    if (isDraftSnapshotCurrent()) setDraftManifest(next);
    notify(createManifestSaveFailureToast(error));
  }
}

export function createManifestSaveFailureToast(error: unknown): ToastInput {
  return {
    kind: "error",
    message: "保存 manifest 失败",
    detail: `${formatUnknownError(error)}。当前草稿已保留。`,
  };
}

export function createImportFailureToast(errors: string[], importedCount: number): ToastInput {
  const failureCount = errors.length;
  return {
    kind: "error",
    message:
      importedCount > 0
        ? `已导入 ${importedCount} 个资源，${failureCount} 个失败`
        : `导入失败：${failureCount} 个资源失败`,
    detail: errors.join("\n"),
  };
}

export function createAssetDeleteFailureToast(
  result: DeleteAssetAndPruneManifestRefsResult,
  relPath: string,
): ToastInput | null {
  if (!result.deleted && result.manifestSaved) {
    return {
      kind: "error",
      message: "引用已移除，但资产文件未删除",
      detail: `${relPath}\n${formatUnknownError(result.error)}。文件仍在磁盘，可重新登记为资产。`,
    };
  }

  if (!result.deleted && result.manifestSaveFailed) {
    return {
      kind: "error",
      message: "manifest 更新失败，未删除资产",
      detail: `${relPath}\n${formatUnknownError(result.error)}。资产及原引用均已保留。`,
    };
  }

  if (!result.deleted) {
    return {
      kind: "error",
      message: "删除资产失败",
      detail: `${relPath}\n${formatUnknownError(result.error)}`,
    };
  }

  if (result.manifestSaveFailed) {
    return {
      kind: "error",
      message: "资产已删除，但 manifest 更新失败",
      detail: `${relPath}\n${formatUnknownError(result.error)}。请刷新项目后检查悬空引用。`,
    };
  }

  return null;
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface DraftManifestBannerProps {
  isDirty: boolean;
  canSave: boolean;
  onSave: () => void;
  onDiscard: () => void;
  saving?: boolean;
}

export function DraftManifestBanner({ isDirty, canSave, onSave, onDiscard, saving = false }: DraftManifestBannerProps) {
  if (!isDirty) return null;
  return (
    <div style={draftBannerStyle}>
      <div style={draftBannerTextStyle}>有未保存的改动…</div>
      <div style={draftBannerActionsStyle}>
        <button type="button" style={draftDiscardBtnStyle} onClick={onDiscard}>
          放弃改动
        </button>
        {canSave && (
          <button type="button" style={draftSaveBtnStyle} onClick={onSave} disabled={saving}>
            {saving ? "保存中…" : "保存改动"}
          </button>
        )}
      </div>
    </div>
  );
}

function ExtendedAssetRegistryEditor({
  section,
  manifest,
  disabled,
  onChange,
}: {
  section: ExtendedAssetSection;
  manifest: Manifest;
  disabled: boolean;
  onChange: (manifest: Manifest) => void;
}) {
  if (section === "cg") {
    const entries = Object.entries(manifest.cg ?? {});
    return (
      <RegistryPanel title="CG 登记" empty={entries.length === 0}>
        {entries.map(([id, asset]) => (
          <RegistryCard key={id} id={id} onDelete={() => onChange(removeManifestEntry(manifest, `cg.${id}`))} disabled={disabled}>
            <RegistryTextField label="path" value={asset.path} disabled={disabled} onChange={(path) => {
              onChange({ ...manifest, cg: { ...(manifest.cg ?? {}), [id]: { ...asset, path } } });
            }} />
            <RegistryTextField label="名称" value={asset.name ?? ""} disabled={disabled} onChange={(name) => {
              onChange({ ...manifest, cg: { ...(manifest.cg ?? {}), [id]: { ...asset, name: optionalText(name) } } });
            }} />
            <RegistryTextField label="缩略图" value={asset.thumbnail ?? ""} disabled={disabled} onChange={(thumbnail) => {
              onChange({ ...manifest, cg: { ...(manifest.cg ?? {}), [id]: { ...asset, thumbnail: optionalText(thumbnail) } } });
            }} />
            <RegistryTextField label="标签" value={(asset.tags ?? []).join(", ")} disabled={disabled} onChange={(tags) => {
              onChange({ ...manifest, cg: { ...(manifest.cg ?? {}), [id]: { ...asset, tags: parseTags(tags) } } });
            }} />
            <RegistryTextField label="分组" value={asset.group ?? ""} disabled={disabled} onChange={(group) => {
              onChange({ ...manifest, cg: { ...(manifest.cg ?? {}), [id]: { ...asset, group: optionalText(group) } } });
            }} />
            <RegistryTextField label="unlockId" value={asset.unlockId ?? ""} disabled={disabled} onChange={(unlockId) => {
              onChange({ ...manifest, cg: { ...(manifest.cg ?? {}), [id]: { ...asset, unlockId: optionalText(unlockId) } } });
            }} />
          </RegistryCard>
        ))}
      </RegistryPanel>
    );
  }

  if (section === "video") {
    const entries = Object.entries(manifest.videos ?? {});
    return (
      <RegistryPanel title="视频登记" empty={entries.length === 0}>
        {entries.map(([id, asset]) => (
          <RegistryCard key={id} id={id} onDelete={() => onChange(removeManifestEntry(manifest, `videos.${id}`))} disabled={disabled}>
            <RegistryTextField label="path" value={asset.path} disabled={disabled} onChange={(path) => {
              onChange({ ...manifest, videos: { ...(manifest.videos ?? {}), [id]: { ...asset, path } } });
            }} />
            <RegistryTextField label="名称" value={asset.name ?? ""} disabled={disabled} onChange={(name) => {
              onChange({ ...manifest, videos: { ...(manifest.videos ?? {}), [id]: { ...asset, name: optionalText(name) } } });
            }} />
            <RegistryTextField label="poster" value={asset.poster ?? ""} disabled={disabled} onChange={(poster) => {
              onChange({ ...manifest, videos: { ...(manifest.videos ?? {}), [id]: { ...asset, poster: optionalText(poster) } } });
            }} />
            <RegistryTextField label="标签" value={(asset.tags ?? []).join(", ")} disabled={disabled} onChange={(tags) => {
              onChange({ ...manifest, videos: { ...(manifest.videos ?? {}), [id]: { ...asset, tags: parseTags(tags) } } });
            }} />
            <label style={registryCheckboxStyle}>
              <input
                type="checkbox"
                checked={asset.skippable ?? false}
                disabled={disabled}
                onChange={(event) => {
                  onChange({ ...manifest, videos: { ...(manifest.videos ?? {}), [id]: { ...asset, skippable: event.target.checked } } });
                }}
              />
              可跳过
            </label>
          </RegistryCard>
        ))}
      </RegistryPanel>
    );
  }

  if (section === "font") {
    const entries = Object.entries(manifest.fonts ?? {});
    return (
      <RegistryPanel title="字体登记" empty={entries.length === 0}>
        {entries.map(([id, font]) => (
          <RegistryCard key={id} id={id} onDelete={() => onChange(removeManifestEntry(manifest, `fonts.${id}`))} disabled={disabled}>
            <RegistryTextField label="path" value={font.path} disabled={disabled} onChange={(path) => {
              onChange({ ...manifest, fonts: { ...(manifest.fonts ?? {}), [id]: { ...font, path } } });
            }} />
            <RegistryTextField label="family" value={font.family} disabled={disabled} onChange={(family) => {
              onChange({ ...manifest, fonts: { ...(manifest.fonts ?? {}), [id]: { ...font, family } } });
            }} />
            <RegistryTextField label="weight" value={font.weight ?? ""} disabled={disabled} onChange={(weight) => {
              onChange({ ...manifest, fonts: { ...(manifest.fonts ?? {}), [id]: { ...font, weight: optionalText(weight) } } });
            }} />
            <RegistryTextField label="style" value={font.style ?? ""} disabled={disabled} onChange={(style) => {
              onChange({ ...manifest, fonts: { ...(manifest.fonts ?? {}), [id]: { ...font, style: optionalText(style) } } });
            }} />
          </RegistryCard>
        ))}
      </RegistryPanel>
    );
  }

  if (section === "ui") {
    const entries = Object.entries(manifest.uiSkins ?? {});
    return (
      <RegistryPanel title="UI Skin 登记" empty={entries.length === 0}>
        {entries.map(([id, skin]) => (
          <RegistryCard key={id} id={id} onDelete={() => onChange(removeUiSkin(manifest, id))} disabled={disabled}>
            <RegistryTextField label="名称" value={skin.name ?? ""} disabled={disabled} onChange={(name) => {
              onChange({ ...manifest, uiSkins: { ...(manifest.uiSkins ?? {}), [id]: { ...skin, name: optionalText(name) } } });
            }} />
            {Object.entries(skin.assets ?? {}).map(([assetId, path]) => (
              <RegistryTextField key={assetId} label={`assets.${assetId}`} value={path} disabled={disabled} onChange={(nextPath) => {
                onChange({
                  ...manifest,
                  uiSkins: {
                    ...(manifest.uiSkins ?? {}),
                    [id]: { ...skin, assets: { ...(skin.assets ?? {}), [assetId]: nextPath } },
                  },
                });
              }} />
            ))}
            {Object.keys(skin.assets ?? {}).length === 0 && (
              <div style={registryEmptyTextStyle}>没有 UI 资源槽；导入或登记 UI 资源会创建 default 槽。</div>
            )}
          </RegistryCard>
        ))}
      </RegistryPanel>
    );
  }

  const entries = Object.entries(manifest.animationAtlases ?? {});
  return (
    <RegistryPanel title="动画图集登记" empty={entries.length === 0}>
      {entries.map(([id, atlas]) => (
        <RegistryCard key={id} id={id} onDelete={() => onChange(removeManifestEntry(manifest, `animationAtlases.${id}.image`))} disabled={disabled}>
          <RegistryTextField label="image" value={atlas.image} disabled={disabled} onChange={(image) => {
            onChange({ ...manifest, animationAtlases: { ...(manifest.animationAtlases ?? {}), [id]: { ...atlas, image } } });
          }} />
          <RegistryTextField label="json" value={atlas.json ?? ""} disabled={disabled} onChange={(json) => {
            onChange({ ...manifest, animationAtlases: { ...(manifest.animationAtlases ?? {}), [id]: { ...atlas, json: optionalText(json) } } });
          }} />
          <RegistryTextField label="frameWidth" value={atlas.frameWidth ? String(atlas.frameWidth) : ""} disabled={disabled} onChange={(value) => {
            onChange({ ...manifest, animationAtlases: { ...(manifest.animationAtlases ?? {}), [id]: { ...atlas, frameWidth: positiveIntegerOrUndefined(value) } } });
          }} />
          <RegistryTextField label="frameHeight" value={atlas.frameHeight ? String(atlas.frameHeight) : ""} disabled={disabled} onChange={(value) => {
            onChange({ ...manifest, animationAtlases: { ...(manifest.animationAtlases ?? {}), [id]: { ...atlas, frameHeight: positiveIntegerOrUndefined(value) } } });
          }} />
        </RegistryCard>
      ))}
    </RegistryPanel>
  );
}

function RegistryPanel({ title, empty, children }: { title: string; empty: boolean; children: React.ReactNode }) {
  return (
    <section style={registryPanelStyle} aria-label={title}>
      <div style={registryPanelHeaderStyle}>
        <span style={registryPanelTitleStyle}>{title}</span>
        <span style={registryPanelHintStyle}>导入/登记后在这里编辑 manifest 字段，统一通过底部草稿条保存。</span>
      </div>
      {empty ? (
        <EmptyState icon={Inbox} title="暂无条目" description="可先导入该类型资产，或登记当前分类下的孤儿文件。" />
      ) : (
        <div style={registryCardListStyle}>{children}</div>
      )}
    </section>
  );
}

function RegistryCard({
  id,
  disabled,
  onDelete,
  children,
}: {
  id: string;
  disabled: boolean;
  onDelete: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={registryCardStyle}>
      <div style={registryCardHeaderStyle}>
        <span style={registryIdStyle}>{id}</span>
        <button
          type="button"
          style={registryDeleteButtonStyle}
          disabled={disabled}
          onClick={onDelete}
        >
          移除登记
        </button>
      </div>
      <div style={registryFieldsStyle}>{children}</div>
    </div>
  );
}

function RegistryTextField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label style={registryFieldStyle}>
      <span style={registryFieldLabelStyle}>{label}</span>
      <input
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        style={registryInputStyle}
      />
    </label>
  );
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parseTags(value: string): string[] | undefined {
  const tags = value.split(",").map((tag) => tag.trim()).filter(Boolean);
  return tags.length > 0 ? tags : undefined;
}

function positiveIntegerOrUndefined(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function removeUiSkin(manifest: Manifest, id: string): Manifest {
  const next = { ...(manifest.uiSkins ?? {}) };
  delete next[id];
  return { ...manifest, uiSkins: next };
}

export interface DeleteAssetAndPruneManifestRefsParams {
  projectPath: string;
  relPath: string;
  manifest: Manifest;
  refCountByPath: Map<string, number>;
  deleteAssetFn: (projectPath: string, relPath: string, expectedRevision?: FileRevision | null) => Promise<void>;
  saveManifestFn: (projectPath: string, manifest: Manifest, expectedRevision?: FileRevision | null) => Promise<FileRevision | null | void>;
  assetRevision?: FileRevision;
  manifestRevision?: FileRevision | null;
}

export interface DeleteAssetAndPruneManifestRefsResult {
  deleted: boolean;
  manifestSaved: boolean;
  manifestSaveFailed: boolean;
  error?: unknown;
}

export async function deleteAssetAndPruneManifestRefs({
  projectPath,
  relPath,
  manifest,
  refCountByPath,
  assetRevision,
  manifestRevision,
  deleteAssetFn,
  saveManifestFn,
}: DeleteAssetAndPruneManifestRefsParams): Promise<DeleteAssetAndPruneManifestRefsResult> {
  const normalized = relPath.replace(/\\/g, "/");
  const refs = refCountByPath.get(normalized) ?? 0;
  const nextManifest = refs > 0 ? removeAllRefsToPath(manifest, normalized) : manifest;

  // 有引用时先安全地写入已剪枝的 manifest。这样后续文件删除失败时，
  // 最坏结果只是一个可重新登记的孤儿文件，而不是引用仍在但文件已进入 trash。
  if (refs > 0) {
    try {
      await saveManifestFn(projectPath, nextManifest, manifestRevision);
    } catch (error) {
      return { deleted: false, manifestSaved: false, manifestSaveFailed: true, error };
    }
  }

  try {
    await deleteAssetFn(projectPath, relPath, assetRevision);
  } catch (error) {
    return { deleted: false, manifestSaved: refs > 0, manifestSaveFailed: false, error };
  }

  if (refs === 0) {
    return { deleted: true, manifestSaved: false, manifestSaveFailed: false };
  }
  return { deleted: true, manifestSaved: true, manifestSaveFailed: false };
}

/** 按 kind 决定导入目标子目录（与 Rust AssetKind::from_rel_path 对齐）。 */
function kindDir(kind: RegistrableAssetKind): string {
  switch (kind) {
    case "background":
      return "backgrounds";
    case "bgm":
      return "audio/bgm";
    case "sfx":
      return "audio/sfx";
    case "voice":
      return "audio/voice";
    case "cg":
      return "cg";
    case "video":
      return "videos";
    case "font":
      return "fonts";
    case "ui":
      return "ui";
    case "animation":
      return "atlases";
  }
}

/** 把一批 (id, path, kind) 登记进 manifest。同 id 已存在则跳过。 */
export function applyAssetRegistrations(
  manifest: Manifest,
  registrations: { id: string; path: string; kind: RegistrableAssetKind }[],
): Manifest {
  let next = manifest;
  for (const { id, path, kind } of registrations) {
    switch (kind) {
      case "background":
        if (!(id in next.backgrounds)) {
          next = { ...next, backgrounds: { ...next.backgrounds, [id]: path } };
        }
        break;
      case "bgm":
        if (!(id in next.audio.bgm)) {
          next = { ...next, audio: { ...next.audio, bgm: { ...next.audio.bgm, [id]: path } } };
        }
        break;
      case "sfx":
        if (!(id in next.audio.sfx)) {
          next = { ...next, audio: { ...next.audio, sfx: { ...next.audio.sfx, [id]: path } } };
        }
        break;
      case "voice":
        if (!(id in next.audio.voice)) {
          next = { ...next, audio: { ...next.audio, voice: { ...next.audio.voice, [id]: path } } };
        }
        break;
      case "cg":
        if (!(id in (next.cg ?? {}))) {
          next = { ...next, cg: { ...(next.cg ?? {}), [id]: { path, name: id } } };
        }
        break;
      case "video":
        if (!(id in (next.videos ?? {}))) {
          next = { ...next, videos: { ...(next.videos ?? {}), [id]: { path, name: id } } };
        }
        break;
      case "font":
        if (!(id in (next.fonts ?? {}))) {
          next = { ...next, fonts: { ...(next.fonts ?? {}), [id]: { path, family: id } } };
        }
        break;
      case "ui":
        if (!(id in (next.uiSkins ?? {}))) {
          next = { ...next, uiSkins: { ...(next.uiSkins ?? {}), [id]: { name: id, assets: { default: path } } } };
        }
        break;
      case "animation":
        if (!(id in (next.animationAtlases ?? {}))) {
          next = { ...next, animationAtlases: { ...(next.animationAtlases ?? {}), [id]: { image: path } } };
        }
        break;
    }
  }
  return next;
}

export function registerOrphanAssets(manifest: Manifest, entries: AssetEntry[]): Manifest {
  const registrations = entries
    .filter((entry): entry is AssetEntry & { kind: RegistrableAssetKind } =>
      isRegistrableAssetKind(entry.kind))
    .map((entry) => ({
      id: baseName(entry.relPath),
      path: entry.relPath,
      kind: entry.kind,
    }));
  return applyAssetRegistrations(manifest, registrations);
}

/**
 * 按 source 路径移除 manifest 条目。
 * source 形如 "backgrounds.sky" / "audio.bgm.theme" / "characters.h.sprites.default"。
 */
export function removeManifestEntry(manifest: Manifest, source: string): Manifest {
  const parts = source.split(".");
  // backgrounds.<id>
  if (parts[0] === "backgrounds" && parts.length === 2) {
    const next = { ...manifest.backgrounds };
    delete next[parts[1]];
    return { ...manifest, backgrounds: next };
  }
  // audio.<sub>.<id>
  if (parts[0] === "audio" && parts.length === 3) {
    const sub = parts[1] as "bgm" | "sfx" | "voice";
    const table = { ...manifest.audio[sub] };
    delete table[parts[2]];
    return { ...manifest, audio: { ...manifest.audio, [sub]: table } };
  }
  // characters.<id>.sprites.<expr>
  if (parts[0] === "characters" && parts.length === 4 && parts[2] === "sprites") {
    const char = manifest.characters[parts[1]];
    if (!char) return manifest;
    const sprites = { ...char.sprites };
    delete sprites[parts[3]];
    return {
      ...manifest,
      characters: { ...manifest.characters, [parts[1]]: { ...char, sprites } },
    };
  }
  if (parts[0] === "cg" && parts.length === 2) {
    const next = { ...(manifest.cg ?? {}) };
    delete next[parts[1]];
    return { ...manifest, cg: next };
  }
  if (parts[0] === "cg" && parts.length === 3 && parts[2] === "thumbnail") {
    const asset = manifest.cg?.[parts[1]];
    if (!asset) return manifest;
    const { thumbnail: _thumbnail, ...rest } = asset;
    return { ...manifest, cg: { ...(manifest.cg ?? {}), [parts[1]]: rest } };
  }
  if (parts[0] === "videos" && parts.length === 2) {
    const next = { ...(manifest.videos ?? {}) };
    delete next[parts[1]];
    return { ...manifest, videos: next };
  }
  if (parts[0] === "videos" && parts.length === 3 && parts[2] === "poster") {
    const asset = manifest.videos?.[parts[1]];
    if (!asset) return manifest;
    const { poster: _poster, ...rest } = asset;
    return { ...manifest, videos: { ...(manifest.videos ?? {}), [parts[1]]: rest } };
  }
  if (parts[0] === "fonts" && parts.length === 2) {
    const next = { ...(manifest.fonts ?? {}) };
    delete next[parts[1]];
    return { ...manifest, fonts: next };
  }
  if (parts[0] === "uiSkins" && parts.length === 4 && parts[2] === "assets") {
    const skin = manifest.uiSkins?.[parts[1]];
    if (!skin) return manifest;
    const assets = { ...skin.assets };
    delete assets[parts[3]];
    return { ...manifest, uiSkins: { ...manifest.uiSkins, [parts[1]]: { ...skin, assets } } };
  }
  if (parts[0] === "animationAtlases" && parts.length === 3) {
    if (parts[2] === "image") {
      const next = { ...(manifest.animationAtlases ?? {}) };
      delete next[parts[1]];
      return { ...manifest, animationAtlases: next };
    }
    const atlas = manifest.animationAtlases?.[parts[1]];
    if (!atlas) return manifest;
    const nextAtlas = { ...atlas };
    delete nextAtlas[parts[2] as keyof typeof nextAtlas];
    return { ...manifest, animationAtlases: { ...manifest.animationAtlases, [parts[1]]: nextAtlas } };
  }
  return manifest;
}

export function removeDanglingRefs(manifest: Manifest, sources: string[]): Manifest {
  return sources.reduce((next, source) => removeManifestEntry(next, source), manifest);
}

export interface AssetCleanupProposalInput {
  unusedManifestPaths: Set<string>;
  missingManifestSources: string[];
  unregisteredDiskPaths: string[];
}

export interface AssetCleanupProposal {
  removeSources: string[];
  unregisteredDiskPaths: string[];
  diffPreview: string[];
}

export function buildAssetCleanupProposal(
  manifest: Manifest,
  input: AssetCleanupProposalInput,
): AssetCleanupProposal {
  const removeSources = new Set<string>();
  const normalizedUnusedPaths = new Set(Array.from(input.unusedManifestPaths, normalizeAssetPath));
  collectManifestEntrySources(manifest).forEach((entry) => {
    if (normalizedUnusedPaths.has(normalizeAssetPath(entry.path))) {
      removeSources.add(entry.source);
    }
  });
  input.missingManifestSources.forEach((source) => removeSources.add(source));

  const sources = Array.from(removeSources);
  return {
    removeSources: sources,
    unregisteredDiskPaths: [...input.unregisteredDiskPaths].sort(),
    diffPreview: [
      ...sources.map((source) => `- manifest:${source}`),
      ...input.unregisteredDiskPaths.sort().map((path) => `disk-only:${path}`),
    ],
  };
}

export function applyAssetCleanupProposal(
  manifest: Manifest,
  proposal: AssetCleanupProposal,
  _options: { deleteDiskFile?: (path: string) => void } = {},
): Manifest {
  return removeDanglingRefs(manifest, proposal.removeSources);
}

function collectManifestEntrySources(manifest: Manifest): { source: string; path: string }[] {
  const entries: { source: string; path: string }[] = [];
  Object.entries(manifest.backgrounds ?? {}).forEach(([id, path]) => entries.push({ source: `backgrounds.${id}`, path }));
  Object.entries(manifest.characters ?? {}).forEach(([id, character]) => {
    Object.entries(character.sprites ?? {}).forEach(([expr, path]) => {
      entries.push({ source: `characters.${id}.sprites.${expr}`, path });
    });
  });
  Object.entries(manifest.audio?.bgm ?? {}).forEach(([id, path]) => entries.push({ source: `audio.bgm.${id}`, path }));
  Object.entries(manifest.audio?.sfx ?? {}).forEach(([id, path]) => entries.push({ source: `audio.sfx.${id}`, path }));
  Object.entries(manifest.audio?.voice ?? {}).forEach(([id, path]) => entries.push({ source: `audio.voice.${id}`, path }));
  Object.entries(manifest.cg ?? {}).forEach(([id, asset]) => {
    entries.push({ source: `cg.${id}`, path: asset.path });
    if (asset.thumbnail) entries.push({ source: `cg.${id}.thumbnail`, path: asset.thumbnail });
  });
  Object.entries(manifest.videos ?? {}).forEach(([id, asset]) => {
    entries.push({ source: `videos.${id}`, path: asset.path });
    if (asset.poster) entries.push({ source: `videos.${id}.poster`, path: asset.poster });
  });
  Object.entries(manifest.fonts ?? {}).forEach(([id, font]) => entries.push({ source: `fonts.${id}`, path: font.path }));
  Object.entries(manifest.uiSkins ?? {}).forEach(([id, skin]) => {
    Object.entries(skin.assets ?? {}).forEach(([assetId, path]) => entries.push({ source: `uiSkins.${id}.assets.${assetId}`, path }));
  });
  Object.entries(manifest.animationAtlases ?? {}).forEach(([id, atlas]) => {
    entries.push({ source: `animationAtlases.${id}.image`, path: atlas.image });
    if (atlas.json) entries.push({ source: `animationAtlases.${id}.json`, path: atlas.json });
  });
  return entries;
}

function normalizeAssetPath(path: string): string {
  return path.replace(/\\/g, "/");
}

/** 统计每个磁盘路径被多少 manifest 条目引用。 */
export function countRefs(manifest: Manifest): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (path: string) => {
    const normalized = normalizeAssetPath(path);
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  };
  collectManifestEntrySources(manifest).forEach((entry) => bump(entry.path));
  return counts;
}

/**
 * 移除 manifest 中所有指向给定磁盘路径的引用。
 * 用于删除资产文件时同步清理引用，避免悬空。
 * 不可变，返回新 manifest。
 */
export function removeAllRefsToPath(manifest: Manifest, path: string): Manifest {
  const target = path.replace(/\\/g, "/");
  const sources = collectManifestEntrySources(manifest)
    .filter((entry) => normalizeAssetPath(entry.path) === target)
    .map((entry) => entry.source);
  return removeDanglingRefs(manifest, sources);
}

// ── 样式 ──

const rootStyle: React.CSSProperties = {
  position: "relative",
  display: "flex",
  width: "100%",
  height: "100%",
  background: "var(--bg-app)",
  overflow: "hidden",
};

const mainStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
};

const scrollStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
};

const cleanupBarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--space-2)",
  padding: "var(--space-2) 14px",
  borderBottom: "1px solid var(--border)",
  fontSize: "var(--text-sm)",
  color: "var(--text-secondary)",
  background: "var(--bg-panel)",
};

const cleanupButtonStyle: React.CSSProperties = {
  fontSize: "var(--text-sm)",
  padding: "5px var(--space-3)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-input)",
  background: "var(--bg-active)",
  color: "var(--text-bright)",
  cursor: "pointer",
  flexShrink: 0,
};

const registryPanelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
  padding: "var(--space-3) 14px",
  borderBottom: "1px solid var(--border)",
  background: "var(--bg-app)",
};

const registryPanelHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  flexWrap: "wrap",
  gap: "var(--space-2)",
};

const registryPanelTitleStyle: React.CSSProperties = {
  fontSize: "var(--text-base)",
  fontWeight: 650,
  color: "var(--text-primary)",
};

const registryPanelHintStyle: React.CSSProperties = {
  fontSize: "var(--text-xs)",
  color: "var(--text-muted)",
};

const registryCardListStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
  maxHeight: 260,
  overflowY: "auto",
};

const registryCardStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
  padding: "var(--space-3)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  background: "var(--bg-panel)",
};

const registryCardHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--space-2)",
};

const registryIdStyle: React.CSSProperties = {
  fontSize: "var(--text-sm)",
  fontWeight: 650,
  color: "var(--text-bright)",
};

const registryDeleteButtonStyle: React.CSSProperties = {
  fontSize: "var(--text-xs)",
  padding: "4px var(--space-2)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-input)",
  background: "var(--bg-panel)",
  color: "var(--status-error-text)",
};

const registryFieldsStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "var(--space-2)",
};

const registryFieldStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-1)",
};

const registryFieldLabelStyle: React.CSSProperties = {
  fontSize: "var(--text-xs)",
  color: "var(--text-muted)",
};

const registryInputStyle: React.CSSProperties = {
  height: 28,
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-input)",
  background: "var(--bg-inset)",
  color: "var(--text-primary)",
  padding: "0 var(--space-2)",
  fontSize: "var(--text-sm)",
};

const registryCheckboxStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  fontSize: "var(--text-sm)",
  color: "var(--text-secondary)",
};

const registryEmptyTextStyle: React.CSSProperties = {
  fontSize: "var(--text-sm)",
  color: "var(--text-muted)",
};

const invalidBannerStyle: React.CSSProperties = {
  padding: "var(--space-2) var(--space-3)",
  fontSize: "var(--text-sm)",
  color: "var(--status-error-text)",
  background: "var(--bg-error-soft)",
  borderBottom: `1px solid var(--border-error)`,
};

const draftBannerStyle: React.CSSProperties = {
  position: "absolute",
  bottom: 10,
  left: "50%",
  transform: "translateX(-50%)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexWrap: "wrap",
  gap: "var(--space-2)",
  fontSize: "var(--text-xs)",
  color: "var(--text-muted)",
  background: "var(--bg-app)",
  padding: "5px var(--space-3)",
  borderRadius: "var(--radius-sm)",
  border: `1px solid var(--border)`,
  zIndex: 30,
  maxWidth: "calc(100% - var(--space-6))",
};

const draftBannerTextStyle: React.CSSProperties = {
  color: "var(--text-muted)",
};

const draftBannerActionsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-1)",
};

const draftDiscardBtnStyle: React.CSSProperties = {
  fontSize: "var(--text-sm)",
  padding: "5px var(--space-3)",
  borderRadius: "var(--radius-sm)",
  border: `1px solid var(--border-input)`,
  background: "var(--bg-panel)",
  color: "var(--text-secondary)",
  cursor: "pointer",
};

const draftSaveBtnStyle: React.CSSProperties = {
  fontSize: "var(--text-sm)",
  padding: "5px var(--space-3)",
  borderRadius: "var(--radius-sm)",
  border: `1px solid var(--border-input)`,
  background: "var(--bg-active)",
  color: "var(--text-bright)",
  cursor: "pointer",
};
