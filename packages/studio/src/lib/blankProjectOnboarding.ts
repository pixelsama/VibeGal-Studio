import type { ProjectData } from "./types";

export const BLANK_PROJECT_ONBOARDING_STORAGE_PREFIX = "vibegal.blankProjectOnboarding.v1:";
export const BLANK_PROJECT_STARTER_TEXT = "新的故事从这里开始。";

export interface BlankProjectOnboardingStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export interface BlankProjectOnboardingRecord {
  version: 1;
  previewConfirmed: boolean;
  completed: boolean;
  skipped: boolean;
}

export const INITIAL_BLANK_PROJECT_ONBOARDING: BlankProjectOnboardingRecord = {
  version: 1,
  previewConfirmed: false,
  completed: false,
  skipped: false,
};

export function blankProjectOnboardingStorageKey(projectPath: string): string {
  return `${BLANK_PROJECT_ONBOARDING_STORAGE_PREFIX}${encodeURIComponent(projectPath)}`;
}

export function loadBlankProjectOnboarding(
  projectPath: string,
  storage = browserLocalStorage(),
): BlankProjectOnboardingRecord | null {
  if (!storage) return null;

  try {
    const raw = storage.getItem(blankProjectOnboardingStorageKey(projectPath));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    return isBlankProjectOnboardingRecord(value) ? value : null;
  } catch {
    return null;
  }
}

export function saveBlankProjectOnboarding(
  projectPath: string,
  record: BlankProjectOnboardingRecord,
  storage = browserLocalStorage(),
): BlankProjectOnboardingRecord {
  if (!storage) return record;

  try {
    storage.setItem(blankProjectOnboardingStorageKey(projectPath), JSON.stringify(record));
  } catch {
    // The guide is optional UI state; storage failure must never block opening the project.
  }
  return record;
}

export function hasWrittenBlankProjectEntry(
  project: Pick<ProjectData, "graph" | "nodes">,
): boolean {
  const entryNode = project.graph?.nodes.find((node) => node.id === project.graph?.entryNodeId);
  if (!entryNode) return false;
  const entry = project.nodes?.find((node) => normalizeNodePath(node.relPath) === normalizeNodePath(entryNode.file));
  if (!Array.isArray(entry?.data)) return false;
  return !isOriginalBlankStarter(entry.data);
}

export function hasImportedBackground(
  project: Pick<ProjectData, "content">,
): boolean {
  const backgrounds = project.content.manifest?.backgrounds;
  return Boolean(backgrounds && typeof backgrounds === "object" && Object.keys(backgrounds).length > 0);
}

export function isOriginalBlankStarter(instructions: unknown[]): boolean {
  if (instructions.length !== 1) return false;
  const instruction = instructions[0];
  if (!instruction || typeof instruction !== "object" || Array.isArray(instruction)) return false;

  const { id: _managedId, ...semantic } = instruction as Record<string, unknown>;
  return Object.keys(semantic).length === 2
    && semantic.t === "narrate"
    && semantic.text === BLANK_PROJECT_STARTER_TEXT;
}

function normalizeNodePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^content\//, "");
}

function browserLocalStorage(): BlankProjectOnboardingStorage | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

function isBlankProjectOnboardingRecord(value: unknown): value is BlankProjectOnboardingRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<BlankProjectOnboardingRecord>;
  return record.version === 1
    && typeof record.previewConfirmed === "boolean"
    && typeof record.completed === "boolean"
    && typeof record.skipped === "boolean";
}
