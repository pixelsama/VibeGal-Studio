import { useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

/**
 * 沉底折叠面板：标题栏在内容上方。折叠时内容向下沉落、标题栏随面板
 * 一起落到父区域底边（"重力"感）；展开时标题栏升起、内容在其下方展开。
 * 折叠后只剩一条标题栏贴在底边，上方区域自动吃掉让出的空间。
 */
export function BottomSheet({
  title,
  expandedHeight,
  defaultExpanded = true,
  children,
}: {
  title: string;
  /** 展开时整块面板（含标题栏）的高度，CSS 长度，可含 %（相对父容器高度）。 */
  expandedHeight: string;
  defaultExpanded?: boolean;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <div
      data-region="bottom-sheet"
      data-sheet-state={expanded ? "expanded" : "collapsed"}
      style={{
        ...sheetStyle,
        height: expanded ? expandedHeight : BOTTOM_SHEET_BAR_HEIGHT,
      }}
    >
      <button
        type="button"
        className="gs-bottom-sheet-bar"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        style={barStyle}
      >
        <span>{title}</span>
        {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </button>
      <div
        data-region="bottom-sheet-body"
        style={{
          ...sheetBodyStyle,
          visibility: expanded ? "visible" : "hidden",
          // 折叠时等内容沉到底再隐藏，展开时立即显示
          transition: expanded ? "visibility 0s" : "visibility 0s linear 200ms",
        }}
        aria-hidden={!expanded || undefined}
      >
        {children}
      </div>
    </div>
  );
}

const BOTTOM_SHEET_BAR_HEIGHT = 33;

const sheetStyle: CSSProperties = {
  flex: "0 0 auto",
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  minHeight: 0,
  overflow: "hidden",
  transition: "height 200ms ease",
};

const sheetBodyStyle: CSSProperties = {
  flex: "1 1 0",
  minHeight: 0,
  overflow: "hidden",
};

const barStyle: CSSProperties = {
  flex: "0 0 auto",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--space-2)",
  width: "100%",
  height: BOTTOM_SHEET_BAR_HEIGHT,
  padding: "0 var(--space-3)",
  border: "none",
  borderBottom: "1px solid var(--border)",
  fontFamily: "inherit",
  fontSize: "var(--text-sm)",
  fontWeight: 600,
  textAlign: "left",
  cursor: "pointer",
};
