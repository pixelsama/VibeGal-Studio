import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  isStageDraftDirty,
  isProjectSettingsDraftDirty,
  loadStageSettingsDraft,
  loadProjectSettingsDraft,
  projectSettingsDraftStorageKey,
  readProjectMetaSettings,
  repairProjectSupportFiles,
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

    expect(html).toContain("项目设置");
    expect(html).toContain('class="gs-settings-grid"');
    expect(html.match(/class="gs-settings-card"/g)).toHaveLength(3);
    expect(html).toContain('class="gs-selected-surface"');
    expect(html).toContain("作品标题");
    expect(html).toContain("默认打字速度");
    expect(html).toContain("默认自动播放间隔");
    expect(html).toContain("章节间隔");
    expect(html).toContain("舞台分辨率");
    expect(html).toContain("导出信息");
    expect(html).toContain("作品版本");
    expect(html).toContain("安装包名称");
    expect(html).toContain("图标路径");
    expect(html).toContain("窗口适配");
    expect(html).toContain("1280 x 720");
    expect(html).toContain("1920 x 1080");
  });

  it("自动保存后不再有手动保存按钮（Spec 33 §6.1）", () => {
    const html = renderToStaticMarkup(<ProjectSettings project={project} onSaved={() => {}} />);

    expect(html).not.toContain("保存");
    expect(html).not.toContain("保存中");
  });

  it("warns without modifying an existing gitignore that tracks private project state", () => {
    const html = renderToStaticMarkup(
      <ProjectSettings
        project={{ ...project, galstudioIgnored: false }}
        onSaved={() => {}}
      />,
    );

    expect(html).toContain(".galstudio 尚未忽略");
    expect(html).toContain(".galstudio/");
    expect(html).toContain("不会自动修改既有文件");
  });

  it("shows missing support files without writing until the creator repairs them", async () => {
    const repair = vi.fn(async () => [".galstudio/schemas/variables.json"]);
    const incompleteProject: ProjectData = {
      ...project,
      missingSupportFiles: [".galstudio/schemas/variables.json"],
    };

    const html = renderToStaticMarkup(
      <ProjectSettings project={incompleteProject} onSaved={() => {}} />,
    );
    expect(html).toContain("项目辅助文件不完整");
    expect(html).toContain(".galstudio/schemas/variables.json");
    expect(html).toContain("一键补齐");
    expect(repair).not.toHaveBeenCalled();

    await expect(repairProjectSupportFiles("/project", repair)).resolves.toEqual([
      ".galstudio/schemas/variables.json",
    ]);
    expect(repair).toHaveBeenCalledWith("/project");
  });

  it("reads project-level meta settings with defaults for missing fields", () => {
    expect(readProjectMetaSettings({ title: "Game", typingSpeedCps: 24, autoAdvanceMs: 900, chapterGapMs: 600, stage: { width: 960, height: 540 } }))
      .toEqual({
        title: "Game",
        typingSpeedCps: 24,
        autoAdvanceMs: 900,
        chapterGapMs: 600,
        stage: { width: 960, height: 540 },
        distribution: { version: "0.1.0" },
      });
    expect(readProjectMetaSettings({})).toEqual({
      title: "",
      typingSpeedCps: 30,
      autoAdvanceMs: 1200,
      chapterGapMs: 1500,
      stage: { width: 1280, height: 720 },
      distribution: { version: "0.1.0" },
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
        distribution: {
          version: "1.2.3",
          productName: "Export Name",
          icon: "assets/icon.png",
          viewport: { mode: "fill", width: 1920, height: 1080 },
        },
      },
    )).toEqual({
      custom: true,
      title: "New",
      typingSpeedCps: 42,
      autoAdvanceMs: 800,
      chapterGapMs: 500,
      stage: { width: 1920, height: 1080 },
      distribution: {
        version: "1.2.3",
        productName: "Export Name",
        icon: "assets/icon.png",
        viewport: { mode: "fill", width: 1920, height: 1080 },
      },
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
        distribution: { version: "0.1.0" },
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
        distribution: { version: "0.1.0" },
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
      distributionVersionText: "0.1.0",
      distributionProductNameText: "",
      distributionIconText: "",
      distributionViewportMode: "fit",
      distributionViewportWidthText: "1280",
      distributionViewportHeightText: "720",
    })).toBe(false);
    expect(isProjectSettingsDraftDirty(base, {
      titleText: "New",
      typingSpeedText: "30",
      autoAdvanceText: "1200",
      chapterGapText: "1500",
      widthText: "1280",
      heightText: "720",
      distributionVersionText: "0.1.0",
      distributionProductNameText: "",
      distributionIconText: "",
      distributionViewportMode: "fit",
      distributionViewportWidthText: "1280",
      distributionViewportHeightText: "720",
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
        version: 3,
        titleText: "Weapon Girl",
        typingSpeedText: "36",
        autoAdvanceText: "750",
        chapterGapText: "300",
        widthText: "1920",
        heightText: "1080",
        distributionVersionText: "1.2.3",
        distributionProductNameText: "Export Name",
        distributionIconText: "assets/icon.png",
        distributionViewportMode: "fill",
        distributionViewportWidthText: "1920",
        distributionViewportHeightText: "1080",
      }),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };

    expect(loadProjectSettingsDraft(storage, "draft-key")).toEqual({
      version: 3,
      titleText: "Weapon Girl",
      typingSpeedText: "36",
      autoAdvanceText: "750",
      chapterGapText: "300",
      widthText: "1920",
      heightText: "1080",
      distributionVersionText: "1.2.3",
      distributionProductNameText: "Export Name",
      distributionIconText: "assets/icon.png",
      distributionViewportMode: "fill",
      distributionViewportWidthText: "1920",
      distributionViewportHeightText: "1080",
    });
  });

  it("isolates recovered settings drafts by project path", () => {
    expect(projectSettingsDraftStorageKey("/project-a"))
      .not.toBe(projectSettingsDraftStorageKey("/project-b"));
  });
});
