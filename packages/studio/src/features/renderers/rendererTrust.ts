import { loadAppSettings, updateAppSettings } from "../../lib/tauri";

export interface RendererTrustPersistence {
  load: () => Promise<Record<string, string>>;
  save: (trust: Record<string, string>) => Promise<void>;
}

const defaultPersistence: RendererTrustPersistence = {
  async load() {
    const settings = await loadAppSettings();
    return settings.rendererTrust ?? {};
  },
  async save(rendererTrust) {
    await updateAppSettings((settings) => ({ ...settings, rendererTrust }));
  },
};

let persistence = defaultPersistence;
let trustedFingerprints = new Map<string, string>();
let initialization: Promise<void> | null = null;
let persistenceQueue = Promise.resolve();
let persistenceGeneration = 0;

function normalizeProjectPath(projectPath: string): string {
  return projectPath.trim();
}

function trustKey(projectPath: string, rendererId: string): string {
  return JSON.stringify([normalizeProjectPath(projectPath), rendererId.trim()]);
}

function keyBelongsToProject(key: string, projectPath: string): boolean {
  try {
    const value = JSON.parse(key) as unknown;
    return Array.isArray(value) && value[0] === normalizeProjectPath(projectPath);
  } catch {
    return false;
  }
}

function trustSnapshot(): Record<string, string> {
  return Object.fromEntries([...trustedFingerprints].sort(([left], [right]) => left.localeCompare(right)));
}

function replaceTrust(trust: Record<string, string>): void {
  trustedFingerprints = new Map(
    Object.entries(trust).filter(([key, fingerprint]) => key.length > 0 && fingerprint.length > 0),
  );
}

function persistLatestTrust(): Promise<void> {
  const snapshot = trustSnapshot();
  const generation = persistenceGeneration;
  const operation = persistenceQueue.then(() => {
    if (generation !== persistenceGeneration) return;
    return persistence.save(snapshot);
  });
  persistenceQueue = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

export function configureRendererTrustPersistence(next: RendererTrustPersistence = defaultPersistence): void {
  persistenceGeneration += 1;
  persistence = next;
  trustedFingerprints.clear();
  initialization = null;
  persistenceQueue = Promise.resolve();
}

export function initializeRendererTrust(initialTrust?: Record<string, string>): Promise<void> {
  if (initialization) return initialization;
  if (initialTrust) {
    replaceTrust(initialTrust);
    initialization = Promise.resolve();
    return initialization;
  }
  const generation = persistenceGeneration;
  initialization = persistence.load()
    .then((trust) => {
      if (generation === persistenceGeneration) replaceTrust(trust);
    })
    .catch((error) => {
      if (generation !== persistenceGeneration) return;
      console.warn("加载界面风格信任状态失败:", error);
      trustedFingerprints.clear();
    });
  return initialization;
}

export function isProjectRendererTrusted(
  projectPath: string,
  rendererId: string,
  fingerprint: string,
): boolean {
  return initialization != null
    && fingerprint.length > 0
    && trustedFingerprints.get(trustKey(projectPath, rendererId)) === fingerprint;
}

export async function trustProjectRenderer(
  projectPath: string,
  rendererId: string,
  fingerprint: string,
): Promise<void> {
  await initializeRendererTrust();
  if (normalizeProjectPath(projectPath).length === 0 || rendererId.trim().length === 0 || fingerprint.length === 0) {
    return;
  }
  trustedFingerprints.set(trustKey(projectPath, rendererId), fingerprint);
  await persistLatestTrust();
}

export async function clearRendererTrust(projectPath?: string): Promise<void> {
  if (projectPath == null) {
    trustedFingerprints.clear();
    initialization = null;
    return;
  }
  await initializeRendererTrust();
  for (const key of trustedFingerprints.keys()) {
    if (keyBelongsToProject(key, projectPath)) trustedFingerprints.delete(key);
  }
  await persistLatestTrust();
}
