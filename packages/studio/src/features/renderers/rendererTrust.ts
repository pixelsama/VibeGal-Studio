const trustedProjectPaths = new Set<string>();

function trustKey(projectPath: string): string {
  return projectPath.trim();
}

export function isProjectRendererTrusted(projectPath: string): boolean {
  const key = trustKey(projectPath);
  return key.length > 0 && trustedProjectPaths.has(key);
}

export function trustProjectRenderer(projectPath: string): void {
  const key = trustKey(projectPath);
  if (key.length > 0) trustedProjectPaths.add(key);
}

export function clearRendererTrust(projectPath?: string): void {
  if (projectPath == null) {
    trustedProjectPaths.clear();
    return;
  }
  trustedProjectPaths.delete(trustKey(projectPath));
}
