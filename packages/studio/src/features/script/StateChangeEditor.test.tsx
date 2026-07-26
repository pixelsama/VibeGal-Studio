import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SetInstr, VariableRegistry } from "@vibegal/engine";
import { StateChangeEditor, readAmount, readMode, writeMode } from "./StateChangeEditor";

const variables: VariableRegistry = {
  version: 1,
  variables: {
    affection: {
      kind: "meter", type: "number", default: 0, nullable: false, scope: "run",
      label: "好感度", min: 0, max: 100,
    },
    has_key: { kind: "flag", type: "boolean", default: false, nullable: false, scope: "run", label: "拿到钥匙" },
    route: {
      kind: "state", type: "string", default: "common", nullable: false, scope: "run", label: "当前路线",
      options: [{ id: "common", label: "共通线" }, { id: "yuki", label: "雪线" }],
    },
  },
};

const render = (instruction: SetInstr) => renderToStaticMarkup(createElement(StateChangeEditor, {
  instruction, variables, onChange: () => {},
}));

describe("StateChangeEditor", () => {
  it("offers 增加/减少/设为 for a meter instead of an assignment expression", () => {
    const html = render({ t: "set", key: "affection", expr: "affection + 3" });
    expect(html).toContain("增加");
    expect(html).toContain("减少");
    expect(html).toContain("设为");
    expect(html).toMatch(/aria-checked="true"[^>]*>增加/);
    // 表达式仍可用，但降级成折叠的高级入口。
    expect(html).toContain("用表达式计算");
    expect(html).not.toContain("赋值方式");
  });

  it("tells the author the value cannot leave the declared range", () => {
    const html = render({ t: "set", key: "affection", expr: "affection + 3" });
    expect(html).toContain("不会超出 0–100");
  });

  it("shows a flag as 已发生 / 还没发生 rather than true / false", () => {
    const html = render({ t: "set", key: "has_key", value: true });
    expect(html).toContain('role="switch"');
    expect(html).toContain("已发生");
    expect(html).not.toContain(">true<");
  });

  it("offers declared options for a state so the value cannot be mistyped", () => {
    const html = render({ t: "set", key: "route", value: "yuki" });
    expect(html).toContain("共通线");
    expect(html).toContain("雪线");
  });
});

describe("set instruction round trip", () => {
  it("reads an increment expression back as 增加 N", () => {
    const instruction: SetInstr = { t: "set", key: "affection", expr: "affection + 3" };
    expect(readMode(instruction)).toBe("increase");
    expect(readAmount(instruction)).toBe(3);
  });

  it("reads a decrement expression back as 减少 N", () => {
    const instruction: SetInstr = { t: "set", key: "affection", expr: "affection - 1" };
    expect(readMode(instruction)).toBe("decrease");
    expect(readAmount(instruction)).toBe(1);
  });

  it("treats an unrelated expression as 设为, not a mangled increment", () => {
    expect(readMode({ t: "set", key: "affection", expr: "bonus * 2" })).toBe("assign");
  });

  it("does not mistake another variable's increment for its own", () => {
    // `affection_yuki + 3` 里的 affection_yuki 不是 affection。
    expect(readMode({ t: "set", key: "affection", expr: "affection_yuki + 3" })).toBe("assign");
  });

  it("writes increments as an expression and 设为 as a literal", () => {
    const base: SetInstr = { t: "set", key: "affection", value: 0 };
    expect(writeMode(base, "increase", 3)).toEqual({ t: "set", key: "affection", id: undefined, expr: "affection + 3" });
    expect(writeMode(base, "decrease", 1)).toEqual({ t: "set", key: "affection", id: undefined, expr: "affection - 1" });
    expect(writeMode(base, "assign", 50)).toEqual({ t: "set", key: "affection", id: undefined, value: 50 });
  });

  it("survives a full read-write-read cycle", () => {
    const written = writeMode({ t: "set", key: "affection", value: 0 }, "increase", 7);
    expect(readMode(written)).toBe("increase");
    expect(readAmount(written)).toBe(7);
  });

  it("keeps the stable instruction id through a mode change", () => {
    const written = writeMode({ t: "set", key: "affection", id: "sp_1", value: 0 }, "increase", 2);
    expect(written.id).toBe("sp_1");
  });
});
