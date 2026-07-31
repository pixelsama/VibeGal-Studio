import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MANIFEST_SAVE_DEBOUNCE_MS, useAssetManifestDraft } from "./useAssetManifestDraft";
import type { Manifest, ProjectData } from "../../lib/types";

/**
 * 页面接线层测试（Spec 33 §6.1）：stageDraft → 防抖 → 落盘 的集成链路。
 * 用 SSR 捕获模式驱动 hook（useRef/useCallback 单次渲染可用），fake timers
 * 推进防抖窗口；save_manifest 由 @tauri-apps/api/core 的 invoke mock 拦截。
 * 撤销栈 / 外部变更 cancel 的语义由 usePageUndoHistory / useDebouncedCallback
 * 单测覆盖（窗口级 keydown 与 effect 在 SSR 下不执行）。
 */
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
  invoke: vi.fn(async () => ({ relPath: "content/manifest.json", mtimeMs: 1, size: 2 })),
}));

import { invoke } from "@tauri-apps/api/core";

const invokeMock = vi.mocked(invoke);

const project: ProjectData = {
  path: "/project",
  meta: { name: "T", activeRendererId: "default", createdAt: "0" },
  content: {
    manifest: {
      characters: {},
      backgrounds: { sky: "assets/backgrounds/sky.png" },
      audio: { bgm: {}, sfx: {}, voice: {} },
    },
    meta: {},
  },
  rendererIds: ["default"],
  manifestRevision: { relPath: "content/manifest.json", mtimeMs: 1, size: 10 },
};

const nextManifest = (patch: Partial<Manifest>): Manifest => ({
  ...project.content.manifest,
  ...patch,
});

type DraftApi = ReturnType<typeof useAssetManifestDraft>;

let api: DraftApi | null = null;

function Harness({ onSaved }: { onSaved: () => void }) {
  api = useAssetManifestDraft({
    project,
    onSaved,
    onDirtyChange: () => {},
    notify: () => {},
  });
  return null;
}

function mount(): DraftApi {
  api = null;
  renderToStaticMarkup(createElement(Harness, { onSaved: () => {} }));
  return api as DraftApi;
}

beforeEach(() => {
  invokeMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAssetManifestDraft auto-save (spec 33 §6.1)", () => {
  it("stageDraft 后经防抖窗口自动落盘，save_manifest 收到最新登记表", async () => {
    vi.useFakeTimers();
    const draftApi = mount();
    const next = nextManifest({ backgrounds: { ...project.content.manifest.backgrounds, night: "assets/backgrounds/night.png" } });

    draftApi.stageDraft(next);
    expect(invokeMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(MANIFEST_SAVE_DEBOUNCE_MS);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("save_manifest", expect.objectContaining({
      projectPath: "/project",
      manifest: next,
      expectedRevision: project.manifestRevision,
    }));
  });

  it("防抖窗口内连续 stageDraft 合并为一次落盘，只写最后状态", async () => {
    vi.useFakeTimers();
    const draftApi = mount();
    const first = nextManifest({ backgrounds: { ...project.content.manifest.backgrounds, a: "a.png" } });
    const second = nextManifest({ backgrounds: { ...project.content.manifest.backgrounds, b: "b.png" } });

    draftApi.stageDraft(first);
    await vi.advanceTimersByTimeAsync(400);
    draftApi.stageDraft(second);
    await vi.advanceTimersByTimeAsync(MANIFEST_SAVE_DEBOUNCE_MS);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("save_manifest", expect.objectContaining({ manifest: second }));
  });

  it("persistManifest 立即落盘（Cmd+S 走同一落盘路径，跳过防抖窗口）", async () => {
    vi.useFakeTimers();
    const draftApi = mount();
    const next = nextManifest({ cg: { ending: { path: "assets/cg/ending.png", name: "ending", tags: [] } } });

    draftApi.stageDraft(next);
    draftApi.persistManifest(next);
    await vi.advanceTimersByTimeAsync(0);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("save_manifest", expect.objectContaining({ manifest: next }));
  });
});
