import type { CSSProperties } from "react";
import type { BacklogEntry } from "@vibegal/engine";

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
      <div role="status" style={emptyStyle}>
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
              <button type="button" data-history-action="voice" disabled={busy} onClick={() => onReplayVoice(entry)} style={secondaryButtonStyle}>
                重播语音
              </button>
            )}
            <button type="button" data-history-action="rollback" disabled={busy} onClick={() => onRollback(entry)} style={primaryButtonStyle}>
              回滚至此
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

const emptyStyle: CSSProperties = { minHeight: 260, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: "rgba(255, 255, 255, 0.6)" };
const emptyTitleStyle: CSSProperties = { color: "#fff", fontSize: 17 };
const listStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 8 };
const entryStyle: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", gap: 16, padding: "13px 14px", border: "1px solid rgba(255, 255, 255, 0.13)", borderRadius: 5, background: "rgba(255, 255, 255, 0.03)" };
const copyStyle: CSSProperties = { minWidth: 0 };
const speakerStyle: CSSProperties = { marginBottom: 5, color: "#75d8c6", fontSize: 12, fontWeight: 700 };
const textStyle: CSSProperties = { margin: 0, color: "rgba(255, 255, 255, 0.9)", fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-wrap" };
const positionStyle: CSSProperties = { display: "block", marginTop: 6, color: "rgba(255, 255, 255, 0.38)", fontSize: 10 };
const actionsStyle: CSSProperties = { display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 6 };
const baseButtonStyle: CSSProperties = { minHeight: 31, borderRadius: 4, padding: "6px 10px", color: "#fff", font: "600 11px/1 system-ui, sans-serif", cursor: "pointer" };
const primaryButtonStyle: CSSProperties = { ...baseButtonStyle, border: "1px solid #73d3c1", background: "#246d62" };
const secondaryButtonStyle: CSSProperties = { ...baseButtonStyle, border: "1px solid #d8b66f", background: "rgba(111, 79, 27, 0.55)" };
