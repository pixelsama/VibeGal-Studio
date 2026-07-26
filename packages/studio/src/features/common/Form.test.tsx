import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Field, NumberInput, SegmentedControl, Select, Slider, Stepper, Switch, SentenceRow, SentenceWord, TextInput } from "./Form";

const html = (element: React.ReactElement) => renderToStaticMarkup(element);

describe("Field", () => {
  it("associates the label with the control and describes it with the hint", () => {
    const markup = html(createElement(Field, {
      label: "显示名称",
      hint: "玩家看不到这个名字",
      children: ({ id, describedBy }) => createElement(TextInput, { id, describedBy, value: "雪", onChange: () => {} }),
    }));
    const forId = /for="([^"]+)"/.exec(markup)?.[1];
    expect(forId).toBeTruthy();
    expect(markup).toContain(`id="${forId}"`);
    expect(markup).toContain("玩家看不到这个名字");
    expect(markup).toMatch(/aria-describedby="[^"]+-message"/);
  });

  it("replaces the hint with an alert when there is an error", () => {
    const markup = html(createElement(Field, {
      label: "上限",
      hint: "留空表示不限",
      error: "上限不能小于下限",
      children: ({ id, describedBy, invalid }) => createElement(NumberInput, { id, describedBy, invalid, value: 5, onChange: () => {} }),
    }));
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("上限不能小于下限");
    expect(markup).not.toContain("留空表示不限");
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain("gs-input--invalid");
  });
});

describe("Select", () => {
  it("groups options under their group label", () => {
    const markup = html(createElement(Select, {
      "aria-label": "变量",
      value: "affection",
      options: [
        { value: "affection", label: "好感度", group: "数值" },
        { value: "route", label: "当前路线", group: "状态" },
      ],
      onChange: () => {},
    }));
    expect(markup).toContain('<optgroup label="数值">');
    expect(markup).toContain('<optgroup label="状态">');
    expect(markup).toContain("好感度");
  });

  it("keeps a dangling reference visible and marks it invalid", () => {
    const markup = html(createElement(Select, {
      "aria-label": "变量",
      value: "deleted_variable",
      options: [{ value: "affection", label: "好感度" }],
      onChange: () => {},
    }));
    expect(markup).toContain("deleted_variable（已失效）");
    expect(markup).toContain('aria-invalid="true"');
  });
});

describe("Switch", () => {
  it("renders a switch role with the checked state and its text", () => {
    const markup = html(createElement(Switch, { "aria-label": "拿到钥匙", checked: true, label: "是", onChange: () => {} }));
    expect(markup).toContain('role="switch"');
    expect(markup).toContain('checked=""');
    expect(markup).toContain("gs-switch__track");
    expect(markup).toContain("是");
  });
});

describe("SegmentedControl", () => {
  it("exposes the active option as the checked radio", () => {
    const markup = html(createElement(SegmentedControl<"choice" | "auto">, {
      "aria-label": "结束方式",
      value: "auto",
      options: [
        { value: "choice", label: "让玩家选择" },
        { value: "auto", label: "按故事状态自动分流" },
      ],
      onChange: () => {},
    }));
    expect(markup).toContain('role="radiogroup"');
    expect(markup).toMatch(/aria-checked="true"[^>]*>按故事状态自动分流/);
    expect(markup).toMatch(/aria-checked="false"[^>]*>让玩家选择/);
  });
});

describe("Slider", () => {
  it("announces the band name instead of the raw number and draws its marks", () => {
    const markup = html(createElement(Slider, {
      "aria-label": "好感度",
      value: 62,
      min: 0,
      max: 100,
      valueLabel: "喜欢",
      marks: [{ value: 30, label: "在意" }, { value: 60, label: "喜欢" }],
      onChange: () => {},
    }));
    expect(markup).toContain('aria-valuetext="喜欢"');
    expect(markup).toContain("在意");
    // 60/100 的刻度定位到 60%。
    expect(markup).toContain("left:60%");
  });
});

describe("Stepper", () => {
  it("labels both buttons from the field name and disables at the bound", () => {
    const markup = html(createElement(Stepper, {
      "aria-label": "好感度",
      value: 100,
      min: 0,
      max: 100,
      onChange: () => {},
    }));
    expect(markup).toContain('aria-label="好感度 增加"');
    expect(markup).toContain('aria-label="好感度 减少"');
    // 已到上限：增加按钮禁用，减少按钮可用。
    expect(markup).toMatch(/aria-label="好感度 增加"[^>]*disabled/);
    expect(markup).not.toMatch(/aria-label="好感度 减少"[^>]*disabled/);
  });
});

describe("SentenceRow", () => {
  it("keeps the lead word, body and trailing actions in one line container", () => {
    const markup = html(createElement(SentenceRow, {
      lead: "如果",
      trailing: createElement("button", null, "删除"),
      children: [
        createElement(SentenceWord, { key: "w" }, "达到"),
        createElement("span", { key: "v" }, "喜欢"),
      ],
    }));
    expect(markup).toContain("gs-sentence__lead");
    expect(markup).toContain("如果");
    expect(markup).toContain("gs-sentence__word");
    expect(markup).toContain("gs-sentence__trailing");
    expect(markup).toContain("删除");
  });
});
