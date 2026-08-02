/**
 * Agent 对话页（独立全屏页，不嵌入任何工作台）。
 *
 * 用户通过自然语言驱动本机外部 Agent CLI（codex / claude / opencode）
 * 直接开发当前 galgame 项目；App 不接触模型密钥（BYOK）。
 */
import { ArrowLeft, Bot, Send, Square, Trash2, Wrench } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStudioI18n } from "../../lib/i18n";
import type { ProjectData } from "../../lib/types";
import type { AgentKind } from "../../lib/tauri";
import { AGENT_KIND_ORDER, canSendPrompt, type AgentChatItem } from "./agentModel";
import {
  cancelAgentTurn,
  clearAgentConversation,
  selectAgent,
  sendAgentPrompt,
  useAgentAvailability,
  useAgentChatState,
} from "./agentStore";

export interface AgentPageProps {
  project: ProjectData;
  canGoBack: boolean;
  onBack: () => void;
}

const AGENT_LABELS: Record<AgentKind, string> = {
  codex: "Codex",
  claude: "Claude",
  opencode: "OpenCode",
};

export function AgentPage({ project, canGoBack, onBack }: AgentPageProps) {
  const { t } = useStudioI18n();
  const chat = useAgentChatState(project.path);
  const availability = useAgentAvailability();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const availabilityByAgent = new Map((availability ?? []).map((entry) => [entry.agent, entry]));
  const anyAvailable = (availability ?? []).some((entry) => entry.available);
  const selectedAvailable = availabilityByAgent.get(chat.agent)?.available ?? false;

  // 首次探测完成后，若当前选中的 Agent 不可用则自动切到第一个可用的
  useEffect(() => {
    if (!availability || selectedAvailable) return;
    const first = availability.find((entry) => entry.available);
    if (first) selectAgent(project.path, first.agent);
  }, [availability, selectedAvailable, project.path]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [chat.conversation.items.length]);

  const sendable = canSendPrompt(chat.phase, draft) && selectedAvailable;

  const handleSend = () => {
    if (!sendable) return;
    const prompt = draft.trim();
    setDraft("");
    void sendAgentPrompt(project.path, project.meta.name, prompt);
  };

  return (
    <div
      data-agent-page
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--bg-app)",
        color: "var(--text-primary)",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          padding: "var(--space-3) var(--space-4)",
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
        }}
      >
        {canGoBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label={t("nav.back")}
            style={iconButtonStyle}
          >
            <ArrowLeft size={16} />
          </button>
        ) : null}
        <Bot size={18} style={{ color: "var(--accent)", flexShrink: 0 }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: "var(--text-md)", fontWeight: 500 }}>
            {t("agent.title")} · {project.meta.name}
          </div>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
            {t("agent.subtitle")}
          </div>
        </div>
        <div role="group" aria-label="Agent" style={segmentedStyle}>
          {AGENT_KIND_ORDER.map((agent) => {
            const entry = availabilityByAgent.get(agent);
            const available = entry?.available ?? false;
            const active = chat.agent === agent;
            return (
              <button
                key={agent}
                type="button"
                data-agent-option={agent}
                aria-pressed={active}
                disabled={chat.phase === "running" || (availability !== null && !available)}
                title={
                  availability !== null && !available
                    ? t("agent.unavailable.hint", { agent: AGENT_LABELS[agent] })
                    : entry?.version
                      ? `${AGENT_LABELS[agent]} ${entry.version}`
                      : AGENT_LABELS[agent]
                }
                onClick={() => selectAgent(project.path, agent)}
                style={{
                  ...segmentItemStyle,
                  ...(active ? segmentItemActiveStyle : null),
                }}
              >
                {AGENT_LABELS[agent]}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => clearAgentConversation(project.path)}
          disabled={chat.phase === "running" || chat.conversation.items.length === 0}
          aria-label={t("agent.clear")}
          title={t("agent.clear")}
          style={iconButtonStyle}
        >
          <Trash2 size={15} />
        </button>
      </header>

      <div
        ref={scrollRef}
        data-agent-messages
        style={{ flex: 1, overflowY: "auto", padding: "var(--space-4)" }}
      >
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          {chat.conversation.items.length === 0 ? (
            <EmptyState
              availabilityLoaded={availability !== null}
              anyAvailable={anyAvailable}
              onPickExample={(text) => setDraft(text)}
            />
          ) : (
            chat.conversation.items.map((item, index) => (
              <ChatItemView key={index} item={item} />
            ))
          )}
          {chat.phase === "running" ? (
            <div
              role="status"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
                color: "var(--text-muted)",
                fontSize: "var(--text-sm)",
                padding: "var(--space-2) 0",
              }}
            >
              <span className="gs-agent-spinner" aria-hidden />
              {t("agent.running")}…
            </div>
          ) : null}
          {chat.error ? (
            <div
              role="alert"
              style={{
                margin: "var(--space-2) 0",
                padding: "var(--space-2) var(--space-3)",
                border: "1px solid var(--border-error)",
                background: "var(--bg-error-soft)",
                borderRadius: "var(--radius-md)",
                fontSize: "var(--text-sm)",
              }}
            >
              {t("agent.turnFailed", { message: chat.error })}
            </div>
          ) : null}
        </div>
      </div>

      <footer
        style={{
          borderTop: "1px solid var(--border-subtle)",
          padding: "var(--space-3) var(--space-4)",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            maxWidth: 760,
            margin: "0 auto",
            display: "flex",
            gap: "var(--space-2)",
            alignItems: "flex-end",
          }}
        >
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                handleSend();
              }
            }}
            placeholder={t("agent.input.placeholder")}
            aria-label={t("agent.input.placeholder")}
            rows={3}
            style={{
              flex: 1,
              resize: "none",
              padding: "var(--space-2) var(--space-3)",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-input)",
              background: "var(--bg-panel)",
              color: "var(--text-primary)",
              fontSize: "var(--text-base)",
              fontFamily: "inherit",
              lineHeight: 1.5,
            }}
          />
          {chat.phase === "running" ? (
            <button
              type="button"
              onClick={() => void cancelAgentTurn(project.path)}
              aria-label={t("agent.cancelTurn")}
              style={{ ...sendButtonStyle, background: "var(--bg-hover)", color: "var(--text-primary)" }}
            >
              <Square size={14} />
              {t("agent.cancelTurn")}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={!sendable}
              aria-label={t("agent.send")}
              style={sendButtonStyle}
            >
              <Send size={14} />
              {t("agent.send")}
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

function EmptyState({
  availabilityLoaded,
  anyAvailable,
  onPickExample,
}: {
  availabilityLoaded: boolean;
  anyAvailable: boolean;
  onPickExample: (text: string) => void;
}) {
  const { t } = useStudioI18n();
  if (!availabilityLoaded) {
    return (
      <div style={{ textAlign: "center", color: "var(--text-muted)", padding: "var(--space-8) 0" }}>
        {t("agent.detecting")}
      </div>
    );
  }
  if (!anyAvailable) {
    return (
      <div
        role="note"
        style={{
          maxWidth: 520,
          margin: "var(--space-8) auto",
          padding: "var(--space-4)",
          border: "1px solid var(--border-warn)",
          background: "var(--bg-tag-warn)",
          borderRadius: "var(--radius-md)",
          fontSize: "var(--text-sm)",
          lineHeight: 1.6,
        }}
      >
        {t("agent.noneAvailable")}
      </div>
    );
  }
  return (
    <div style={{ textAlign: "center", padding: "var(--space-8) 0" }}>
      <div style={{ fontSize: "var(--text-lg)", fontWeight: 500, marginBottom: "var(--space-2)" }}>
        {t("agent.empty.title")}
      </div>
      <div
        style={{
          color: "var(--text-secondary)",
          fontSize: "var(--text-sm)",
          lineHeight: 1.6,
          maxWidth: 480,
          margin: "0 auto var(--space-4)",
        }}
      >
        {t("agent.empty.hint")}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", alignItems: "center" }}>
        {(["agent.empty.example1", "agent.empty.example2", "agent.empty.example3"] as const).map(
          (key) => (
            <button
              key={key}
              type="button"
              data-agent-example={key}
              onClick={() => onPickExample(t(key))}
              style={{
                padding: "var(--space-2) var(--space-3)",
                borderRadius: "var(--radius-pill)",
                border: "1px solid var(--border)",
                background: "var(--bg-panel)",
                color: "var(--text-secondary)",
                fontSize: "var(--text-sm)",
                cursor: "pointer",
              }}
            >
              {t(key)}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

function ChatItemView({ item }: { item: AgentChatItem }) {
  const { t } = useStudioI18n();
  if (item.type === "user") {
    return (
      <div data-chat-item="user" style={{ display: "flex", justifyContent: "flex-end", margin: "var(--space-2) 0" }}>
        <div
          style={{
            maxWidth: "80%",
            padding: "var(--space-2) var(--space-3)",
            borderRadius: "var(--radius-lg)",
            background: "var(--accent)",
            color: "var(--text-on-accent)",
            fontSize: "var(--text-base)",
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {item.text}
        </div>
      </div>
    );
  }
  if (item.type === "tool") {
    return (
      <div
        data-chat-item="tool"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          margin: "var(--space-1) 0",
          color: "var(--text-dim)",
          fontSize: "var(--text-xs)",
        }}
      >
        <Wrench size={12} style={{ flexShrink: 0 }} />
        <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>
          {t("agent.tool")} · {item.name}
        </span>
        <code
          style={{
            fontFamily: "var(--font-mono, monospace)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.summary}
        </code>
      </div>
    );
  }
  return (
    <div
      data-chat-item="assistant"
      style={{
        margin: "var(--space-3) 0",
        fontSize: "var(--text-base)",
        lineHeight: 1.7,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {item.text}
    </div>
  );
}

const iconButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border)",
  background: "var(--bg-panel)",
  color: "var(--text-secondary)",
  cursor: "pointer",
  flexShrink: 0,
};

const segmentedStyle: React.CSSProperties = {
  display: "inline-flex",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  overflow: "hidden",
  flexShrink: 0,
};

const segmentItemStyle: React.CSSProperties = {
  border: "none",
  background: "var(--bg-panel)",
  color: "var(--text-secondary)",
  fontSize: "var(--text-xs)",
  padding: "var(--space-1) var(--space-3)",
  cursor: "pointer",
};

const segmentItemActiveStyle: React.CSSProperties = {
  background: "var(--bg-active)",
  color: "var(--text-primary)",
  fontWeight: 500,
};

const sendButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-2)",
  padding: "var(--space-2) var(--space-4)",
  borderRadius: "var(--radius-md)",
  border: "none",
  background: "var(--accent)",
  color: "var(--text-on-accent)",
  fontSize: "var(--text-sm)",
  fontWeight: 500,
  cursor: "pointer",
  flexShrink: 0,
};
