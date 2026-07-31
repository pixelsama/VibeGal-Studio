import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TokenEditorPanel } from "./TokenEditorPanel";
import { APPEARANCE_GROUP_PREFS_STORAGE_KEY } from "../../lib/appearanceGroupPrefs";
import { StudioI18nProvider } from "../../lib/i18n";
import type { TokenGroupDef } from "./appearanceTokens";

const noop = () => {};

function renderPanel(groups?: TokenGroupDef[]): string {
  return renderToStaticMarkup(createElement(
    StudioI18nProvider,
    { preference: "zh-CN" },
    createElement(TokenEditorPanel, { tokens: {}, onEdit: noop, ...(groups ? { groups } : {}) }),
  ));
}

const openDetails = (html: string) => (html.match(/<details[^>]*open/g) ?? []).length;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TokenEditorPanel 组级折叠（Spec 33 §6.4）", () => {
  it("默认展开核心四组，其余组折叠（组标题始终可见）", () => {
    const html = renderPanel();

    // 组级 details：默认展开集 = dialogueBox/nameBox/choiceBox/stage
    expect(openDetails(html)).toBe(4);
    expect(html).toMatch(/<details[^>]*open[^>]*><summary[^>]*>对话框<\/summary>/);
    expect(html).toMatch(/<details[^>]*open[^>]*><summary[^>]*>名字框<\/summary>/);
    expect(html).toMatch(/<details[^>]*open[^>]*><summary[^>]*>选项区<\/summary>/);
    expect(html).toMatch(/<details[^>]*open[^>]*><summary[^>]*>舞台<\/summary>/);
    // 其余组折叠，但 summary 仍在（可发现）
    expect(html).toMatch(/<details(?![^>]*open)[^>]*><summary[^>]*>选项按钮<\/summary>/);
    expect(html).toMatch(/<details(?![^>]*open)[^>]*><summary[^>]*>HUD<\/summary>/);
    expect(html).toMatch(/<details(?![^>]*open)[^>]*><summary[^>]*>标题画面<\/summary>/);
  });

  it("localStorage 覆盖生效：折叠对话框、展开标题画面", () => {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) =>
        key === APPEARANCE_GROUP_PREFS_STORAGE_KEY
          ? JSON.stringify({ collapsedOverrides: { dialogueBox: true, titleScreen: false } })
          : null,
      setItem: () => {},
    });

    const html = renderPanel();
    expect(html).toMatch(/<details(?![^>]*open)[^>]*><summary[^>]*>对话框<\/summary>/);
    expect(html).toMatch(/<details[^>]*open[^>]*><summary[^>]*>标题画面<\/summary>/);
  });

  it("groups prop 过滤后只渲染传入的组", () => {
    const html = renderPanel([{
      id: "hud",
      title: "HUD",
      fields: [{ key: "hud.x", label: "X", kind: "number", step: 1 }],
    }]);

    // hud 不在默认展开集 → 组以折叠形态渲染，但 summary 可见
    expect(html).toMatch(/<details(?![^>]*open)[^>]*><summary[^>]*>HUD<\/summary>/);
    expect(html).not.toContain("对话框");
  });
});
