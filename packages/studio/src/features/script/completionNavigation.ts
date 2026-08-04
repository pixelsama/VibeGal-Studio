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
