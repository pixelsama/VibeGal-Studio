import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  appendUserPrompt,
  buildFirstTurnPrompt,
  canSendPrompt,
  EMPTY_AGENT_CONVERSATION,
  generateAgentTurnId,
  reduceAgentStreamEvent,
  type AgentConversation,
} from "./agentModel";
import { AgentPage } from "./AgentPage";
import { StudioI18nProvider } from "../../lib/i18n";
import type { ProjectData } from "../../lib/types";

describe("agentModel conversation reducers", () => {
  it("appends user prompts without touching the session id", () => {
    const next = appendUserPrompt(EMPTY_AGENT_CONVERSATION, "写个开场");
    expect(next.items).toEqual([{ type: "user", text: "写个开场" }]);
    expect(next.agentSessionId).toBeNull();
  });

  it("captures the agent session id from session events", () => {
    const next = reduceAgentStreamEvent(EMPTY_AGENT_CONVERSATION, {
      kind: "session",
      sessionId: "sess-1",
    });
    expect(next.agentSessionId).toBe("sess-1");
    expect(next.items).toHaveLength(0);
  });

  it("appends assistant messages and tool calls in arrival order", () => {
    let conversation: AgentConversation = EMPTY_AGENT_CONVERSATION;
    conversation = reduceAgentStreamEvent(conversation, { kind: "message", text: "先看一下。" });
    conversation = reduceAgentStreamEvent(conversation, {
      kind: "tool",
      name: "bash",
      summary: "ls content/",
    });
    conversation = reduceAgentStreamEvent(conversation, { kind: "message", text: "完成了。" });
    expect(conversation.items.map((item) => item.type)).toEqual([
      "assistant",
      "tool",
      "assistant",
    ]);
  });

  it("keeps the session id when later events arrive", () => {
    let conversation = reduceAgentStreamEvent(EMPTY_AGENT_CONVERSATION, {
      kind: "session",
      sessionId: "thread-9",
    });
    conversation = appendUserPrompt(conversation, "第二轮");
    conversation = reduceAgentStreamEvent(conversation, { kind: "message", text: "好" });
    expect(conversation.agentSessionId).toBe("thread-9");
  });
});

describe("buildFirstTurnPrompt", () => {
  it("injects project path, title, contract pointers and the user prompt", () => {
    const prompt = buildFirstTurnPrompt("加个分支", "/games/story", "车站物语");
    expect(prompt).toContain("/games/story");
    expect(prompt).toContain("车站物语");
    expect(prompt).toContain("AGENTS.md");
    expect(prompt).toContain(".galstudio/README.md");
    expect(prompt.endsWith("加个分支")).toBe(true);
  });
});

describe("canSendPrompt", () => {
  it("requires idle phase and non-blank prompt", () => {
    expect(canSendPrompt("idle", "hi")).toBe(true);
    expect(canSendPrompt("idle", "   ")).toBe(false);
    expect(canSendPrompt("running", "hi")).toBe(false);
  });
});

describe("generateAgentTurnId", () => {
  it("is prefixed and unique per input", () => {
    const id = generateAgentTurnId(123, () => 0.5);
    expect(id.startsWith("agent-turn-")).toBe(true);
    expect(generateAgentTurnId(123, () => 0.5)).toBe(id);
    expect(generateAgentTurnId(124, () => 0.5)).not.toBe(id);
  });
});

describe("AgentPage SSR", () => {
  const project = {
    path: "/games/story",
    meta: { name: "车站物语", activeRendererId: "default", createdAt: "1" },
  } as unknown as ProjectData;

  it("renders the header, agent selector and input area", () => {
    const html = renderToStaticMarkup(
      createElement(
        StudioI18nProvider,
        { preference: "zh-CN" },
        createElement(AgentPage, { project, canGoBack: true, onBack: () => {} }),
      ),
    );
    expect(html).toContain("data-agent-page");
    expect(html).toContain("Agent 对话");
    expect(html).toContain("车站物语");
    expect(html).toContain('data-agent-option="codex"');
    expect(html).toContain('data-agent-option="claude"');
    expect(html).toContain('data-agent-option="opencode"');
    expect(html).toContain("textarea");
  });

  it("renders english copy under en locale", () => {
    const html = renderToStaticMarkup(
      createElement(
        StudioI18nProvider,
        { preference: "en" },
        createElement(AgentPage, { project, canGoBack: true, onBack: () => {} }),
      ),
    );
    expect(html).toContain("Agent chat");
    expect(html).toContain("Send");
  });
});
