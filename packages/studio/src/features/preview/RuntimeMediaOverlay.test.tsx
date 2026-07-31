import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Manifest } from "@vibegal/engine";
import { RuntimeMediaOverlay, runtimeMediaFromEffect, type RuntimeMediaState } from "./RuntimeMediaOverlay";

const manifest = {
  characters: {},
  backgrounds: {},
  audio: { bgm: {}, sfx: {}, voice: {} },
  cg: { rooftop: { path: "assets/cg/rooftop.png", name: "Rooftop" } },
  videos: {
    intro: { path: "assets/video/intro.mp4", poster: "assets/video/intro.jpg", skippable: false },
  },
  fonts: {},
  uiSkins: {},
  animationAtlases: {},
  unlocks: { cg: {}, music: {}, replay: {}, endings: {} },
} satisfies Manifest;

describe("runtime media overlay", () => {
  it("resolves showCg to a closeable image overlay", () => {
    const media = runtimeMediaFromEffect({ type: "showCg", id: "rooftop" }, manifest, "/game/content");
    expect(media).toEqual({
      type: "cg",
      id: "rooftop",
      src: "/game/content/assets/cg/rooftop.png",
      label: "Rooftop",
    });

    const html = renderToStaticMarkup(<RuntimeMediaOverlay media={media} onClose={vi.fn()} onSkip={vi.fn()} />);
    expect(html).toContain('<img src="/game/content/assets/cg/rooftop.png"');
    // 缺省 fallback 是中性英文（exporter 宿主无 Studio i18n）
    expect(html).toContain("Close");
  });

  it("does not offer skip for a non-skippable video", () => {
    const media = runtimeMediaFromEffect({ type: "playVideo", id: "intro" }, manifest, "/game/content");
    expect(media).toMatchObject({ type: "video", skippable: false });

    const html = renderToStaticMarkup(<RuntimeMediaOverlay media={media} onClose={vi.fn()} onSkip={vi.fn()} />);
    expect(html).toContain('<video src="/game/content/assets/video/intro.mp4"');
    expect(html).toContain('poster="/game/content/assets/video/intro.jpg"');
    expect(html).toContain(" controls");
    expect(html).not.toContain("Skip");
    expect(html).not.toContain("跳过视频");
  });

  it("instruction skippable overrides the manifest default", () => {
    const media = runtimeMediaFromEffect(
      { type: "playVideo", id: "intro", skippable: true },
      manifest,
      "/game/content",
    );

    expect(media).toMatchObject({ type: "video", skippable: true });
    const html = renderToStaticMarkup(<RuntimeMediaOverlay media={media} onClose={vi.fn()} onSkip={vi.fn()} />);
    expect(html).toContain("Skip");
  });

  it("ignores unknown media ids instead of rendering a broken source", () => {
    expect(runtimeMediaFromEffect({ type: "showCg", id: "missing" }, manifest, "/game/content")).toBeNull();
    expect(runtimeMediaFromEffect({ type: "playVideo", id: "missing" }, manifest, "/game/content")).toBeNull();
  });
});

describe("RuntimeMediaOverlay 文案注入（不依赖 Studio i18n，exporter 兼容）", () => {
  it("无 i18n provider 也能渲染（web 导出运行时宿主环境）", () => {
    const media: RuntimeMediaState = { type: "cg", id: "c1", src: "/cg.png", label: "CG1" };

    const html = renderToStaticMarkup(
      <RuntimeMediaOverlay media={media} onClose={vi.fn()} onSkip={vi.fn()} />,
    );

    expect(html).toContain('data-vibegal-media="cg"');
    expect(html).toContain("/cg.png");
    expect(html).toContain("CG1");
  });

  it("宿主注入的按钮文案生效（Studio 传 i18n 文案）", () => {
    const media: RuntimeMediaState = { type: "cg", id: "c1", src: "/cg.png", label: "CG1" };

    const html = renderToStaticMarkup(
      <RuntimeMediaOverlay
        media={media}
        onClose={vi.fn()}
        onSkip={vi.fn()}
        closeLabel="关闭 CG"
        skipLabel="跳过视频"
      />,
    );

    expect(html).toContain("关闭 CG");
  });

  it("缺省用中性英文文案（web 运行时 fallback，不依赖任何宿主文案系统）", () => {
    const media: RuntimeMediaState = { type: "video", id: "v1", src: "/v.mp4", skippable: true };

    const html = renderToStaticMarkup(
      <RuntimeMediaOverlay media={media} onClose={vi.fn()} onSkip={vi.fn()} />,
    );

    expect(html).toContain("Skip");
    expect(html).toContain('data-vibegal-video-loaded="pending"');
  });
});
