import type { CSSProperties, KeyboardEvent, RefObject } from "react";
import type { InsertableKind } from "./instructions";
import type { NodeEditorMode } from "./nodeEditorModel";
import type { ScenarioCommandOption } from "./scenarioCommands";

export interface ScenarioStarterTemplate {
  label: string;
  detail: string;
  text: string;
}

/** 空节点引导模板：必须能被 scenario DSL 无损解析（有测试守护）。 */
export const SCENARIO_STARTER_TEMPLATES: ScenarioStarterTemplate[] = [
  { label: "旁白开场", detail: "一段叙述文本", text: "夜深了。" },
  { label: "角色台词", detail: "名字: 台词", text: "角色名: 你好，世界。" },
  { label: "场景开场", detail: "背景 + 台词", text: "@bg 背景id fade\n\n角色名: 你好，世界。" },
];

export function ScenarioTextEditor({
  mode,
  text,
  textareaRef,
  lineActionTop,
  commandMenuVisible,
  visibleCommands,
  onToggleLineCommandMenu,
  onInsertCommand,
  onInsertTemplate,
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
  onInsertTemplate: (text: string) => void;
  onScenarioTextChange: (textarea: HTMLTextAreaElement) => void;
  onJsonTextChange: (textarea: HTMLTextAreaElement) => void;
  onSyncCursor: (textarea: HTMLTextAreaElement) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onScroll: (scrollTop: number) => void;
}) {
  const showStarterGuide = mode === "scenario" && text.trim() === "";
  return (
    <div style={scenarioTextWrapStyle}>
      {showStarterGuide && (
        <div style={starterGuideStyle} data-region="scenario-starter-guide">
          <div style={starterGuideTitleStyle}>空节点：直接输入，或从模板开始</div>
          <div style={starterGuideListStyle}>
            {SCENARIO_STARTER_TEMPLATES.map((template) => (
              <button
                key={template.label}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onInsertTemplate(template.text)}
                style={starterGuideButtonStyle}
              >
                <span style={starterGuideLabelStyle}>{template.label}</span>
                <span style={starterGuideDetailStyle}>{template.detail}</span>
              </button>
            ))}
          </div>
        </div>
      )}
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

/* 空态引导浮层：容器不拦截输入，只有按钮可点。 */
const starterGuideStyle: CSSProperties = {
  position: "absolute",
  top: 16,
  left: 46,
  zIndex: 2,
  display: "grid",
  gap: "var(--space-2)",
  maxWidth: 360,
  pointerEvents: "none",
};

const starterGuideTitleStyle: CSSProperties = {
  fontSize: "var(--text-sm)",
  color: "var(--text-muted)",
};

const starterGuideListStyle: CSSProperties = {
  display: "grid",
  gap: "var(--space-1)",
  width: 240,
};

const starterGuideButtonStyle: CSSProperties = {
  display: "grid",
  gap: 2,
  padding: "7px var(--space-2)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-input)",
  background: "var(--bg-panel)",
  color: "var(--text-primary)",
  textAlign: "left",
  cursor: "pointer",
  pointerEvents: "auto",
};

const starterGuideLabelStyle: CSSProperties = {
  fontSize: "var(--text-base)",
  fontWeight: 600,
};

const starterGuideDetailStyle: CSSProperties = {
  fontSize: "var(--text-sm)",
  color: "var(--text-muted)",
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
  boxShadow: "var(--shadow-pop)",
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
