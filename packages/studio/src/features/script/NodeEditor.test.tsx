import { createElement } from "react";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Instruction } from "@galstudio/engine";
import { describe, expect, it } from "vitest";
import {
  conflictDraftCopyPath,
  InstructionBlock,
  isWriteConflictError,
  nodeEditorKeepsDraftOnWriteConflict,
  transitionNodeEditorMode,
} from "./NodeEditor";

describe("InstructionBlock", () => {
  const manifest = {
    characters: {
      hero: {
        name: "Hero",
        color: "#ffffff",
        sprites: { default: "assets/characters/hero/default.png" },
      },
    },
    backgrounds: {},
    audio: { bgm: {}, sfx: {}, voice: {} },
  };

  function renderBlock(instruction: Instruction, extraProps: Partial<ComponentProps<typeof InstructionBlock>> = {}) {
    return renderToStaticMarkup(createElement(InstructionBlock, {
      index: 0,
      instruction,
      manifest,
      graphNodes: [{ id: "stay", title: "留下", file: "nodes/stay.json", position: { x: 0, y: 0 } }],
      issues: [],
      onUpdate: () => {},
      onDuplicate: () => {},
      onDelete: () => {},
      onMoveUp: () => {},
      onMoveDown: () => {},
      ...extraProps,
    }));
  }

  it("renders say fields", () => {
    const html = renderBlock({ t: "say", who: "hero", expr: "default", text: "你好。" } as Instruction);

    expect(html).toContain("角色");
    expect(html).toContain("表情");
    expect(html).toContain("文本");
    expect(html).toContain("hero");
    expect(html).toContain("你好。");
  });

  it("renders timing and effect controls", () => {
    expect(renderBlock({ t: "wait", ms: 1000 } as Instruction)).toContain("等待 ms");
    expect(renderBlock({ t: "effect", type: "shake", intensity: 6, ms: 400 } as Instruction)).toContain("强度");
    expect(renderBlock({ t: "transition", type: "fade_in", ms: 1000 } as Instruction)).toContain("fade_in");
  });

  it("renders choice controls and inline issues", () => {
    const html = renderBlock(
      { t: "choice", choices: [{ text: "留下", to: "stay" }] } as Instruction,
      { issues: [{ code: "choice_missing_graph_edge", message: "缺少边" }] },
    );

    expect(html).toContain("选项文本");
    expect(html).toContain("目标节点");
    expect(html).toContain("添加选项");
    expect(html).toContain("choice_missing_graph_edge");
  });
});

describe("transitionNodeEditorMode", () => {
  it("switches json to blocks when valid", () => {
    const result = transitionNodeEditorMode({
      mode: "json",
      text: '[{"t":"wait","ms":1000}]',
      instructions: [],
    });

    expect(result.mode).toBe("blocks");
    expect(result.instructions).toEqual([{ t: "wait", ms: 1000 }]);
    expect(result.error).toBeNull();
  });

  it("refuses blocks when json invalid", () => {
    const result = transitionNodeEditorMode({
      mode: "json",
      text: '{"t":"wait"}',
      instructions: [],
    });

    expect(result.mode).toBe("json");
    expect(result.text).toBe('{"t":"wait"}');
    expect(result.error).toContain("JSON 数组");
  });
});

describe("NodeEditor safe persistence", () => {
  it("nodeEditorKeepsDraftOnWriteConflict", () => {
    const draft = {
      text: '[{"t":"narrate","text":"local draft"}]',
      instructions: [{ t: "narrate", text: "local draft" }] as Instruction[],
    };
    const error = JSON.stringify({ code: "write_conflict", file: "content/nodes/start.json" });

    const result = nodeEditorKeepsDraftOnWriteConflict(draft, error);

    expect(result.conflict).toBe(true);
    expect(result.draft).toBe(draft);
    expect(isWriteConflictError(error)).toBe(true);
  });

  it("builds conflict draft copy path next to the node file", () => {
    expect(conflictDraftCopyPath("nodes/act1/start.json", 123)).toBe("nodes/act1/start.conflict-123.json");
  });
});
