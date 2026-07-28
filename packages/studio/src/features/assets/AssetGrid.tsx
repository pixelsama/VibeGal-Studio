/**
 * AssetGrid —— 可访问的窗口化资产网格。
 *
 * 过滤和搜索在父组件对完整数据集执行；这里只限制实际挂载的卡片数量，
 * 避免大项目首屏同时解码数百张图片。滚动时保留少量 overscan。
 */
import { Children, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, UIEvent } from "react";
import { useStudioI18n } from "../../lib/i18n";

interface AssetGridProps {
  children: ReactNode;
  emptyHint: string;
}

const CARD_WIDTH = 168;
const CARD_HEIGHT = 220;
const GAP = 14;
const PADDING = 16;
const OVERSCAN_ROWS = 2;

export interface AssetGridWindow {
  columns: number;
  start: number;
  end: number;
  totalHeight: number;
}

export function assetGridWindow(
  count: number,
  width: number,
  height: number,
  scrollTop: number,
): AssetGridWindow {
  const availableWidth = Math.max(CARD_WIDTH, width - PADDING * 2);
  const columns = Math.max(1, Math.floor((availableWidth + GAP) / (CARD_WIDTH + GAP)));
  const rowHeight = CARD_HEIGHT + GAP;
  const rowCount = Math.ceil(count / columns);
  const firstRow = Math.max(0, Math.floor(Math.max(0, scrollTop - PADDING) / rowHeight) - OVERSCAN_ROWS);
  const lastRow = Math.min(
    rowCount,
    Math.ceil((Math.max(0, scrollTop) + Math.max(height, CARD_HEIGHT)) / rowHeight) + OVERSCAN_ROWS,
  );
  return {
    columns,
    start: Math.min(count, firstRow * columns),
    end: Math.min(count, lastRow * columns),
    totalHeight: PADDING * 2 + Math.max(0, rowCount * rowHeight - GAP),
  };
}

export function AssetGrid({ children, emptyHint }: AssetGridProps) {
  const { t } = useStudioI18n();
  const items = useMemo(() => Children.toArray(children), [children]);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ width: 900, height: 640, scrollTop: 0 });

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const updateSize = () => setViewport((current) => ({
      ...current,
      width: shell.clientWidth || current.width,
      height: shell.clientHeight || current.height,
    }));
    updateSize();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateSize);
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  if (items.length === 0) {
    return <div style={emptyStyle}>{emptyHint}</div>;
  }

  const window = assetGridWindow(items.length, viewport.width, viewport.height, viewport.scrollTop);
  const visible = items.slice(window.start, window.end);

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const scrollTop = event.currentTarget.scrollTop;
    setViewport((current) => current.scrollTop === scrollTop ? current : { ...current, scrollTop });
  };

  return (
    <div
      ref={shellRef}
      role="grid"
      aria-label={t("assets.list")}
      aria-rowcount={Math.ceil(items.length / window.columns)}
      aria-colcount={window.columns}
      style={shellStyle}
      onScroll={handleScroll}
    >
      <div style={{ ...gridStyle, height: window.totalHeight }}>
        {visible.map((child, visibleIndex) => {
          const index = window.start + visibleIndex;
          const row = Math.floor(index / window.columns);
          const column = index % window.columns;
          return (
            <div
              key={(child as { key?: string | null }).key ?? index}
              role="gridcell"
              aria-rowindex={row + 1}
              aria-colindex={column + 1}
              style={{
                ...cellStyle,
                left: PADDING + column * (CARD_WIDTH + GAP),
                top: PADDING + row * (CARD_HEIGHT + GAP),
              }}
            >
              {child}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const shellStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  overflow: "auto",
  position: "relative",
};

const gridStyle: React.CSSProperties = {
  position: "relative",
  minWidth: "100%",
};

const cellStyle: React.CSSProperties = {
  position: "absolute",
  width: CARD_WIDTH,
  minHeight: CARD_HEIGHT,
};

const emptyStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "100%",
  height: "100%",
  color: "var(--text-muted)",
  fontSize: "var(--text-base)",
};
