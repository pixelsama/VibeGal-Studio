import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProjectData } from "../../lib/types";
import { TranslationComparison } from "./TranslationComparison";

const project: ProjectData = {
  path: "/project",
  meta: { name: "T", activeRendererId: "default", createdAt: "0" },
  content: {
    manifest: { characters: {}, backgrounds: {}, audio: { bgm: {}, sfx: {}, voice: {} } },
    meta: { locale: { default: "zh-CN", available: ["zh-CN", "en"] } },
    variables: { version: 1, variables: {} },
  },
  rendererIds: ["default"],
  graph: {
    version: 1,
    entryNodeId: "opening",
    chapters: [{ id: "chapter-1", title: "第一章" }],
    nodes: [{ id: "opening", title: "开场", file: "nodes/opening.json", position: { x: 0, y: 0 }, chapterId: "chapter-1" }],
    edges: [],
  },
  nodes: [{ relPath: "nodes/opening.json", data: [
    { t: "say", id: "hello", who: "hero", expr: "default", text: "早上好。", textKey: "opening.hello" },
    { t: "narrate", text: "风停了。" },
  ] }],
  locales: [{ locale: "en", relPath: "content/locales/en.json", value: { "opening.hello": "Good morning." } }],
};

describe("TranslationComparison", () => {
  it("renders side-by-side source translation and semantic diagnostics", () => {
    const html = renderToStaticMarkup(createElement(TranslationComparison, {
      project,
      onAssignKey: async () => {},
      onSaveLocale: async () => {},
    }));

    expect(html).toContain('aria-label="翻译对照"');
    expect(html).toContain("第一章 / 开场 / hello");
    expect(html).toContain("早上好。");
    expect(html).toContain("Good morning.");
    expect(html).toContain("未分配 key：1");
    expect(html).toContain("生成稳定 key");
  });
});
