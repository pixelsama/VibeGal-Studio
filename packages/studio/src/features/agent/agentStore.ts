/**
 * Agent 对话状态 store（模块级，按项目路径隔离）。
 *
 * 与 buildStore 同一模式：组件卸载不丢会话；AGENT_TURN_EVENT 全局只挂一次监听。
 */
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import {
  agentCancel,
  agentDetect,
  agentSend,
  AGENT_TURN_EVENT,
  type AgentAvailability,
  type AgentKind,
  type AgentTurnEventPayload,
} from "../../lib/tauri";
import {
  appendUserPrompt,
  buildFirstTurnPrompt,
  EMPTY_AGENT_CONVERSATION,
  generateAgentTurnId,
  reduceAgentStreamEvent,
  streamEventFromPayload,
  type AgentConversation,
} from "./agentModel";

export type AgentChatPhase = "idle" | "running";

export interface AgentChatState {
  agent: AgentKind;
  conversation: AgentConversation;
  phase: AgentChatPhase;
  activeTurnId: string | null;
  /** 最近一轮的失败信息（取消不算失败） */
  error: string | null;
}

export const IDLE_AGENT_CHAT_STATE: AgentChatState = {
  agent: "codex",
  conversation: EMPTY_AGENT_CONVERSATION,
  phase: "idle",
  activeTurnId: null,
  error: null,
};

interface AgentChatEntry {
  state: AgentChatState;
  listeners: Set<() => void>;
}

const entries = new Map<string, AgentChatEntry>();

function entryFor(projectPath: string): AgentChatEntry {
  let entry = entries.get(projectPath);
  if (!entry) {
    entry = { state: IDLE_AGENT_CHAT_STATE, listeners: new Set() };
    entries.set(projectPath, entry);
  }
  return entry;
}

function setState(projectPath: string, state: AgentChatState): void {
  const entry = entryFor(projectPath);
  entry.state = state;
  for (const listener of entry.listeners) listener();
}

export function getAgentChatState(projectPath: string): AgentChatState {
  return entryFor(projectPath).state;
}

export function subscribeAgentChat(projectPath: string, listener: () => void): () => void {
  const entry = entryFor(projectPath);
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
  };
}

let turnListenerReady: Promise<unknown> | null = null;

function ensureTurnListener(): void {
  if (turnListenerReady) return;
  turnListenerReady = listen<AgentTurnEventPayload>(AGENT_TURN_EVENT, (event) => {
    const payload = event.payload;
    for (const [projectPath, entry] of entries) {
      if (entry.state.activeTurnId !== payload.turnId) continue;
      setState(projectPath, {
        ...entry.state,
        conversation: reduceAgentStreamEvent(
          entry.state.conversation,
          streamEventFromPayload(payload),
        ),
      });
    }
  });
  turnListenerReady.catch(() => {
    turnListenerReady = null;
  });
}

export function selectAgent(projectPath: string, agent: AgentKind): void {
  const state = getAgentChatState(projectPath);
  if (state.phase === "running" || state.agent === agent) return;
  // 切换 Agent 即开启新会话（各家 session 不互通）
  setState(projectPath, { ...IDLE_AGENT_CHAT_STATE, agent });
}

export function clearAgentConversation(projectPath: string): void {
  const state = getAgentChatState(projectPath);
  if (state.phase === "running") return;
  setState(projectPath, { ...state, conversation: EMPTY_AGENT_CONVERSATION, error: null });
}

export async function sendAgentPrompt(
  projectPath: string,
  projectTitle: string,
  prompt: string,
): Promise<void> {
  const state = getAgentChatState(projectPath);
  if (state.phase === "running" || !prompt.trim()) return;

  ensureTurnListener();
  const turnId = generateAgentTurnId();
  const isFirstTurn = state.conversation.agentSessionId === null;
  const effectivePrompt = isFirstTurn
    ? buildFirstTurnPrompt(prompt, projectPath, projectTitle)
    : prompt;
  setState(projectPath, {
    ...state,
    phase: "running",
    activeTurnId: turnId,
    error: null,
    conversation: appendUserPrompt(state.conversation, prompt),
  });

  const result = await agentSend({
    projectPath,
    agent: state.agent,
    prompt: effectivePrompt,
    agentSessionId: state.conversation.agentSessionId ?? undefined,
    turnId,
  });

  const current = getAgentChatState(projectPath);
  if (result.ok) {
    setState(projectPath, {
      ...current,
      phase: "idle",
      activeTurnId: null,
      conversation: result.agentSessionId
        ? { ...current.conversation, agentSessionId: result.agentSessionId }
        : current.conversation,
    });
  } else {
    setState(projectPath, {
      ...current,
      phase: "idle",
      activeTurnId: null,
      // 用户主动取消不是错误
      error: result.code === "agent_turn_cancelled" ? null : result.message,
    });
  }
}

export async function cancelAgentTurn(projectPath: string): Promise<void> {
  const state = getAgentChatState(projectPath);
  if (state.phase !== "running" || !state.activeTurnId) return;
  try {
    await agentCancel(state.activeTurnId);
  } catch {
    // 轮次恰好已结束时后端会报 not_found，结果态马上由 sendAgentPrompt 落定。
  }
}

// ---------------------------------------------------------------------------
// CLI 可用性探测（模块级缓存，手动刷新）
// ---------------------------------------------------------------------------

let availabilityCache: AgentAvailability[] | null = null;
let availabilityListeners = new Set<() => void>();

export function getAgentAvailability(): AgentAvailability[] | null {
  return availabilityCache;
}

export function subscribeAgentAvailability(listener: () => void): () => void {
  availabilityListeners.add(listener);
  return () => {
    availabilityListeners.delete(listener);
  };
}

export async function refreshAgentAvailability(): Promise<AgentAvailability[]> {
  try {
    availabilityCache = await agentDetect();
  } catch {
    availabilityCache = [];
  }
  for (const listener of availabilityListeners) listener();
  return availabilityCache;
}

// ---------------------------------------------------------------------------
// React hooks
// ---------------------------------------------------------------------------

export function useAgentChatState(projectPath: string): AgentChatState {
  const [state, setLocalState] = useState<AgentChatState>(() => getAgentChatState(projectPath));

  useEffect(() => {
    setLocalState(getAgentChatState(projectPath));
    return subscribeAgentChat(projectPath, () => {
      setLocalState(getAgentChatState(projectPath));
    });
  }, [projectPath]);

  return state;
}

export function useAgentAvailability(): AgentAvailability[] | null {
  const [availability, setAvailability] = useState<AgentAvailability[] | null>(() =>
    getAgentAvailability(),
  );

  useEffect(() => {
    if (getAgentAvailability() === null) {
      void refreshAgentAvailability();
    }
    return subscribeAgentAvailability(() => {
      setAvailability(getAgentAvailability());
    });
  }, []);

  return availability;
}
