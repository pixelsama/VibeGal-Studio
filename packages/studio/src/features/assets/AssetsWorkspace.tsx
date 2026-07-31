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
import { useMemo, useState } from "react";
import { Inbox, Upload } from "lucide-react";
import { type ProjectData, type AssetEntry, type FileRevision, type Manifest } from "../../lib/types";
import {
  deleteAsset,
  importAsset,
  pickAssetFiles,
  pickOverviewAssetFiles,
} from "../../lib/tauri";
import { CollapsibleSidebar } from "../common/CollapsibleSidebar";
import { ConfirmDialog } from "../common/Dialogs";
import { EmptyState } from "../common/EmptyState";
import { Toast, type ToastInput, type ToastMessage } from "../common/Toast";
import { isDraftSnapshotCurrent } from "../script/unsavedChanges";
// 注：全局 StatusPanel 现挂载在 Workspace 根容器，资产页不再自带。
import { AssetsSidebar, type AssetSection } from "./AssetsSidebar";
import { planAssetDrop, isRegistrableSection, type RegistrableAssetKind } from "./assetDrop";
import { useAssetFileDrop } from "./useAssetFileDrop";
import { AssetsToolbar } from "./AssetsToolbar";
import { AssetGrid } from "./AssetGrid";
import { AssetCard, DanglingCard } from "./AssetCard";
import { analyzeAssetUsage } from "./assetUsage";
import { CharacterEditor } from "./CharacterEditor";
import { useAssets } from "./useAssets";
import { baseName } from "./assetPreview";
import {
  createAssetDeleteFailureToast,
  createImportFailureToast,
  createManifestSaveFailureToast,
} from "./assetManifestOperations";
import { useAssetManifestDraft } from "./useAssetManifestDraft";
import { useStudioI18n, type StudioTranslator } from "../../lib/i18n";
import { assetSectionLabel } from "./AssetsSidebar";

interface AssetsWorkspaceProps {
  project: ProjectData;
  refreshKey: number;
  initialSection?: AssetSection;
  sidebarCollapsed: boolean;
  onSidebarCollapsedChange: (collapsed: boolean) => void;
  onSaved: () => void | Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}

type ExtendedAssetSection = "cg" | "video" | "font" | "ui" | "animation";

function isExtendedAssetSection(section: AssetSection): section is ExtendedAssetSection {
  return section === "cg" || section === "video" || section === "font" || section === "ui" || section === "animation";
}

export function AssetsWorkspace({
  project,
  refreshKey,
  initialSection = "overview",
  sidebarCollapsed,
  onSidebarCollapsedChange,
  onSaved,
  onDirtyChange,
}: AssetsWorkspaceProps) {
  const { t } = useStudioI18n();
  const [section, setSection] = useState<AssetSection>(initialSection);
  const [search, setSearch] = useState("");
  const [confirm, setConfirm] = useState<{
    message: string;
    onConfirm: () => void;
    /** 默认回退到通用「确认」；破坏性删除由调用方传「删除」。 */
    confirmLabel?: string;
  } | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  function notify(input: ToastInput) {
    setToast({ id: Date.now(), ...input });
  }

  const {
    manifest,
    manifestInvalid,
    draftVersionRef,
    setDraftManifest,
    stageDraft: handleStageManifestDraft,
    saveManifestQueued,
    persistManifest,
  } = useAssetManifestDraft({ project, onSaved, onDirtyChange, notify });

  const readOnly = !canMutateAssets(manifestInvalid);

  const view = useAssets(project.path, refreshKey, manifest, project.assetReport);
  const assetUsage = useMemo(() => analyzeAssetUsage(manifest, project.nodes), [manifest, project.nodes]);

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
      missingManifestSources: view.dangling.map((entry) => entry.source),
      unregisteredDiskPaths: view.onDisk.filter((entry) => view.orphanPaths.has(entry.relPath)).map((entry) => entry.relPath),
    }),
    [assetUsage.unusedManifestPaths, manifest, view.dangling, view.onDisk, view.orphanPaths],
  );

  // 导入管线：导入按钮与文件拖放共用。
  // 逐个拷贝进 assets/<分类目录>/<原文件名>，成功的登记进 manifest，最后汇总 toast。
  async function importAssetFiles(
    items: { src: string; kind: RegistrableAssetKind }[],
    savedDraftVersion: number,
  ) {
    const errors: string[] = [];
    const newPaths: { id: string; path: string; kind: RegistrableAssetKind }[] = [];
    for (const { src, kind } of items) {
      const fileName = src.split(/[/\\]/).pop() ?? "asset";
      const id = baseName(fileName);
      const destRel = `assets/${kindDir(kind)}/${fileName}`;
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
      const failure = createManifestSaveFailureToast(manifestSaveError, t);
      notify({
        ...failure,
        detail: errors.length > 0
          ? t("assets.importManifestFailed", {
            detail: failure.detail ?? "",
            count: errors.length,
            errors: errors.join("\n"),
          })
          : failure.detail,
      });
    } else if (errors.length > 0) {
      notify(createImportFailureToast(errors, newPaths.length, t));
    } else if (newPaths.length > 0) {
      notify({ kind: "success", message: t("assets.importSuccess", { count: newPaths.length }) });
    }
    await onSaved();
  }

  function notifyDropPlan(plan: ReturnType<typeof planAssetDrop>) {
    if (plan.rejected.length > 0) {
      notify({
        kind: "info",
        message: t("assets.dropSkipped", { count: plan.rejected.length }),
        detail: plan.rejected.join("\n"),
      });
    }
  }

  async function handleImport() {
    if (readOnly) return;
    const files = section === "overview"
      ? await pickOverviewAssetFiles()
      : isRegistrableSection(section)
        ? await pickAssetFiles(section)
        : [];
    if (files.length === 0) return;
    const plan = planAssetDrop(files, section);
    notifyDropPlan(plan);
    if (plan.items.length === 0) return;
    await importAssetFiles(plan.items, draftVersionRef.current);
  }

  // 文件拖放导入：具体分类全部归入该分类，总览按扩展名推断（assetDrop.planAssetDrop）
  async function handleDropPaths(paths: string[]) {
    if (readOnly || paths.length === 0) return;
    const plan = planAssetDrop(paths, section);
    notifyDropPlan(plan);
    if (plan.items.length === 0) return;
    await importAssetFiles(plan.items, draftVersionRef.current);
  }

  // 角色编辑页不收文件拖放（立绘走 CharacterEditor 内部的导入按钮）
  const assetDragOver = useAssetFileDrop(!readOnly && section !== "character", handleDropPaths);
  const dropHint = isRegistrableSection(section)
    ? t("assets.dropSection", { section: assetSectionLabel(section, t) })
    : t("assets.dropOverview");

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
    const failureToast = createAssetDeleteFailureToast(result, relPath, t);
    if (failureToast) {
      notify(failureToast);
    }
    if (result.manifestSaved && isDraftSnapshotCurrent(savedDraftVersion, draftVersionRef.current)) {
      setDraftManifest(null);
    }
    await onSaved();
  }

  // 单条删除动磁盘 + 登记表（Spec 33 A1）：先确认再执行。
  // delete-orphans 已自带批量确认，内部直接调 handleDelete，不走这里以免重复弹窗。
  function handleDeleteConfirmed(relPath: string, assetRevision?: FileRevision) {
    if (readOnly) return;
    setConfirm({
      message: t("assets.deleteConfirm", { name: baseName(relPath) }),
      confirmLabel: t("assets.delete"),
      onConfirm: () => void handleDelete(relPath, assetRevision),
    });
  }

  function handleRegisterOrphan(entry: AssetEntry) {
    if (readOnly) return;
    void persistManifestFromWorkspace(registerOrphanAssets(manifest, [entry]));
  }

  function handleRemoveDanglingRef(source: string) {
    if (readOnly) return;
    // source 形如 "backgrounds.sky" / "audio.bgm.theme" / "characters.h.sprites.default"
    const next = removeManifestEntry(manifest, source);
    void persistManifestFromWorkspace(next);
  }

  async function handleRegisterAllOrphans() {
    if (readOnly) return;
    const candidates = filteredDisk.filter((entry) => view.orphanPaths.has(entry.relPath));
    if (candidates.length === 0) return;
    await persistManifestFromWorkspace(registerOrphanAssets(manifest, candidates));
  }

  function handleCleanupManifestEntries() {
    if (readOnly || cleanupProposal.removeSources.length === 0) return;
    setConfirm({
      message: t("assets.cleanupConfirm", {
        count: cleanupProposal.removeSources.length,
        preview: cleanupProposal.diffPreview.slice(0, 8).join("\n"),
      }),
      // 纯登记表清理，不碰磁盘文件——按钮文案不得出现「删除」（Spec 33 A2）。
      confirmLabel: t("assets.cleanupAction"),
      onConfirm: () => void persistManifestFromWorkspace(applyAssetCleanupProposal(manifest, cleanupProposal)),
    });
  }

  function handleDeleteAllOrphans() {
    if (readOnly) return;
    const candidates = filteredDisk.filter((entry) => view.orphanPaths.has(entry.relPath));
    if (candidates.length === 0) return;
    setConfirm({
      message: t("assets.deleteOrphansConfirm", { count: candidates.length }),
      confirmLabel: t("assets.delete"),
      onConfirm: async () => {
        for (const entry of candidates) {
          await handleDelete(entry.relPath, entry.revision);
        }
      },
    });
  }

  async function persistManifestFromWorkspace(next: Manifest) {
    if (readOnly) return;
    await persistManifest(next);
  }

  const totalShown = filteredDisk.length + filteredDangling.length;

  return (
    <div style={rootStyle}>
      <CollapsibleSidebar
        title={t("assets.title")}
        collapsed={sidebarCollapsed}
        onCollapsedChange={onSidebarCollapsedChange}
        expandedWidth={132}
        collapsedLabel={t("assets.title")}
      >
        <AssetsSidebar active={section} onSelect={setSection} />
      </CollapsibleSidebar>
      <div style={mainStyle}>
        {manifestInvalid && (
          <div style={invalidBannerStyle}>
            {t("assets.invalidManifest")}
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
              onDeleteOrphans={handleDeleteAllOrphans}
              disabled={readOnly}
              t={t}
            />
            {isExtendedAssetSection(section) && (
              <ExtendedAssetRegistryEditor
                section={section}
                manifest={manifest}
                disabled={readOnly}
                onChange={handleStageManifestDraft}
                t={t}
              />
            )}
            <div style={assetCountHelpStyle} role="note" aria-label={t("assets.countHelpLabel")}>
              {t("assets.countHelp")}
            </div>
            {cleanupProposal.removeSources.length > 0 && (
              <div style={cleanupBarStyle}>
                <span>{t("assets.cleanupPreview", {
                  removeCount: cleanupProposal.removeSources.length,
                  unregisteredCount: cleanupProposal.unregisteredDiskPaths.length,
                })}</span>
                <button type="button" style={cleanupButtonStyle} onClick={handleCleanupManifestEntries} disabled={readOnly}>
                  {t("assets.cleanupAction")}
                </button>
              </div>
            )}
            <div style={contentViewportStyle}>
              {totalShown === 0 ? (
                search.trim() ? (
                  <EmptyState
                    icon={Inbox}
                    title={t("assets.empty.searchTitle")}
                    description={t("assets.empty.searchDescription")}
                    action={(
                      <button type="button" className="gs-btn gs-btn--primary" onClick={() => setSearch("")}>
                        {t("assets.clearSearch")}
                      </button>
                    )}
                  />
                ) : (
                  <EmptyState
                    icon={Upload}
                    title={section === "overview"
                      ? t("assets.empty.overviewTitle")
                      : t("assets.empty.sectionTitle", { section: assetSectionLabel(section, t) })}
                    description={section === "overview"
                      ? t("assets.empty.overviewDescription")
                      : t("assets.empty.sectionDescription")}
                    action={!readOnly ? (
                      <button type="button" className="gs-btn gs-btn--primary" onClick={() => void handleImport()}>
                        {section === "overview"
                          ? t("assets.import")
                          : t("assets.importSection", { section: assetSectionLabel(section, t) })}
                      </button>
                    ) : undefined}
                  />
                )
              ) : (
                <AssetGrid emptyHint={t("assets.empty.searchTitle")}>
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
                      onDelete={handleDeleteConfirmed}
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
              )}
            </div>
          </>
        )}
      </div>

      {/* 文件拖放高亮遮罩（pointer-events: none，不拦截原生拖放事件） */}
      {assetDragOver && (
        <div className="gs-drop-overlay" aria-hidden="true">
          <div className="gs-drop-overlay-card">
            <Upload size={22} />
            <span>{dropHint}</span>
          </div>
        </div>
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />

      {confirm && (
        <ConfirmDialog
          message={confirm.message}
          danger
          confirmLabel={confirm.confirmLabel ?? t("common.confirm")}
          onConfirm={confirm.onConfirm}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

// ── manifest / 资产操作辅助（便于单测） ──

export { loadManifestDraft } from "./useAssetManifestDraft";
export {
  createAssetDeleteFailureToast,
  createImportFailureToast,
  createManifestSaveFailureToast,
  persistManifestWithFeedback,
  stageManifestDraft,
} from "./assetManifestOperations";
export type {
  PersistManifestWithFeedbackParams,
  StoredManifestDraft,
} from "./assetManifestOperations";

export function canMutateAssets(manifestInvalid: boolean): boolean {
  return !manifestInvalid;
}

function ExtendedAssetRegistryEditor({
  section,
  manifest,
  disabled,
  onChange,
  t,
}: {
  section: ExtendedAssetSection;
  manifest: Manifest;
  disabled: boolean;
  onChange: (manifest: Manifest) => void;
  t: StudioTranslator;
}) {
  if (section === "cg") {
    const entries = Object.entries(manifest.cg ?? {});
    return (
      <RegistryPanel title={t("assets.registry.cg")} empty={entries.length === 0} t={t}>
        {entries.map(([id, asset]) => (
          <RegistryCard key={id} id={id} onDelete={() => onChange(removeManifestEntry(manifest, `cg.${id}`))} disabled={disabled}>
            <RegistryTextField label="path" value={asset.path} disabled={disabled} onChange={(path) => {
              onChange({ ...manifest, cg: { ...(manifest.cg ?? {}), [id]: { ...asset, path } } });
            }} />
            <RegistryTextField label={t("assets.field.name")} value={asset.name ?? ""} disabled={disabled} onChange={(name) => {
              onChange({ ...manifest, cg: { ...(manifest.cg ?? {}), [id]: { ...asset, name: optionalText(name) } } });
            }} />
            <RegistryTextField label={t("assets.field.thumbnail")} value={asset.thumbnail ?? ""} disabled={disabled} onChange={(thumbnail) => {
              onChange({ ...manifest, cg: { ...(manifest.cg ?? {}), [id]: { ...asset, thumbnail: optionalText(thumbnail) } } });
            }} />
            <RegistryTextField label={t("assets.field.tags")} value={(asset.tags ?? []).join(", ")} disabled={disabled} onChange={(tags) => {
              onChange({ ...manifest, cg: { ...(manifest.cg ?? {}), [id]: { ...asset, tags: parseTags(tags) } } });
            }} />
            <RegistryTextField label={t("assets.field.group")} value={asset.group ?? ""} disabled={disabled} onChange={(group) => {
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
      <RegistryPanel title={t("assets.registry.video")} empty={entries.length === 0} t={t}>
        {entries.map(([id, asset]) => (
          <RegistryCard key={id} id={id} onDelete={() => onChange(removeManifestEntry(manifest, `videos.${id}`))} disabled={disabled}>
            <RegistryTextField label="path" value={asset.path} disabled={disabled} onChange={(path) => {
              onChange({ ...manifest, videos: { ...(manifest.videos ?? {}), [id]: { ...asset, path } } });
            }} />
            <RegistryTextField label={t("assets.field.name")} value={asset.name ?? ""} disabled={disabled} onChange={(name) => {
              onChange({ ...manifest, videos: { ...(manifest.videos ?? {}), [id]: { ...asset, name: optionalText(name) } } });
            }} />
            <RegistryTextField label="poster" value={asset.poster ?? ""} disabled={disabled} onChange={(poster) => {
              onChange({ ...manifest, videos: { ...(manifest.videos ?? {}), [id]: { ...asset, poster: optionalText(poster) } } });
            }} />
            <RegistryTextField label={t("assets.field.tags")} value={(asset.tags ?? []).join(", ")} disabled={disabled} onChange={(tags) => {
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
              {t("assets.field.skippable")}
            </label>
          </RegistryCard>
        ))}
      </RegistryPanel>
    );
  }

  if (section === "font") {
    const entries = Object.entries(manifest.fonts ?? {});
    return (
      <RegistryPanel title={t("assets.registry.font")} empty={entries.length === 0} t={t}>
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
      <RegistryPanel title={t("assets.registry.ui")} empty={entries.length === 0} t={t}>
        {entries.map(([id, skin]) => (
          <RegistryCard key={id} id={id} onDelete={() => onChange(removeUiSkin(manifest, id))} disabled={disabled}>
            <RegistryTextField label={t("assets.field.name")} value={skin.name ?? ""} disabled={disabled} onChange={(name) => {
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
              <div style={registryEmptyTextStyle}>{t("assets.emptySlots")}</div>
            )}
          </RegistryCard>
        ))}
      </RegistryPanel>
    );
  }

  const entries = Object.entries(manifest.animationAtlases ?? {});
  return (
    <RegistryPanel title={t("assets.registry.animation")} empty={entries.length === 0} t={t}>
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

function RegistryPanel({
  title,
  empty,
  children,
  t,
}: {
  title: string;
  empty: boolean;
  children: React.ReactNode;
  t: StudioTranslator;
}) {
  return (
    <section style={registryPanelStyle} aria-label={title}>
      <div style={registryPanelHeaderStyle}>
        <span style={registryPanelTitleStyle}>{title}</span>
        <span style={registryPanelHintStyle}>{t("assets.registryHint")}</span>
      </div>
      {empty ? (
        <EmptyState
          icon={Inbox}
          title={t("assets.registryEmpty")}
          description={t("assets.registryEmptyDescription")}
        />
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
  const { t } = useStudioI18n();
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
          {t("assets.removeRegistry")}
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
      isRegistrableSection(entry.kind))
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
    Object.entries(character.sprites ?? {}).forEach(([expr, sprite]) => {
      const path = typeof sprite === "string" ? sprite : sprite.fallback;
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

const contentViewportStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
};

const assetCountHelpStyle: React.CSSProperties = {
  padding: "6px 14px",
  borderBottom: "1px solid var(--border)",
  fontSize: "var(--text-xs)",
  color: "var(--text-muted)",
  background: "var(--bg-app)",
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

