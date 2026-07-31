import { useEffect, useMemo, useRef, useState } from "react";
import { ManifestSchema } from "@vibegal/engine";
import { EMPTY_MANIFEST, type FileRevision, type Manifest, type ProjectData } from "../../lib/types";
import { saveManifest } from "../../lib/tauri";
import { RevisionedProjectMutationQueue } from "../../lib/projectMutation";
import {
  clearProjectDraft,
  getSessionDraftStorage,
  loadProjectDraft,
  projectDraftStorageKey,
  saveProjectDraft,
  type DraftStorage,
} from "../../lib/draftRecovery";
import { isDraftSnapshotCurrent } from "../script/unsavedChanges";
import { type ToastInput } from "../common/Toast";
import { useDebouncedCallback } from "../common/useDebouncedCallback";
import { usePageUndoHistory } from "../common/usePageUndoHistory";
import { useSaveShortcut } from "../common/useSaveShortcut";
import { useStudioI18n } from "../../lib/i18n";
import {
  persistManifestWithFeedback,
  stageManifestDraft,
  type StoredManifestDraft,
} from "./assetManifestOperations";

/** 登记表自动落盘防抖：连续操作合并为一次原子写盘（Spec 33 §6.1）。 */
export const MANIFEST_SAVE_DEBOUNCE_MS = 800;

interface UseAssetManifestDraftOptions {
  project: ProjectData;
  onSaved: () => void | Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  notify: (toast: ToastInput) => void;
}

export function useAssetManifestDraft({
  project,
  onSaved,
  onDirtyChange,
  notify,
}: UseAssetManifestDraftOptions) {
  const { t } = useStudioI18n();
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
  const [draftBaseVersion, setDraftBaseVersion] = useState(0);
  const draftVersionRef = useRef(0);
  const draftBaseRevisionRef = useRef<FileRevision | null | undefined>(
    restoredManifestDraft?.baseRevision ?? project.manifestRevision,
  );
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
    // 卸载时落盘最后一次 pending（自动保存语义：改什么就是什么），
    // 不再用 beforeunload 拦截——防抖窗口由 hook 的卸载 flush 兜底。
    onDirtyChange?.(false);
  }, [onDirtyChange]);

  const projectParsedManifest = useMemo(
    () => ManifestSchema.safeParse(project.content.manifest),
    [project.content.manifest],
  );
  const manifest: Manifest = draftManifest ?? (
    projectParsedManifest.success ? projectParsedManifest.data : EMPTY_MANIFEST
  );
  const manifestInvalid = !projectParsedManifest.success;

  // 自动保存：stageDraft 后防抖落盘，连续操作合并为一次原子写盘（Spec 33 §6.1）。
  const autoSave = useDebouncedCallback((next: Manifest) => {
    void persistManifest(next);
  }, MANIFEST_SAVE_DEBOUNCE_MS);

  // cmd+z 恢复整页快照（页面级撤销，接管 input 原生撤销）。
  const applySnapshot = (snapshot: Manifest) => {
    draftVersionRef.current += 1;
    setDraftManifest(snapshot);
    autoSave.schedule(snapshot);
  };
  const undoHistory = usePageUndoHistory<Manifest>({
    current: () => manifest,
    apply: applySnapshot,
  });

  // 外部改动（Agent/其他工具写盘）到达：取消待落盘草稿并清空撤销栈，
  // 防抖不得把旧草稿写盘覆盖外部改动。revision 冲突保护仍由队列承担。
  useEffect(() => {
    if (draftBaseRevisionRef.current === undefined || draftBaseRevisionRef.current === project.manifestRevision) return;
    autoSave.cancel();
    undoHistory.reset();
  }, [project.manifestRevision, autoSave.cancel, undoHistory.reset]);

  function stageDraft(next: Manifest) {
    undoHistory.record(manifest);
    draftVersionRef.current += 1;
    stageManifestDraft(next, setDraftManifest);
    autoSave.schedule(next);
  }

  async function saveManifestQueued(projectPath: string, next: Manifest): Promise<FileRevision | null> {
    const nextRevision = await manifestMutationQueue.enqueue((expectedRevision) => (
      saveManifest(projectPath, next, expectedRevision)
    ));
    draftBaseRevisionRef.current = nextRevision;
    setDraftBaseVersion((version) => version + 1);
    return nextRevision;
  }

  async function persistManifest(next: Manifest) {
    const savedDraftVersion = draftVersionRef.current;
    await persistManifestWithFeedback({
      projectPath: project.path,
      next,
      expectedRevision: project.manifestRevision,
      saveManifestFn: saveManifestQueued,
      onSaved,
      setDraftManifest,
      notify,
      t,
      isDraftSnapshotCurrent: () => isDraftSnapshotCurrent(savedDraftVersion, draftVersionRef.current),
    });
  }

  // Cmd+S = 立即落盘（跳过防抖窗口）。
  useSaveShortcut(draftManifest !== null, () => {
    autoSave.flush();
  });

  return {
    manifest,
    manifestInvalid,
    draftManifest,
    draftVersionRef,
    setDraftManifest,
    stageDraft,
    saveManifestQueued,
    persistManifest,
  };
}

export function loadManifestDraft(storage: DraftStorage | null, key: string): StoredManifestDraft | null {
  const value = loadProjectDraft(storage, key);
  if (!value || typeof value !== "object") return null;
  const draft = value as Partial<StoredManifestDraft>;
  if (draft.version !== 1) return null;
  const parsed = ManifestSchema.safeParse(draft.manifest);
  return parsed.success ? { ...draft, manifest: parsed.data } as StoredManifestDraft : null;
}
