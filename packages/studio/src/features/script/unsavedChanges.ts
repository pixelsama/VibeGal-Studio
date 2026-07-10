export interface SaveShortcutLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
}

export interface BeforeUnloadLike {
  preventDefault(): void;
  returnValue: string | undefined;
}

export function isSaveKeyboardShortcut(event: SaveShortcutLike): boolean {
  return event.key.toLowerCase() === "s" && (event.metaKey || event.ctrlKey);
}

export function isDraftSnapshotCurrent(savedVersion: number, currentVersion: number): boolean {
  return savedVersion === currentVersion;
}

export function preventUnloadWhenDirty(event: BeforeUnloadLike, dirty: boolean): boolean {
  if (!dirty) return false;
  event.preventDefault();
  event.returnValue = "";
  return true;
}

export function confirmUnsavedNavigation(
  dirty: boolean,
  confirm: (message: string) => boolean,
): boolean {
  if (!dirty) return true;
  return confirm("当前节点有未保存的改动。确定放弃草稿并离开吗？");
}
