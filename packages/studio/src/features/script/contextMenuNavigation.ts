export interface MenuNavigationItem {
  disabled?: boolean;
}

export function enabledMenuIndices(items: readonly MenuNavigationItem[]): number[] {
  return items.flatMap((item, index) => item.disabled ? [] : [index]);
}

export function firstEnabledMenuIndex(items: readonly MenuNavigationItem[]): number {
  return enabledMenuIndices(items)[0] ?? -1;
}

export function moveMenuIndex(
  currentIndex: number,
  delta: 1 | -1,
  items: readonly MenuNavigationItem[],
): number {
  const enabled = enabledMenuIndices(items);
  if (enabled.length === 0) return -1;
  const currentPosition = enabled.indexOf(currentIndex);
  const nextPosition = currentPosition === -1
    ? 0
    : (currentPosition + delta + enabled.length) % enabled.length;
  return enabled[nextPosition];
}
