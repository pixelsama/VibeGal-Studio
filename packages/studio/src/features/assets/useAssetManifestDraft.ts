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
import { isDraftSnapshotCurrent, preventUnloadWhenDirty } from "../script/unsavedChanges";
import { type ToastInput } from "../common/Toast";
import { useSaveShortcut } from "../common/useSaveShortcut";
import {
  discardDraftManifest,
  persistManifestWithFeedback,
  saveDraftManifest,
  stageManifestDraft,
  type StoredManifestDraft,
} from "./assetManifestOperations";

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

  const projectParsedManifest = useMemo(
    () => ManifestSchema.safeParse(project.content.manifest),
    [project.content.manifest],
  );
  const manifest: Manifest = draftManifest ?? (
    projectParsedManifest.success ? projectParsedManifest.data : EMPTY_MANIFEST
  );
  const manifestInvalid = !projectParsedManifest.success;

  function stageDraft(next: Manifest) {
    draftVersionRef.current += 1;
    stageManifestDraft(next, setDraftManifest);
  }

  function discardDraft() {
    draftVersionRef.current += 1;
    discardDraftManifest(setDraftManifest);
  }

  async function saveManifestQueued(projectPath: string, next: Manifest): Promise<FileRevision | null> {
    const nextRevision = await manifestMutationQueue.enqueue((expectedRevision) => (
      saveManifest(projectPath, next, expectedRevision)
    ));
    draftBaseRevisionRef.current = nextRevision;
    setDraftBaseVersion((version) => version + 1);
    return nextRevision;
  }

  async function saveDraft() {
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
      isDraftSnapshotCurrent: () => isDraftSnapshotCurrent(savedDraftVersion, draftVersionRef.current),
    });
  }

  useSaveShortcut(draftManifest !== null, () => void saveDraft());

  return {
    manifest,
    manifestInvalid,
    draftManifest,
    savingDraft,
    draftVersionRef,
    setDraftManifest,
    stageDraft,
    discardDraft,
    saveDraft,
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
