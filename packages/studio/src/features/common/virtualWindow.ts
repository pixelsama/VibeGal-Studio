export interface FixedListWindow {
  start: number;
  end: number;
  paddingTop: number;
  paddingBottom: number;
}

export function fixedListWindow(
  count: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan = 4,
): FixedListWindow {
  if (count <= 0) return { start: 0, end: 0, paddingTop: 0, paddingBottom: 0 };
  const safeRowHeight = Math.max(1, rowHeight);
  const start = Math.max(0, Math.floor(Math.max(0, scrollTop) / safeRowHeight) - overscan);
  const visibleRows = Math.ceil(Math.max(viewportHeight, safeRowHeight) / safeRowHeight);
  const end = Math.min(count, start + visibleRows + overscan * 2);
  return {
    start,
    end,
    paddingTop: start * safeRowHeight,
    paddingBottom: Math.max(0, (count - end) * safeRowHeight),
  };
}
