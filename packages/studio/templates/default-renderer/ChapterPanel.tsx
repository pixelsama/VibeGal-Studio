import type { ChapterEntry } from "@vibegal/engine";
import {
  emptyStateStyle,
  emptyTitleStyle,
  itemMetaStyle,
  itemTitleStyle,
  primaryPillButton,
} from "./uiTheme";
import type { CSSProperties } from "react";

interface ChapterPanelProps {
  chapters: ChapterEntry[];
  busy: boolean;
  onStartChapter: (chapterId: string) => void;
}

export function ChapterPanel({ chapters, busy, onStartChapter }: ChapterPanelProps) {
  if (chapters.length === 0) {
    return (
      <div style={emptyStateStyle}>
        <strong style={emptyTitleStyle}>暂无可跳读章节</strong>
        <span>到达新章节后会在这里解锁。</span>
      </div>
    );
  }

  return (
    <div style={listStyle}>
      {chapters.map((chapter) => (
        <article key={chapter.id} data-chapter-entry={chapter.id} style={rowStyle}>
          <div style={copyStyle}>
            <strong style={itemTitleStyle}>{chapter.title}</strong>
            <span style={itemMetaStyle}>
              {chapter.isProjectEntry ? "故事开头" : chapter.safe ? "已登记安全起点" : "缺少安全起点"}
            </span>
          </div>
          <button
            type="button"
            data-chapter-action="start"
            disabled={busy || !chapter.safe}
            onClick={() => onStartChapter(chapter.id)}
            style={primaryPillButton}
          >
            从此章开始
          </button>
        </article>
      ))}
    </div>
  );
}

const listStyle: CSSProperties = {
  display: "grid",
  gap: 12,
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 20,
  padding: "16px 18px",
  border: "1px solid rgba(255, 255, 255, 0.12)",
  borderRadius: 12,
  background: "rgba(255, 255, 255, 0.05)",
};

const copyStyle: CSSProperties = {
  display: "grid",
  gap: 6,
};
