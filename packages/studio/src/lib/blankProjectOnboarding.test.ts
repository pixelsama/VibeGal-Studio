import { describe, expect, it, vi } from "vitest";
import type { ProjectData } from "./types";
import {
  INITIAL_BLANK_PROJECT_ONBOARDING,
  blankProjectOnboardingStorageKey,
  hasImportedBackground,
  hasWrittenBlankProjectEntry,
  isOriginalBlankStarter,
  loadBlankProjectOnboarding,
  saveBlankProjectOnboarding,
} from "./blankProjectOnboarding";

function blankProject(path = "/projects/story"): ProjectData {
  return {
    path,
    meta: { name: "Story", activeRendererId: "default", createdAt: "0" },
    content: {
      manifest: { characters: {}, backgrounds: {}, audio: { bgm: {}, sfx: {}, voice: {} } },
      meta: {},
      variables: {} as ProjectData["content"]["variables"],
    },
    rendererIds: ["default"],
    graph: {
      version: 1,
      entryNodeId: "start",
      chapters: [{ id: "chapter_1", title: "第一章" }],
      nodes: [{ id: "start", title: "开始", file: "nodes/start.json", position: { x: 0, y: 0 }, chapterId: "chapter_1" }],
      edges: [],
    },
    nodes: [{
      relPath: "nodes/start.json",
      data: [{ t: "narrate", id: "sp_generated", text: "新的故事从这里开始。" }],
    }],
  };
}

describe("blank project onboarding persistence", () => {
  it("scopes records by canonical project path", () => {
    expect(blankProjectOnboardingStorageKey("/projects/a")).not.toBe(
      blankProjectOnboardingStorageKey("/projects/b"),
    );

    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    const completed = { ...INITIAL_BLANK_PROJECT_ONBOARDING, previewConfirmed: true };
    saveBlankProjectOnboarding("/projects/a", completed, storage);

    expect(loadBlankProjectOnboarding("/projects/a", storage)).toEqual(completed);
    expect(loadBlankProjectOnboarding("/projects/b", storage)).toBeNull();

    const skipped = { ...INITIAL_BLANK_PROJECT_ONBOARDING, skipped: true };
    saveBlankProjectOnboarding("/projects/b", skipped, storage);
    expect(loadBlankProjectOnboarding("/projects/b", storage)).toEqual(skipped);
  });

  it("degrades safely when storage is corrupt or throws", () => {
    expect(loadBlankProjectOnboarding("/projects/a", {
      getItem: () => "not-json",
      setItem: () => {},
    })).toBeNull();
    expect(loadBlankProjectOnboarding("/projects/a", {
      getItem: () => JSON.stringify({ version: 1, previewConfirmed: "yes" }),
      setItem: () => {},
    })).toBeNull();

    const throwingStorage = {
      getItem: vi.fn(() => { throw new Error("denied"); }),
      setItem: vi.fn(() => { throw new Error("full"); }),
    };
    expect(loadBlankProjectOnboarding("/projects/a", throwingStorage)).toBeNull();
    expect(() => saveBlankProjectOnboarding(
      "/projects/a",
      INITIAL_BLANK_PROJECT_ONBOARDING,
      throwingStorage,
    )).not.toThrow();
  });
});

describe("blank project onboarding completion", () => {
  it("ignores the machine-managed story-point ID when recognizing the starter", () => {
    expect(isOriginalBlankStarter([
      { t: "narrate", id: "sp_one", text: "新的故事从这里开始。" },
    ])).toBe(true);
    expect(hasWrittenBlankProjectEntry(blankProject())).toBe(false);
  });

  it("completes writing after the starter entry node changes", () => {
    const project = blankProject();
    project.nodes = [{ relPath: "content/nodes/start.json", data: [
      { t: "narrate", id: "sp_one", text: "雨停了。" },
    ] }];

    expect(hasWrittenBlankProjectEntry(project)).toBe(true);
  });

  it("does not turn missing or invalid entry data into a completed writing step", () => {
    const project = blankProject();
    project.nodes = [{ relPath: "nodes/start.json", data: null }];
    expect(hasWrittenBlankProjectEntry(project)).toBe(false);

    project.graph = undefined;
    expect(hasWrittenBlankProjectEntry(project)).toBe(false);
  });

  it("completes the background step only when a background is registered", () => {
    const project = blankProject();
    expect(hasImportedBackground(project)).toBe(false);

    project.content.manifest.backgrounds.sky = { path: "assets/backgrounds/sky.png" };
    expect(hasImportedBackground(project)).toBe(true);
  });
});
