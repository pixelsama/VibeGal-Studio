import { describe, expect, it, vi } from "vitest";
import { createExclusiveAudioPreviewController, describeAudioAsset } from "./AssetAudioPreview";

describe("describeAudioAsset", () => {
  it("formats file size and extension metadata for audio previews", () => {
    expect(describeAudioAsset("assets/audio/bgm/theme.mp3", 2_048)).toEqual({
      format: "MP3",
      size: "2.0 KB",
    });
  });
});

describe("createExclusiveAudioPreviewController", () => {
  it("pauses the previous preview when a new one starts playing", () => {
    const controller = createExclusiveAudioPreviewController();
    const first = { pause: vi.fn() };
    const second = { pause: vi.fn() };

    controller.requestPlayback("first", first);
    controller.requestPlayback("second", second);

    expect(first.pause).toHaveBeenCalledTimes(1);
    expect(second.pause).not.toHaveBeenCalled();
  });
});
