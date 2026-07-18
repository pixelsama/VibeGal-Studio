import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildSnapshotScenes,
  customSceneFromFixture,
  fixturePersistentToGlobal,
  FIXTURE_UI_PANELS,
} from "./snapshotScenes";
import { GlobalPersistentRecordSchema, type Manifest, type NovelState } from "@vibegal/engine";

/** 与引擎 createInitialState 同形的最小合法快照。 */
function minimalState(): NovelState {
  return {
    vars: {},
    background: null,
    backgroundTrans: "fade",
    backgroundMs: 1000,
    sprites: [],
    speaker: null,
    dialogue: null,
    narration: null,
    choice: null,
    effects: [],
    transitions: [],
    audio: { bgm: null, sfx: [], voice: null },
    flags: {
      isWaiting: false,
      isAutoPlay: false,
      skipMode: "off",
      isRecording: false,
      chapterIndex: 0,
      progress: { current: 0, total: 0 },
    },
    currentCueMs: null,
  };
}

describe("customSceneFromFixture", () => {
  it("title 提供时：id 用文件名、title 用文件 title，persistent/uiHint 透传归一化", () => {
    const state = minimalState();
    const scene = customSceneFromFixture(
      {
        title: "黎明重逢",
        state,
        persistent: { unlock: { cg: ["smoke_ocean"] } },
        uiHint: { panel: "gallery-cg" },
      },
      "dawn-reunion",
    );

    expect(scene.id).toBe("dawn-reunion");
    expect(scene.title).toBe("黎明重逢");
    expect(scene.state).toBe(state);
    // 缺省的 unlock 数组补 []，宿主拿到的永远是四元组
    expect(scene.persistent).toEqual({
      unlock: { cg: ["smoke_ocean"], music: [], replay: [], endings: [] },
    });
    expect(scene.uiHint).toEqual({ panel: "gallery-cg" });
  });

  it("title 缺失时 id 与 title 都用文件名，可选通道不出现", () => {
    const scene = customSceneFromFixture({ state: minimalState() }, "opening");

    expect(scene.id).toBe("opening");
    expect(scene.title).toBe("opening");
    expect(scene.persistent).toBeUndefined();
    expect(scene.uiHint).toBeUndefined();
  });

  it("缺少 state 时报错且带文件信息", () => {
    expect(() => customSceneFromFixture({ title: "无状态" }, "broken")).toThrowError(
      /broken.*state/,
    );
  });

  it("state 不是对象时报错", () => {
    expect(() => customSceneFromFixture({ state: "nope" }, "broken")).toThrowError(/state/);
    expect(() => customSceneFromFixture({ state: [] }, "broken")).toThrowError(/state/);
  });

  it("顶层不是对象时报错", () => {
    expect(() => customSceneFromFixture([], "broken")).toThrowError(/顶层/);
    expect(() => customSceneFromFixture(null, "broken")).toThrowError(/顶层/);
  });

  it("uiHint.panel 非法时报错，信息含全部合法枚举值", () => {
    let error: Error | null = null;
    try {
      customSceneFromFixture({ state: minimalState(), uiHint: { panel: "gallery" } }, "bad-panel");
    } catch (caught) {
      error = caught as Error;
    }
    expect(error).not.toBeNull();
    expect(error!.message).toContain("bad-panel");
    for (const panel of FIXTURE_UI_PANELS) {
      expect(error!.message).toContain(panel);
    }
  });

  it("persistent.unlock 数组含非字符串时报错", () => {
    expect(() =>
      customSceneFromFixture(
        { state: minimalState(), persistent: { unlock: { cg: ["ok", 1] } } },
        "bad-unlock",
      ),
    ).toThrowError(/persistent\.unlock\.cg/);
  });
});

/** 带两名角色、一张背景与完整 unlock 注册表的 manifest。 */
const manifest = {
  characters: {
    heroine: { name: "测试角色", color: "#ffcc00", sprites: { default: "c.png" } },
    rival: { name: "对手", color: "#00ccff", sprites: { default: "r.png" } },
  },
  backgrounds: { sky: "bg.png" },
  audio: { bgm: { theme: "t.ogg" }, sfx: {}, voice: {} },
  cg: {},
  videos: {},
  fonts: {},
  uiSkins: {},
  animationAtlases: {},
  unlocks: {
    cg: {
      cg_rooftop: { assetId: "cg_001", title: "Rooftop" },
      cg_beach: { assetId: "cg_002" },
    },
    music: { music_theme: { audioId: "theme", title: "Theme" } },
    replay: { replay_start: { nodeId: "start", title: "Opening" } },
    endings: { true_end: { title: "True End", nodeId: "ending" } },
  },
} satisfies Manifest;

const emptyManifest: Manifest = {
  characters: {},
  backgrounds: {},
  audio: { bgm: {}, sfx: {}, voice: {} },
  cg: {},
  videos: {},
  fonts: {},
  uiSkins: {},
  animationAtlases: {},
  unlocks: { cg: {}, music: {}, replay: {}, endings: {} },
};

describe("buildSnapshotScenes", () => {
  it("产出 4 剧情 + 7 面板场景，id 与标题顺序固定", () => {
    const scenes = buildSnapshotScenes(manifest);
    expect(scenes.map((scene) => scene.id)).toEqual([
      "dialogue", "narration", "choice", "sprites",
      "save", "history", "settings",
      "gallery-cg", "gallery-replay", "gallery-music", "gallery-endings",
    ]);
    expect(scenes.map((scene) => scene.title)).toEqual([
      "对话", "旁白", "选项", "多立绘",
      "存档", "历史", "设置", "CG 画廊", "场景回放", "音乐室", "结局列表",
    ]);
  });

  it("输出只依赖 manifest：两次调用深度相等", () => {
    expect(buildSnapshotScenes(manifest)).toEqual(buildSnapshotScenes(manifest));
  });

  it("面板场景：uiHint.panel 与 id 对应，底景与 dialogue 场景相同", () => {
    const scenes = buildSnapshotScenes(manifest);
    const dialogue = scenes.find((scene) => scene.id === "dialogue")!;
    for (const panel of FIXTURE_UI_PANELS) {
      const scene = scenes.find((item) => item.id === panel)!;
      expect(scene.uiHint).toEqual({ panel });
      expect(scene.state).toEqual(dialogue.state);
      expect(scene.state.background).toBe("sky");
      expect(scene.state.dialogue?.fullyRevealed).toBe(true);
    }
  });

  it("面板场景 unlock 快照填满 manifest 注册表全部 id；剧情场景不带附加通道", () => {
    const scenes = buildSnapshotScenes(manifest);
    for (const panel of FIXTURE_UI_PANELS) {
      const scene = scenes.find((item) => item.id === panel)!;
      expect(scene.persistent).toEqual({
        unlock: {
          cg: ["cg_rooftop", "cg_beach"],
          music: ["music_theme"],
          replay: ["replay_start"],
          endings: ["true_end"],
        },
      });
    }
    const dialogue = scenes.find((scene) => scene.id === "dialogue")!;
    expect(dialogue.persistent).toBeUndefined();
    expect(dialogue.uiHint).toBeUndefined();
    expect(dialogue.backlog).toBeUndefined();
  });

  it("历史面板场景带 3 条示例 backlog，其它场景不带 backlog", () => {
    const scenes = buildSnapshotScenes(manifest);
    const history = scenes.find((scene) => scene.id === "history")!;
    expect(history.backlog).toHaveLength(3);
    expect(history.backlog![0]).toMatchObject({
      id: "snapshot-backlog-1",
      storyPoint: { nodeId: "snapshot", instructionId: "line-1" },
      speakerName: "测试角色",
      createdOrder: 1,
    });
    expect(history.backlog!.every((entry) => typeof entry.text === "string" && entry.text.length > 0)).toBe(true);
    for (const scene of scenes) {
      if (scene.id !== "history") expect(scene.backlog).toBeUndefined();
    }
  });

  it("无注册表时 unlock 全空；无角色时底景退化为旁白、backlog 无说话人", () => {
    const scenes = buildSnapshotScenes(emptyManifest);
    const gallery = scenes.find((scene) => scene.id === "gallery-cg")!;
    expect(gallery.persistent).toEqual({ unlock: { cg: [], music: [], replay: [], endings: [] } });
    expect(gallery.state.dialogue).toBeNull();
    expect(gallery.state.narration?.fullyRevealed).toBe(true);
    const history = scenes.find((scene) => scene.id === "history")!;
    expect(history.backlog).toHaveLength(3);
    expect(history.backlog![0].speakerName).toBeUndefined();
  });
});

describe("fixturePersistentToGlobal", () => {
  it("无 persistent 时返回 undefined（引擎落默认值）", () => {
    expect(fixturePersistentToGlobal(undefined)).toBeUndefined();
  });

  it("瘦身 unlock 映射为 GlobalPersistentRecord 全形并通过引擎 schema 校验", () => {
    const record = fixturePersistentToGlobal(
      { unlock: { cg: ["a", "b"], music: ["m"], replay: [], endings: ["e"] } },
      "proj-1",
    );
    expect(record).toEqual({
      schemaVersion: 1,
      projectId: "proj-1",
      readText: [],
      unlockedCg: ["a", "b"],
      unlockedMusic: ["m"],
      unlockedReplays: [],
      unlockedEndings: ["e"],
      playthroughCount: 0,
    });
    expect(() => GlobalPersistentRecordSchema.parse(record)).not.toThrow();
  });

  it("projectId 有缺省值，且数组被复制而非引用入参", () => {
    const unlock = { cg: ["a"], music: [], replay: [], endings: [] };
    const record = fixturePersistentToGlobal({ unlock })!;
    expect(record.projectId).toBe("studio-fixture");
    expect(record.unlockedCg).toEqual(["a"]);
    expect(record.unlockedCg).not.toBe(unlock.cg);
  });
});

describe("probe 约束", () => {
  it("snapshotScenes.ts 保持零运行时 import（worker 单文件 probe 依赖这一点）", () => {
    const source = readFileSync(new URL("./snapshotScenes.ts", import.meta.url), "utf8");
    const valueImports = source.match(/^import\s+(?!type\b).*$/gm) ?? [];
    expect(valueImports).toEqual([]);
  });
});
