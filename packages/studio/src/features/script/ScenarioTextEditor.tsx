import type { CSSProperties, KeyboardEvent, RefObject } from "react";
import type { InsertableKind } from "./instructions";
import type { NodeEditorMode } from "./nodeEditorModel";
import type { ScenarioCommandOption } from "./scenarioCommands";

export function ScenarioTextEditor({
  mode,
  text,
  textareaRef,
  lineActionTop,
  commandMenuVisible,
  visibleCommands,
  onToggleLineCommandMenu,
  onInsertCommand,
  onScenarioTextChange,
  onJsonTextChange,
  onSyncCursor,
  onKeyDown,
  onScroll,
}: {
  mode: NodeEditorMode;
  text: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  lineActionTop: number;
  commandMenuVisible: boolean;
  visibleCommands: ScenarioCommandOption[];
  onToggleLineCommandMenu: () => void;
  onInsertCommand: (kind: InsertableKind) => void;
  onScenarioTextChange: (textarea: HTMLTextAreaElement) => void;
  onJsonTextChange: (textarea: HTMLTextAreaElement) => void;
  onSyncCursor: (textarea: HTMLTextAreaElement) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onScroll: (scrollTop: number) => void;
}) {
  return (
    <div style={scenarioTextWrapStyle}>
      {mode === "scenario" && (
        <button
          type="button"
          aria-label="插入当前行命令"
          title="插入当前行命令"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onToggleLineCommandMenu}
          style={{ ...linePlusButtonStyle, top: lineActionTop }}
        >
          +
        </button>
      )}
      {commandMenuVisible && (
        <div
          role="menu"
          aria-label="剧本命令"
          style={{ ...commandMenuStyle, top: lineActionTop + 30 }}
        >
          {visibleCommands.map((command) => (
            <button
              key={command.kind}
              type="button"
              role="menuitem"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onInsertCommand(command.kind)}
              style={commandMenuButtonStyle}
            >
              <span style={commandMenuLabelStyle}>{command.label}</span>
              <span style={commandMenuDetailStyle}>{command.detail}</span>
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(event) => {
          if (mode === "scenario") onScenarioTextChange(event.currentTarget);
          else onJsonTextChange(event.currentTarget);
        }}
        onSelect={(event) => onSyncCursor(event.currentTarget)}
        onClick={(event) => onSyncCursor(event.currentTarget)}
        onKeyDown={onKeyDown}
        onKeyUp={(event) => onSyncCursor(event.currentTarget)}
        onScroll={(event) => onScroll(event.currentTarget.scrollTop)}
        spellCheck={false}
        style={mode === "scenario" ? scenarioTextareaStyle : textareaStyle}
      />
    </div>
  );
}

const textareaStyle: CSSProperties = {
  flex: 1,
  width: "100%",
  height: "100%",
  resize: "none",
  border: "none",
  outline: "none",
  padding: "var(--space-4)",
  background: "var(--bg-inset)",
  color: "var(--text-primary)",
  fontFamily: "ui-monospace, 'SF Mono', monospace",
  fontSize: "var(--text-base)",
  lineHeight: 1.6,
};

const scenarioTextareaStyle: CSSProperties = {
  ...textareaStyle,
  fontFamily: "ui-monospace, 'SF Mono', monospace",
  fontSize: "var(--text-md)",
  lineHeight: 1.7,
  paddingLeft: 46,
};

const scenarioTextWrapStyle: CSSProperties = {
  position: "relative",
  flex: 1,
  minHeight: 0,
};

const linePlusButtonStyle: CSSProperties = {
  position: "absolute",
  left: 10,
  zIndex: 3,
  width: 24,
  height: 24,
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-input)",
  background: "var(--bg-panel)",
  color: "var(--text-secondary)",
  cursor: "pointer",
  fontSize: "var(--text-lg)",
  lineHeight: "20px",
};

const commandMenuStyle: CSSProperties = {
  position: "absolute",
  left: 36,
  zIndex: 4,
  display: "grid",
  gap: "var(--space-1)",
  width: 240,
  maxHeight: 280,
  overflow: "auto",
  padding: "var(--space-2)",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border-strong)",
  background: "var(--bg-panel)",
  boxShadow: "0 14px 34px rgba(15, 23, 42, 0.18)",
};

const commandMenuButtonStyle: CSSProperties = {
  display: "grid",
  gap: 2,
  padding: "7px var(--space-2)",
  border: "none",
  borderRadius: "var(--radius-sm)",
  background: "transparent",
  color: "var(--text-primary)",
  textAlign: "left",
  cursor: "pointer",
};

const commandMenuLabelStyle: CSSProperties = {
  fontSize: "var(--text-base)",
  fontWeight: 600,
};

const commandMenuDetailStyle: CSSProperties = {
  fontSize: "var(--text-sm)",
  color: "var(--text-muted)",
};
