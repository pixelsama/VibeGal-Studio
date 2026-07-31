import { translateZhCN, type StudioTranslator } from "../../lib/i18n";
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

export interface PersistManifestWithFeedbackParams {
  projectPath: string;
  next: Manifest;
  saveManifestFn: (projectPath: string, manifest: Manifest, expectedRevision?: FileRevision | null) => Promise<FileRevision | null | void>;
  onSaved: () => void | Promise<void>;
  setDraftManifest: (manifest: Manifest | null) => void;
  notify: (toast: ToastInput) => void;
  expectedRevision?: FileRevision | null;
  t?: StudioTranslator;
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
  t = translateZhCN,
  isDraftSnapshotCurrent = () => true,
}: PersistManifestWithFeedbackParams): Promise<void> {
  try {
    await saveManifestFn(projectPath, next, expectedRevision);
    if (isDraftSnapshotCurrent()) setDraftManifest(null);
    await onSaved();
  } catch (error) {
    if (isDraftSnapshotCurrent()) setDraftManifest(next);
    notify(createManifestSaveFailureToast(error, t));
  }
}

export function createManifestSaveFailureToast(
  error: unknown,
  t: StudioTranslator = translateZhCN,
): ToastInput {
  return {
    kind: "error",
    message: t("assets.manifestSaveFailed"),
    detail: t("assets.manifestSaveFailedDetail", {
      error: formatUnknownError(error),
    }),
  };
}

export function createImportFailureToast(
  errors: string[],
  importedCount: number,
  t: StudioTranslator = translateZhCN,
): ToastInput {
  const failureCount = errors.length;
  return {
    kind: "error",
    message: importedCount > 0
      ? t("assets.importPartialFailed", {
        imported: importedCount,
        failed: failureCount,
      })
      : t("assets.importAllFailed", { failed: failureCount }),
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
  t: StudioTranslator = translateZhCN,
): ToastInput | null {
  const error = formatUnknownError(result.error);

  if (!result.deleted && result.manifestSaved) {
    return {
      kind: "error",
      message: t("assets.deleteFileAfterPruneFailed"),
      detail: t("assets.deleteFileAfterPruneFailedDetail", {
        path: relPath,
        error,
      }),
    };
  }

  if (!result.deleted && result.manifestSaveFailed) {
    return {
      kind: "error",
      message: t("assets.deleteManifestBeforeFileFailed"),
      detail: t("assets.deleteManifestBeforeFileFailedDetail", {
        path: relPath,
        error,
      }),
    };
  }

  if (!result.deleted) {
    return {
      kind: "error",
      message: t("assets.deleteFileFailed"),
      detail: `${relPath}\n${error}`,
    };
  }

  if (result.manifestSaveFailed) {
    return {
      kind: "error",
      message: t("assets.deleteManifestAfterFileFailed"),
      detail: t("assets.deleteManifestAfterFileFailedDetail", {
        path: relPath,
        error,
      }),
    };
  }

  return null;
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
