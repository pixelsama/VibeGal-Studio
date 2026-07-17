import { useMemo, useState, type CSSProperties, type KeyboardEvent, type RefObject } from "react";
import type { InsertableKind } from "./instructions";
import type { NodeEditorMode } from "./nodeEditorModel";
import type { ScenarioCommandOption } from "./scenarioCommands";
import { highlightScenarioLine, type ScenarioTokenKind } from "./scenarioHighlight";

/** 剧本编辑区的行高/内边距常量：gutter、高亮层、命令菜单定位共用同一份度量。 */
export const SCENARIO_LINE_HEIGHT = 24;
export const SCENARIO_TEXT_PADDING_TOP = 16;
export const SCENARIO_GUTTER_WIDTH = 40;

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
  currentLine,
  implicitPauseLines,
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
  currentLine: number;
  implicitPauseLines: number[];
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
  const scenario = mode === "scenario";
  const showStarterGuide = scenario && text.trim() === "";
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  const lines = useMemo(() => text.replace(/\r\n/g, "\n").split("\n"), [text]);
  const highlightedLines = useMemo(() => lines.map(highlightScenarioLine), [lines]);
  const pauseLineSet = useMemo(() => new Set(implicitPauseLines), [implicitPauseLines]);

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
      {scenario && (
        <div style={gutterStyle} data-region="scenario-gutter">
          <div style={{ transform: `translateY(${-scroll.top}px)`, paddingTop: SCENARIO_TEXT_PADDING_TOP }}>
            {lines.map((_, index) => {
              const lineNumber = index + 1;
              const isCurrent = lineNumber === currentLine;
              const hasPause = pauseLineSet.has(lineNumber);
              return (
                <div
                  key={lineNumber}
                  style={{
                    ...gutterRowStyle,
                    color: isCurrent ? "var(--text-bright)" : "var(--text-muted)",
                  }}
                >
                  {hasPause && (
                    <div
                      style={pauseMarkerStyle}
                      data-pause-marker={lineNumber}
                      title="空行 = 一次停顿"
                    />
                  )}
                  {isCurrent ? (
                    <button
                      type="button"
                      aria-label="插入当前行命令"
                      title="插入当前行命令"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={onToggleLineCommandMenu}
                      style={gutterPlusStyle}
                    >
                      +
                    </button>
                  ) : lineNumber}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {commandMenuVisible && (
        <div
          role="menu"
          aria-label="剧本命令"
          style={{ ...commandMenuStyle, top: lineActionTop + SCENARIO_LINE_HEIGHT + 4 }}
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
      {scenario && (
        <pre
          aria-hidden
          data-region="scenario-highlight"
          style={{
            ...highlightLayerStyle,
            transform: `translate(${-scroll.left}px, ${-scroll.top}px)`,
          }}
        >
          {highlightedLines.map((tokens, index) => (
            // eslint-disable-next-line react/no-array-index-key
            <span key={index}>
              {tokens.map((token, tokenIndex) => (
                // eslint-disable-next-line react/no-array-index-key
                <span key={tokenIndex} style={{ color: SCENARIO_TOKEN_COLORS[token.kind] }}>{token.text}</span>
              ))}
              {index < highlightedLines.length - 1 ? "\n" : ""}
            </span>
          ))}
          {" "}
        </pre>
      )}
      <textarea
        ref={textareaRef}
        value={text}
        wrap={scenario ? "off" : "soft"}
        onChange={(event) => {
          if (scenario) onScenarioTextChange(event.currentTarget);
          else onJsonTextChange(event.currentTarget);
        }}
        onSelect={(event) => onSyncCursor(event.currentTarget)}
        onClick={(event) => onSyncCursor(event.currentTarget)}
        onKeyDown={onKeyDown}
        onKeyUp={(event) => onSyncCursor(event.currentTarget)}
        onScroll={(event) => {
          setScroll({ top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft });
          onScroll(event.currentTarget.scrollTop);
        }}
        spellCheck={false}
        style={scenario ? scenarioTextareaStyle : textareaStyle}
      />
    </div>
  );
}

const SCENARIO_TOKEN_COLORS: Record<ScenarioTokenKind, string> = {
  command: "var(--accent-bright)",
  param: "var(--text-secondary)",
  speaker: "var(--status-ok-text)",
  text: "var(--text-primary)",
  dim: "var(--text-muted)",
  invalid: "var(--status-error-text)",
};

const monoFont = "ui-monospace, 'SF Mono', monospace";

const textareaStyle: CSSProperties = {
  flex: 1,
  width: "100%",
  height: "100%",
  resize: "none",
  border: "none",
  outline: "none",
  margin: 0,
  padding: "var(--space-4)",
  background: "transparent",
  color: "var(--text-primary)",
  fontFamily: monoFont,
  fontSize: "var(--text-base)",
  lineHeight: 1.6,
};

/* 透明文字 + 底层高亮：字体度量必须与 highlightLayerStyle 完全一致。 */
const scenarioTextareaStyle: CSSProperties = {
  ...textareaStyle,
  position: "relative",
  zIndex: 1,
  padding: `${SCENARIO_TEXT_PADDING_TOP}px var(--space-4) var(--space-4) ${SCENARIO_GUTTER_WIDTH + 6}px`,
  color: "transparent",
  caretColor: "var(--text-bright)",
  fontSize: "var(--text-md)",
  lineHeight: `${SCENARIO_LINE_HEIGHT}px`,
};

const highlightLayerStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 0,
  margin: 0,
  border: "none",
  padding: `${SCENARIO_TEXT_PADDING_TOP}px var(--space-4) var(--space-4) ${SCENARIO_GUTTER_WIDTH + 6}px`,
  background: "transparent",
  color: "var(--text-primary)",
  fontFamily: monoFont,
  fontSize: "var(--text-md)",
  lineHeight: `${SCENARIO_LINE_HEIGHT}px`,
  whiteSpace: "pre",
  overflow: "hidden",
  pointerEvents: "none",
};

const scenarioTextWrapStyle: CSSProperties = {
  position: "relative",
  flex: 1,
  minHeight: 0,
  background: "var(--bg-inset)",
};

const gutterStyle: CSSProperties = {
  position: "absolute",
  top: 0,
  bottom: 0,
  left: 0,
  zIndex: 2,
  width: SCENARIO_GUTTER_WIDTH,
  overflow: "hidden",
  fontFamily: monoFont,
  fontSize: "var(--text-xs)",
  pointerEvents: "none",
};

const gutterRowStyle: CSSProperties = {
  position: "relative",
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  height: SCENARIO_LINE_HEIGHT,
  paddingRight: 6,
  lineHeight: `${SCENARIO_LINE_HEIGHT}px`,
  boxSizing: "border-box",
};

const pauseMarkerStyle: CSSProperties = {
  position: "absolute",
  bottom: 2,
  left: "50%",
  transform: "translateX(-50%)",
  width: 14,
  height: 2,
  borderRadius: 1,
  background: "var(--text-muted)",
  opacity: 0.7,
  pointerEvents: "auto",
};

/* 当前行的 + 按钮：替代行号，避免额外浮层的对齐计算。 */
const gutterPlusStyle: CSSProperties = {
  width: 18,
  height: 18,
  marginRight: 2,
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-input)",
  background: "var(--bg-panel)",
  color: "var(--text-secondary)",
  cursor: "pointer",
  fontSize: "var(--text-sm)",
  lineHeight: 1,
  padding: 0,
  pointerEvents: "auto",
};

/* 空态引导浮层：容器不拦截输入，只有按钮可点。 */
const starterGuideStyle: CSSProperties = {
  position: "absolute",
  top: 16,
  left: SCENARIO_GUTTER_WIDTH + 6,
  zIndex: 3,
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
