import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  isStageDraftDirty,
  isProjectSettingsDraftDirty,
  loadStageSettingsDraft,
  loadProjectSettingsDraft,
  projectSettingsDraftStorageKey,
  readProjectMetaSettings,
  saveProjectSettings,
  saveProjectStageResolution,
  withProjectMetaSettings,
  ProjectSettings,
} from "./ProjectSettings";
import type { DraftStorage } from "../../lib/draftRecovery";
import type { ProjectData } from "../../lib/types";

const project: ProjectData = {
  path: "/project",
  meta: { name: "T", activeRendererId: "default", createdAt: "0" },
  content: {
    manifest: { characters: {}, backgrounds: {}, audio: { bgm: {}, sfx: {}, voice: {} } },
    meta: { title: "T", typingSpeedCps: 30, autoAdvanceMs: 1200, chapterGapMs: 1500 },
  },
  rendererIds: ["default"],
  metaRevision: { relPath: "content/meta.json", mtimeMs: 1, size: 10 },
};

describe("ProjectSettings", () => {
  it("renders project-level stage resolution controls", () => {
    const html = renderToStaticMarkup(<ProjectSettings project={project} onSaved={() => {}} />);

    expect(html).toContain("项目");
    expect(html).toContain("项目标题");
    expect(html).toContain("默认打字速度");
    expect(html).toContain("默认自动播放间隔");
    expect(html).toContain("章节间隔");
    expect(html).toContain("舞台分辨率");
    expect(html).toContain("1280 x 720");
    expect(html).toContain("1920 x 1080");
  });

  it("reads project-level meta settings with defaults for missing fields", () => {
    expect(readProjectMetaSettings({ title: "Game", typingSpeedCps: 24, autoAdvanceMs: 900, chapterGapMs: 600, stage: { width: 960, height: 540 } }))
      .toEqual({
        title: "Game",
        typingSpeedCps: 24,
        autoAdvanceMs: 900,
        chapterGapMs: 600,
        stage: { width: 960, height: 540 },
      });
    expect(readProjectMetaSettings({})).toEqual({
      title: "",
      typingSpeedCps: 30,
      autoAdvanceMs: 1200,
      chapterGapMs: 1500,
      stage: { width: 1280, height: 720 },
    });
  });

  it("writes full project settings while preserving unknown meta fields", () => {
    expect(withProjectMetaSettings(
      { custom: true, title: "Old" },
      {
        title: "New",
        typingSpeedCps: 42,
        autoAdvanceMs: 800,
        chapterGapMs: 500,
        stage: { width: 1920, height: 1080 },
      },
    )).toEqual({
      custom: true,
      title: "New",
      typingSpeedCps: 42,
      autoAdvanceMs: 800,
      chapterGapMs: 500,
      stage: { width: 1920, height: 1080 },
    });
  });

  it("saves full project settings to content/meta.json with the meta revision", async () => {
    const saveFileFn = vi.fn(async () => {});

    await saveProjectSettings({
      project,
      settings: {
        title: "Weapon Girl",
        typingSpeedCps: 36,
        autoAdvanceMs: 750,
        chapterGapMs: 300,
        stage: { width: 1920, height: 1080 },
      },
      saveFileFn,
    });

    expect(saveFileFn).toHaveBeenCalledWith(
      "/project",
      "content/meta.json",
      JSON.stringify({
        title: "Weapon Girl",
        typingSpeedCps: 36,
        autoAdvanceMs: 750,
        chapterGapMs: 300,
        stage: { width: 1920, height: 1080 },
      }, null, 2),
      project.metaRevision,
    );
  });

  it("saves stage resolution to content/meta.json with the meta revision", async () => {
    const saveFileFn = vi.fn(async () => {});

    await saveProjectStageResolution({
      project,
      stage: { width: 1920, height: 1080 },
      saveFileFn,
    });

    expect(saveFileFn).toHaveBeenCalledWith(
      "/project",
      "content/meta.json",
      JSON.stringify({
        title: "T",
        typingSpeedCps: 30,
        autoAdvanceMs: 1200,
        chapterGapMs: 1500,
        stage: { width: 1920, height: 1080 },
      }, null, 2),
      project.metaRevision,
    );
  });

  it("treats invalid and changed stage inputs as unsaved drafts", () => {
    expect(isStageDraftDirty({ width: 1280, height: 720 }, "1280", "720")).toBe(false);
    expect(isStageDraftDirty({ width: 1280, height: 720 }, "1920", "1080")).toBe(true);
    expect(isStageDraftDirty({ width: 1280, height: 720 }, "", "720")).toBe(true);
  });

  it("treats changed project setting fields as unsaved drafts", () => {
    const base = readProjectMetaSettings(project.content.meta);

    expect(isProjectSettingsDraftDirty(base, {
      titleText: "T",
      typingSpeedText: "30",
      autoAdvanceText: "1200",
      chapterGapText: "1500",
      widthText: "1280",
      heightText: "720",
    })).toBe(false);
    expect(isProjectSettingsDraftDirty(base, {
      titleText: "New",
      typingSpeedText: "30",
      autoAdvanceText: "1200",
      chapterGapText: "1500",
      widthText: "1280",
      heightText: "720",
    })).toBe(true);
  });

  it("restores a valid project settings draft from session storage", () => {
    const storage: DraftStorage = {
      getItem: () => JSON.stringify({ version: 1, widthText: "1920", heightText: "1080" }),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };

    expect(loadStageSettingsDraft(storage, "draft-key")).toEqual({
      version: 1,
      widthText: "1920",
      heightText: "1080",
    });
  });

  it("restores a valid full project settings draft from session storage", () => {
    const storage: DraftStorage = {
      getItem: () => JSON.stringify({
        version: 2,
        titleText: "Weapon Girl",
        typingSpeedText: "36",
        autoAdvanceText: "750",
        chapterGapText: "300",
        widthText: "1920",
        heightText: "1080",
      }),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };

    expect(loadProjectSettingsDraft(storage, "draft-key")).toEqual({
      version: 2,
      titleText: "Weapon Girl",
      typingSpeedText: "36",
      autoAdvanceText: "750",
      chapterGapText: "300",
      widthText: "1920",
      heightText: "1080",
    });
  });

  it("isolates recovered settings drafts by project path", () => {
    expect(projectSettingsDraftStorageKey("/project-a"))
      .not.toBe(projectSettingsDraftStorageKey("/project-b"));
  });
});
