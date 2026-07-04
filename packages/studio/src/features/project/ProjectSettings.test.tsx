import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { saveProjectStageResolution, ProjectSettings } from "./ProjectSettings";
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
    expect(html).toContain("舞台分辨率");
    expect(html).toContain("1280 x 720");
    expect(html).toContain("1920 x 1080");
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
});
