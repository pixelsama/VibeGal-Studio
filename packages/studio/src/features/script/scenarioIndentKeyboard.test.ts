import { describe, expect, it } from "vitest";
import { planEnterIndent, planTabIndent, shouldDedentOnBackspace } from "./scenarioIndentKeyboard";

describe("planEnterIndent", () => {
  it("indents one level after a choice block header", () => {
    const text = "choice";
    // cursor at end of "choice"
    const indent = planEnterIndent(text, text.length);
    expect(indent).toBe("    ");
  });

  it("indents one level after an if block header", () => {
    const text = "if affection >= 60";
    const indent = planEnterIndent(text, text.length);
    expect(indent).toBe("    ");
  });

  it("indents two levels after an option title (inside a choice)", () => {
    const text = "choice\n    去看看那片火光";
    // cursor at end of the option line
    const offset = text.length;
    const indent = planEnterIndent(text, offset);
    expect(indent).toBe("        ");
  });

  it("keeps the same indent after a body instruction line", () => {
    const text = "choice\n    去看看\n        NPC: 你好！";
    const offset = text.length; // end of the say line
    const indent = planEnterIndent(text, offset);
    expect(indent).toBe("        ");
  });

  it("keeps the same indent for top-level leaf instructions", () => {
    const text = "@bg room";
    const indent = planEnterIndent(text, text.length);
    expect(indent).toBe("");
  });

  it("inherits the previous non-empty line indent on a blank line", () => {
    const text = "@bg room\n    \n";
    // cursor on the blank line (offset at end of blank line)
    const offset = text.length - 1;
    const indent = planEnterIndent(text, offset);
    expect(indent).toBe("");
  });
});

describe("shouldDedentOnBackspace", () => {
  it("dedents an indented empty line at column 0", () => {
    const text = "choice\n    \n";
    // cursor at start of the indented blank line
    const offset = "choice\n".length;
    expect(shouldDedentOnBackspace(text, offset)).toBe(true);
  });

  it("does not dedent a non-empty line", () => {
    const text = "choice\n    opt";
    const offset = "choice\n".length;
    expect(shouldDedentOnBackspace(text, offset)).toBe(false);
  });

  it("does not dedent when cursor is not at column 0", () => {
    const text = "choice\n    \n";
    const offset = "choice\n  ".length;
    expect(shouldDedentOnBackspace(text, offset)).toBe(false);
  });
});

describe("planTabIndent", () => {
  it("increases indent by one level on Tab", () => {
    const text = "NPC: 你好。";
    const result = planTabIndent(text, 0, 1);
    expect(result.indent).toBe(4);
  });

  it("decreases indent by one level on Shift+Tab", () => {
    const text = "        NPC: 你好。";
    const result = planTabIndent(text, 0, -1);
    expect(result.indent).toBe(4);
  });

  it("does not go below zero indent", () => {
    const text = "NPC: 你好。";
    const result = planTabIndent(text, 0, -1);
    expect(result.indent).toBe(0);
  });
});

import { applyBackspace, applyEnter, applyTab } from "./scenarioIndentKeyboard";

describe("applyEnter", () => {
  it("inserts a newline with indent after a choice header", () => {
    const result = applyEnter("choice", "choice".length);
    expect(result.text).toBe("choice\n    ");
    expect(result.cursorOffset).toBe("choice\n    ".length);
  });

  it("inserts a plain newline when no indent is needed", () => {
    const result = applyEnter("@bg room", "@bg room".length);
    expect(result.text).toBe("@bg room\n");
    expect(result.cursorOffset).toBe("@bg room\n".length);
  });
});

describe("applyBackspace", () => {
  it("dedents an indented empty line", () => {
    const text = "choice\n    \n";
    const offset = "choice\n".length;
    const result = applyBackspace(text, offset);
    expect(result).not.toBeNull();
    expect(result!.text).toBe("choice\n\n");
  });

  it("returns null for a non-empty line (lets native backspace run)", () => {
    expect(applyBackspace("choice\n    opt", "choice\n".length)).toBeNull();
  });
});

describe("applyTab", () => {
  it("indents the current line on Tab", () => {
    const text = "NPC: 你好。";
    const result = applyTab(text, 0, 1);
    expect(result.text).toBe("    NPC: 你好。");
    expect(result.cursorOffset).toBe(4);
  });

  it("dedents on Shift+Tab", () => {
    const text = "        NPC: 你好。";
    const result = applyTab(text, 0, -1);
    expect(result.text).toBe("    NPC: 你好。");
  });
});
