export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PROJECT_DRAFT_PREFIX = "vibegal.projectDraft.v1";

export function projectDraftStorageKey(projectPath: string, resourcePath: string): string {
  return `${PROJECT_DRAFT_PREFIX}:${encodeURIComponent(projectPath)}:${encodeURIComponent(resourcePath)}`;
}

export function getSessionDraftStorage(): DraftStorage | null {
  try {
    return typeof globalThis.sessionStorage === "undefined" ? null : globalThis.sessionStorage;
  } catch {
    return null;
  }
}

export function loadProjectDraft(storage: DraftStorage | null, key: string): unknown | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw == null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveProjectDraft(storage: DraftStorage | null, key: string, value: unknown): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Session storage can be unavailable or full; the in-memory draft remains usable.
  }
}

export function clearProjectDraft(storage: DraftStorage | null, key: string): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Storage cleanup is best-effort.
  }
}
