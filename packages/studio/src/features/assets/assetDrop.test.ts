import { describe, expect, it } from "vitest";
import {
  fileExtension,
  inferAssetKindFromFileName,
  isRegistrableSection,
  planAssetDrop,
} from "./assetDrop";

describe("fileExtension", () => {
  it("取最后一个点后的扩展名并小写化", () => {
    expect(fileExtension("pic.PNG")).toBe("png");
    expect(fileExtension("archive.tar.gz")).toBe("gz");
    expect(fileExtension("noext")).toBe("");
  });
});

describe("inferAssetKindFromFileName", () => {
  it("图片推断为 background", () => {
    expect(inferAssetKindFromFileName("sky.png")).toBe("background");
    expect(inferAssetKindFromFileName("photo.JPG")).toBe("background");
    expect(inferAssetKindFromFileName("anim.svg")).toBe("background");
  });

  it("音频统一推断为 bgm（sfx/voice 无法从扩展名区分）", () => {
    expect(inferAssetKindFromFileName("theme.mp3")).toBe("bgm");
    expect(inferAssetKindFromFileName("click.ogg")).toBe("bgm");
    expect(inferAssetKindFromFileName("line01.wav")).toBe("bgm");
  });

  it("视频与字体各自归类", () => {
    expect(inferAssetKindFromFileName("op.mp4")).toBe("video");
    expect(inferAssetKindFromFileName("clip.webm")).toBe("video");
    expect(inferAssetKindFromFileName("rounded.woff2")).toBe("font");
    expect(inferAssetKindFromFileName("serif.otf")).toBe("font");
  });

  it("未知类型返回 null", () => {
    expect(inferAssetKindFromFileName("readme.txt")).toBeNull();
    expect(inferAssetKindFromFileName("script")).toBeNull();
  });
});

describe("isRegistrableSection", () => {
  it("overview / character / unknown 不可作为导入目标", () => {
    expect(isRegistrableSection("overview")).toBe(false);
    expect(isRegistrableSection("character")).toBe(false);
    expect(isRegistrableSection("unknown")).toBe(false);
  });

  it("具体分类可作为导入目标", () => {
    expect(isRegistrableSection("background")).toBe(true);
    expect(isRegistrableSection("sfx")).toBe(true);
    expect(isRegistrableSection("animation")).toBe(true);
  });
});

describe("planAssetDrop", () => {
  it("具体分类下所有文件归入该分类（与导入按钮一致）", () => {
    const plan = planAssetDrop(["/a/sky.png", "/a/theme.mp3"], "background");
    expect(plan.rejected).toEqual([]);
    expect(plan.items).toEqual([
      { src: "/a/sky.png", kind: "background" },
      { src: "/a/theme.mp3", kind: "background" },
    ]);
  });

  it("总览下按扩展名推断，未知类型进入 rejected", () => {
    const plan = planAssetDrop(["/a/sky.png", "/a/theme.mp3", "/a/readme.txt"], "overview");
    expect(plan.items).toEqual([
      { src: "/a/sky.png", kind: "background" },
      { src: "/a/theme.mp3", kind: "bgm" },
    ]);
    expect(plan.rejected).toEqual(["readme.txt"]);
  });

  it("Windows 反斜杠路径也能取到文件名", () => {
    const plan = planAssetDrop(["C:\\art\\sky.png"], "overview");
    expect(plan.items).toEqual([{ src: "C:\\art\\sky.png", kind: "background" }]);
  });
});
