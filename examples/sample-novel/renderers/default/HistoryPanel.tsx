import type { CSSProperties } from "react";
import type { BacklogEntry } from "@vibegal/engine";
import {
  cardStyle,
  emptyStateStyle,
  emptyTitleStyle,
  itemMetaStyle,
  palette,
  smallPrimaryPillButton,
  smallSecondaryPillButton,
} from "./uiTheme";

export function HistoryPanel({
  entries,
  busy,
  onReplayVoice,
  onRollback,
}: {
  entries: BacklogEntry[];
  busy: boolean;
  onReplayVoice: (entry: BacklogEntry) => void;
  onRollback: (entry: BacklogEntry) => void;
}) {
  if (entries.length === 0) {
    return (
      <div role="status" style={emptyStateStyle}>
        <strong style={emptyTitleStyle}>暂无历史记录</strong>
      </div>
    );
  }

  return (
    <div role="list" aria-label="剧情历史" style={listStyle}>
      {[...entries].reverse().map((entry) => (
        <article key={entry.id} role="listitem" data-history-entry={entry.id} style={entryStyle}>
          <div style={copyStyle}>
            <div style={speakerStyle}>{entry.speakerName ?? "旁白"}</div>
            <p style={textStyle}>{entry.text}</p>
            <code style={positionStyle}>{entry.storyPoint.nodeId} / {entry.storyPoint.instructionId}</code>
          </div>
          <div style={actionsStyle}>
            {entry.voiceId && (
              <button type="button" data-history-action="voice" disabled={busy} onClick={() => onReplayVoice(entry)} style={smallSecondaryPillButton}>
                重播语音
              </button>
            )}
            <button type="button" data-history-action="rollback" disabled={busy} onClick={() => onRollback(entry)} style={smallPrimaryPillButton}>
              回滚至此
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

const listStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 10 };
const entryStyle: CSSProperties = {
  ...cardStyle,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  alignItems: "center",
  gap: 16,
  padding: "14px 16px",
};
const copyStyle: CSSProperties = { minWidth: 0 };
const speakerStyle: CSSProperties = { marginBottom: 5, color: palette.accent, fontSize: 12, fontWeight: 700, letterSpacing: "0.5px" };
const textStyle: CSSProperties = { margin: 0, color: palette.ink, fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap" };
const positionStyle: CSSProperties = { ...itemMetaStyle, display: "block", marginTop: 6 };
const actionsStyle: CSSProperties = { display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 6 };
