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
import { ManifestSchema } from "@galstudio/engine";
import { EMPTY_MANIFEST, type ProjectData, type AssetEntry, type FileRevision, type Manifest } from "../../lib/types";
import {
  deleteAsset,
  importAsset,
  pickAssetFiles,
  saveManifest,
} from "../../lib/tauri";
import { CollapsibleSidebar } from "../common/CollapsibleSidebar";
import { ConfirmDialog } from "../common/Dialogs";
import { Toast, type ToastInput, type ToastMessage } from "../common/Toast";
// 注：全局 StatusPanel 现挂载在 Workspace 根容器，资产页不再自带。
import { AssetsSidebar, type AssetSection } from "./AssetsSidebar";
import { AssetsToolbar } from "./AssetsToolbar";
import { AssetGrid } from "./AssetGrid";
import { AssetCard, DanglingCard } from "./AssetCard";
import { CharacterEditor } from "./CharacterEditor";
import { useAssets } from "./useAssets";
import { baseName } from "./assetPreview";

interface AssetsWorkspaceProps {
  project: ProjectData;
  refreshKey: number;
  sidebarCollapsed: boolean;
  onSidebarCollapsedChange: (collapsed: boolean) => void;
  onSaved: () => void | Promise<void>;
}

export function AssetsWorkspace({
  project,
  refreshKey,
  sidebarCollapsed,
  onSidebarCollapsedChange,
  onSaved,
}: AssetsWorkspaceProps) {
  const [section, setSection] = useState<AssetSection>("overview");
  const [search, setSearch] = useState("");
  const [draftManifest, setDraftManifest] = useState<Manifest | null>(null);
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);

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

  function notify(input: ToastInput) {
    setToast({ id: Date.now(), ...input });
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

  async function handleImport() {
    if (readOnly) return;
    const kind = section === "overview" ? "background" : section;
    if (kind === "character" || kind === "unknown") return;
    const files = await pickAssetFiles(kind as "background" | "bgm" | "sfx" | "voice");
    if (files.length === 0) return;

    // 逐个导入；目标路径 = assets/<分类目录>/<原文件名>
    const subDir = kindDir(kind);
    const errors: string[] = [];
    const newPaths: { id: string; path: string; kind: typeof kind }[] = [];
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
        await saveManifest(project.path, next, project.manifestRevision);
        setDraftManifest(null);
      } catch (e) {
        manifestSaveError = e;
        setDraftManifest(next);
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
      saveManifestFn: saveManifest,
    });
    const failureToast = createAssetDeleteFailureToast(result, relPath);
    if (failureToast) {
      notify(failureToast);
    }
    if (result.manifestSaved) {
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
    await persistManifestWithFeedback({
      projectPath: project.path,
      next,
      expectedRevision: project.manifestRevision,
      saveManifestFn: saveManifest,
      onSaved,
      setDraftManifest,
      notify,
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
            onChange={(m) => void persistManifest(m)}
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
            <div style={scrollStyle}>
              <AssetGrid emptyHint="没有匹配的资源">
                {filteredDisk.map((entry) => (
                  <AssetCard
                    key={entry.relPath}
                    entry={entry}
                    projectPath={project.path}
                    isOrphan={view.orphanPaths.has(entry.relPath)}
                    refCount={refCountByPath.get(entry.relPath) ?? 0}
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
        canSave={!readOnly && !manifestInvalid}
        onSave={() => void saveDraftManifest({
          projectPath: project.path,
          draftManifest,
          expectedRevision: project.manifestRevision,
          saveManifestFn: saveManifest,
          onSaved,
          setDraftManifest,
          notify,
        })}
        onDiscard={() => discardDraftManifest(setDraftManifest)}
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

export interface SaveDraftManifestParams {
  projectPath: string;
  draftManifest: Manifest | null;
  expectedRevision?: FileRevision | null;
  saveManifestFn: (projectPath: string, manifest: Manifest, expectedRevision?: FileRevision | null) => Promise<void>;
  onSaved: () => void | Promise<void>;
  setDraftManifest: (manifest: Manifest | null) => void;
  notify: (toast: ToastInput) => void;
}

export async function saveDraftManifest({
  projectPath,
  draftManifest,
  expectedRevision,
  saveManifestFn,
  onSaved,
  setDraftManifest,
  notify,
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
  });
}

export function discardDraftManifest(setDraftManifest: (manifest: Manifest | null) => void): void {
  setDraftManifest(null);
}

export interface PersistManifestWithFeedbackParams {
  projectPath: string;
  next: Manifest;
  saveManifestFn: (projectPath: string, manifest: Manifest, expectedRevision?: FileRevision | null) => Promise<void>;
  onSaved: () => void | Promise<void>;
  setDraftManifest: (manifest: Manifest | null) => void;
  notify: (toast: ToastInput) => void;
  expectedRevision?: FileRevision | null;
}

export async function persistManifestWithFeedback({
  projectPath,
  next,
  expectedRevision,
  saveManifestFn,
  onSaved,
  setDraftManifest,
  notify,
}: PersistManifestWithFeedbackParams): Promise<void> {
  try {
    await saveManifestFn(projectPath, next, expectedRevision);
    setDraftManifest(null);
    await onSaved();
  } catch (error) {
    setDraftManifest(next);
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
}

export function DraftManifestBanner({ isDirty, canSave, onSave, onDiscard }: DraftManifestBannerProps) {
  if (!isDirty) return null;
  return (
    <div style={draftBannerStyle}>
      <div style={draftBannerTextStyle}>有未保存的改动…</div>
      <div style={draftBannerActionsStyle}>
        <button type="button" style={draftDiscardBtnStyle} onClick={onDiscard}>
          放弃改动
        </button>
        {canSave && (
          <button type="button" style={draftSaveBtnStyle} onClick={onSave}>
            保存改动
          </button>
        )}
      </div>
    </div>
  );
}

export interface DeleteAssetAndPruneManifestRefsParams {
  projectPath: string;
  relPath: string;
  manifest: Manifest;
  refCountByPath: Map<string, number>;
  deleteAssetFn: (projectPath: string, relPath: string, expectedRevision?: FileRevision | null) => Promise<void>;
  saveManifestFn: (projectPath: string, manifest: Manifest, expectedRevision?: FileRevision | null) => Promise<void>;
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

  try {
    await deleteAssetFn(projectPath, relPath, assetRevision);
  } catch (error) {
    return { deleted: false, manifestSaved: false, manifestSaveFailed: false, error };
  }

  if (refs === 0) {
    return { deleted: true, manifestSaved: false, manifestSaveFailed: false };
  }

  try {
    await saveManifestFn(projectPath, nextManifest, manifestRevision);
    return { deleted: true, manifestSaved: true, manifestSaveFailed: false };
  } catch (error) {
    return { deleted: true, manifestSaved: false, manifestSaveFailed: true, error };
  }
}

/** 按 kind 决定导入目标子目录（与 Rust AssetKind::from_rel_path 对齐）。 */
function kindDir(kind: "background" | "bgm" | "sfx" | "voice"): string {
  switch (kind) {
    case "background":
      return "backgrounds";
    case "bgm":
      return "audio/bgm";
    case "sfx":
      return "audio/sfx";
    case "voice":
      return "audio/voice";
  }
}

/** 把一批 (id, path, kind) 登记进 manifest。同 id 已存在则跳过。 */
export function applyAssetRegistrations(
  manifest: Manifest,
  registrations: { id: string; path: string; kind: "background" | "bgm" | "sfx" | "voice" }[],
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
    }
  }
  return next;
}

export function registerOrphanAssets(manifest: Manifest, entries: AssetEntry[]): Manifest {
  const registrations = entries
    .filter((entry): entry is AssetEntry & { kind: "background" | "bgm" | "sfx" | "voice" } =>
      entry.kind === "background" || entry.kind === "bgm" || entry.kind === "sfx" || entry.kind === "voice")
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
  return manifest;
}

export function removeDanglingRefs(manifest: Manifest, sources: string[]): Manifest {
  return sources.reduce((next, source) => removeManifestEntry(next, source), manifest);
}

/** 统计每个磁盘路径被多少 manifest 条目引用。 */
export function countRefs(manifest: Manifest): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (path: string) => counts.set(path, (counts.get(path) ?? 0) + 1);
  Object.values(manifest.backgrounds).forEach(bump);
  Object.values(manifest.characters).forEach((c) => Object.values(c.sprites).forEach(bump));
  Object.values(manifest.audio.bgm).forEach(bump);
  Object.values(manifest.audio.sfx).forEach(bump);
  Object.values(manifest.audio.voice).forEach(bump);
  return counts;
}

/**
 * 移除 manifest 中所有指向给定磁盘路径的引用。
 * 用于删除资产文件时同步清理引用，避免悬空。
 * 不可变，返回新 manifest。
 */
export function removeAllRefsToPath(manifest: Manifest, path: string): Manifest {
  const target = path.replace(/\\/g, "/");
  const match = (p: string) => p.replace(/\\/g, "/") === target;

  // backgrounds
  const backgrounds: Record<string, string> = {};
  for (const [id, p] of Object.entries(manifest.backgrounds)) {
    if (!match(p)) backgrounds[id] = p;
  }

  // characters.<id>.sprites.<expr>
  const characters: typeof manifest.characters = {};
  for (const [id, char] of Object.entries(manifest.characters)) {
    const sprites: Record<string, string> = {};
    for (const [expr, p] of Object.entries(char.sprites)) {
      if (!match(p)) sprites[expr] = p;
    }
    characters[id] = { ...char, sprites };
  }

  // audio 子表
  const stripAudio = (table: Record<string, string>): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [id, p] of Object.entries(table)) {
      if (!match(p)) out[id] = p;
    }
    return out;
  };

  return {
    backgrounds,
    characters,
    audio: {
      bgm: stripAudio(manifest.audio.bgm),
      sfx: stripAudio(manifest.audio.sfx),
      voice: stripAudio(manifest.audio.voice),
    },
  };
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

const invalidBannerStyle: React.CSSProperties = {
  padding: "8px 14px",
  fontSize: 12,
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
  gap: 8,
  fontSize: 11,
  color: "var(--text-muted)",
  background: "var(--bg-app)",
  padding: "5px 10px",
  borderRadius: 6,
  border: `1px solid var(--border)`,
  zIndex: 30,
  maxWidth: "calc(100% - 24px)",
};

const draftBannerTextStyle: React.CSSProperties = {
  color: "var(--text-muted)",
};

const draftBannerActionsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
};

const draftDiscardBtnStyle: React.CSSProperties = {
  fontSize: 12,
  padding: "5px 10px",
  borderRadius: 6,
  border: `1px solid var(--border-input)`,
  background: "var(--bg-panel)",
  color: "var(--text-secondary)",
  cursor: "pointer",
};

const draftSaveBtnStyle: React.CSSProperties = {
  fontSize: 12,
  padding: "5px 12px",
  borderRadius: 6,
  border: `1px solid var(--border-input)`,
  background: "var(--bg-active)",
  color: "var(--text-bright)",
  cursor: "pointer",
};
