import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Manifest } from "@vibegal/engine";
import { RuntimeMediaOverlay, runtimeMediaFromEffect } from "./RuntimeMediaOverlay";

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
    expect(html).toContain("关闭 CG");
  });

  it("does not offer skip for a non-skippable video", () => {
    const media = runtimeMediaFromEffect({ type: "playVideo", id: "intro" }, manifest, "/game/content");
    expect(media).toMatchObject({ type: "video", skippable: false });

    const html = renderToStaticMarkup(<RuntimeMediaOverlay media={media} onClose={vi.fn()} onSkip={vi.fn()} />);
    expect(html).toContain('<video src="/game/content/assets/video/intro.mp4"');
    expect(html).toContain('poster="/game/content/assets/video/intro.jpg"');
    expect(html).toContain(" controls");
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
    expect(html).toContain("跳过视频");
  });

  it("ignores unknown media ids instead of rendering a broken source", () => {
    expect(runtimeMediaFromEffect({ type: "showCg", id: "missing" }, manifest, "/game/content")).toBeNull();
    expect(runtimeMediaFromEffect({ type: "playVideo", id: "missing" }, manifest, "/game/content")).toBeNull();
  });
});
