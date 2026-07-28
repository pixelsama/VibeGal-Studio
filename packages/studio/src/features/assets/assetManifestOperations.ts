import type { FileRevision, Manifest } from "../../lib/types";
import type { ToastInput } from "../common/Toast";

export interface StoredManifestDraft {
  version: 1;
  manifest: Manifest;
  baseRevision?: FileRevision | null;
}

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
    message: "保存资源登记表失败",
    detail: `${formatUnknownError(error)}。当前草稿已保留。`,
  };
}

export function createImportFailureToast(errors: string[], importedCount: number): ToastInput {
  const failureCount = errors.length;
  return {
    kind: "error",
    message: importedCount > 0
      ? `已导入 ${importedCount} 个资源，${failureCount} 个失败`
      : `导入失败：${failureCount} 个资源失败`,
    detail: errors.join("\n"),
  };
}

export interface DeleteAssetAndPruneManifestRefsResult {
  deleted: boolean;
  manifestSaved: boolean;
  manifestSaveFailed: boolean;
  error?: unknown;
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
      message: "资源登记表更新失败，未删除资产",
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
      message: "资产已删除，但资源登记表更新失败",
      detail: `${relPath}\n${formatUnknownError(result.error)}。请刷新项目后检查悬空引用。`,
    };
  }

  return null;
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
