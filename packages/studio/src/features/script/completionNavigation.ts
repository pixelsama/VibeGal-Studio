/** Keep a completion selection inside a candidate list, including after a filter yields no rows. */
export function clampCompletionIndex(index: number, itemCount: number): number {
  if (itemCount <= 0 || !Number.isFinite(index)) return 0;
  return Math.min(Math.max(Math.trunc(index), 0), itemCount - 1);
}

export function moveCompletionIndex(index: number, delta: 1 | -1, itemCount: number): number {
  if (itemCount <= 0) return 0;
  const current = clampCompletionIndex(index, itemCount);
  return (current + delta + itemCount) % itemCount;
}

/**
 * Cursor synchronization should only reset completion selection when the
 * completion context changes. Keyboard navigation itself also causes a
 * cursor-sync event, so resetting unconditionally would undo the selection.
 */
export function completionIndexAfterContextSync({
  currentIndex,
  previousContext,
  nextContext,
  itemCount,
}: {
  currentIndex: number;
  previousContext: string | null;
  nextContext: string | null;
  itemCount: number;
}): number {
  if (previousContext == null || nextContext == null || previousContext !== nextContext) return 0;
  return clampCompletionIndex(currentIndex, itemCount);
}
