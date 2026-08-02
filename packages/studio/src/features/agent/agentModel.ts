/**
 * Agent 对话页的纯逻辑层：会话数据结构、流事件归约、首轮上下文注入。
 *
 * 不依赖 @tauri-apps/api，可在 vitest（node 环境）下直接测试。
 */
import type { AgentKind, AgentStreamEvent, AgentTurnEventPayload } from "../../lib/tauri";

/** 从后端事件 payload 中剥离路由字段（turnId/agent），得到归一化流事件 */
export function streamEventFromPayload(payload: AgentTurnEventPayload): AgentStreamEvent {
  switch (payload.kind) {
    case "session":
      return { kind: "session", sessionId: payload.sessionId };
    case "message":
      return { kind: "message", text: payload.text };
    case "tool":
      return { kind: "tool", name: payload.name, summary: payload.summary };
  }
}

export type AgentChatItem =
  | { type: "user"; text: string }
  | { type: "assistant"; text: string }
  | { type: "tool"; name: string; summary: string };

export interface AgentConversation {
  /** Agent 端会话标识（首轮由 CLI 返回，后续轮次用于 resume） */
  agentSessionId: string | null;
  items: AgentChatItem[];
}

export const EMPTY_AGENT_CONVERSATION: AgentConversation = {
  agentSessionId: null,
  items: [],
};

export function appendUserPrompt(
  conversation: AgentConversation,
  text: string,
): AgentConversation {
  return {
    ...conversation,
    items: [...conversation.items, { type: "user", text }],
  };
}

/** 把一个归一化流事件折叠进会话。未知事件原样返回（便于未来扩展）。 */
export function reduceAgentStreamEvent(
  conversation: AgentConversation,
  event: AgentStreamEvent,
): AgentConversation {
  switch (event.kind) {
    case "session":
      return { ...conversation, agentSessionId: event.sessionId };
    case "message":
      return {
        ...conversation,
        items: [...conversation.items, { type: "assistant", text: event.text }],
      };
    case "tool":
      return {
        ...conversation,
        items: [
          ...conversation.items,
          { type: "tool", name: event.name, summary: event.summary },
        ],
      };
    default:
      return conversation;
  }
}

export function generateAgentTurnId(now = Date.now(), random = Math.random()): string {
  return `agent-turn-${now.toString(36)}-${random.toString(36).slice(2, 10)}`;
}

/**
 * 首轮提示注入项目上下文：项目目录是 Agent 的 cwd，但 Agent 未必知道
 * 该读哪些自描述文件。用中英双语写，跟随用户语言交给 Agent 自行匹配。
 */
export function buildFirstTurnPrompt(
  prompt: string,
  projectPath: string,
  projectTitle: string,
): string {
  return [
    "[VibeGal-Studio 项目上下文 / Project context]",
    `项目根目录 / Project root: ${projectPath}`,
    `作品标题 / Title: ${projectTitle}`,
    "修改文件前请先阅读项目根目录的 AGENTS.md 与 .galstudio/README.md 了解数据契约。请用与用户相同的语言交流。",
    "Before editing files, read AGENTS.md and .galstudio/README.md at the project root for the data contracts. Reply in the user's language.",
    "",
    "[用户请求 / User request]",
    prompt,
  ].join("\n");
}

/** 同一轮次内是否只允许一个 turn 在跑（发送按钮的禁用条件） */
export function canSendPrompt(phase: "idle" | "running", prompt: string): boolean {
  return phase === "idle" && prompt.trim().length > 0;
}

export const AGENT_KIND_ORDER: AgentKind[] = ["codex", "claude", "opencode"];
