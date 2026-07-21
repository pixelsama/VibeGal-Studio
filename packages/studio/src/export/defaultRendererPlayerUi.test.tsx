import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  RuntimePersistenceError,
  createInMemoryRuntimeServices,
  createInitialState,
  type RuntimeServices,
  type SaveSlotSummary,
} from "@vibegal/engine";
import { PlayerHud } from "../../src-tauri/resources/default-renderer/PlayerHud";
import { EndingsPanel, GalleryPanel, MusicRoomPanel, ReplayPanel } from "../../src-tauri/resources/default-renderer/GalleryPanels";
import { HistoryPanel } from "../../src-tauri/resources/default-renderer/HistoryPanel";
import { PlayerMenu, SystemPanel, menuStyle } from "../../src-tauri/resources/default-renderer/PlayerMenu";
import { RuntimeSettingsPanel } from "../../src-tauri/resources/default-renderer/RuntimeSettingsPanel";
import { SaveLoadPanel } from "../../src-tauri/resources/default-renderer/SaveLoadPanel";
import { Stage } from "../../src-tauri/resources/default-renderer/Stage";
import { TitleScreen } from "../../src-tauri/resources/default-renderer/TitleScreen";
import { DEFAULT_UI_TOKENS } from "../../src-tauri/resources/default-renderer/useUiTokens";
import {
  MANUAL_SLOT_IDS,
  PLAYER_MENU_PAGES,
  PlayerUiController,
  buildPlayerSlots,
  createCurrentSavePreview,
  formatSlotTime,
  pickContinueSlot,
  readFixtureUiHintScreen,
  runtimeErrorDetails,
  isPlayerShortcutTarget,
  type TitleGateScreen,
} from "../../src-tauri/resources/default-renderer/playerUiModel";

function runtime(): RuntimeServices {
  return createInMemoryRuntimeServices({ getState: createInitialState });
}

describe("default renderer player UI", () => {
  it("exposesTheStableHudControlsAndRealPlaybackState", () => {
    const state = createInitialState();
    state.flags.isAutoPlay = true;
    state.flags.skipMode = "read";

    const html = renderToStaticMarkup(
      <PlayerHud
        state={state}
        busy={false}
        hud={DEFAULT_UI_TOKENS.hud}
        onOpenMenu={vi.fn()}
        onQuickSave={vi.fn()}
        onQuickLoad={vi.fn()}
        onToggleAuto={vi.fn()}
        onToggleReadSkip={vi.fn()}
        onToggleAllSkip={vi.fn()}
        onOpenHistory={vi.fn()}
      />,
    );

    expect(html).toContain("菜单");
    expect(html).toContain("快存");
    expect(html).toContain("快读");
    expect(html).toContain("自动 ON");
    expect(html).toContain("已读跳过 ON");
    expect(html).toContain("全文跳过 OFF");
    expect(html).toContain("历史");
  });

  it("definesTwelveManualSlotsAndTheThreeRuntimeSlots", () => {
    expect(MANUAL_SLOT_IDS).toEqual([
      "manual-01", "manual-02", "manual-03", "manual-04", "manual-05", "manual-06",
      "manual-07", "manual-08", "manual-09", "manual-10", "manual-11", "manual-12",
    ]);
    expect(PLAYER_MENU_PAGES.map((page) => page.id)).toEqual(["save", "history", "gallery", "replay", "music", "endings", "settings", "system"]);

    const saved: SaveSlotSummary[] = [{
      slotId: "manual-02",
      label: "Second slot",
      updatedAt: "2026-07-10T00:00:00.000Z",
      position: { nodeId: "start", instructionId: "line_02" },
      preview: { text: "Saved text", background: "school" },
    }];
    const slots = buildPlayerSlots(saved);

    expect(slots).toHaveLength(15);
    expect(slots.map((slot) => slot.slotId)).toEqual([
      "quick", "auto:node", "auto:choice", ...MANUAL_SLOT_IDS,
    ]);
    expect(slots.find((slot) => slot.slotId === "manual-02")).toEqual(expect.objectContaining({
      kind: "manual",
      empty: false,
      label: "Second slot",
      canDelete: true,
      canSave: true,
    }));
    expect(slots.find((slot) => slot.slotId === "auto:node")).toEqual(expect.objectContaining({
      kind: "auto",
      empty: true,
      canDelete: false,
      canSave: false,
    }));
  });

  it("buildsSavePreviewFromTheCurrentTextAndBackground", () => {
    const state = {
      ...createInitialState(),
      background: "school",
      narration: { text: "Current line", typedLen: 3, fullyRevealed: false },
    };

    expect(createCurrentSavePreview(state)).toEqual({ text: "Current line", background: "school" });
  });

  it("controllerUsesFixedQuickSlotAndRejectsReentry", async () => {
    let release: (() => void) | undefined;
    const services = runtime();
    const save = vi.spyOn(services.save, "save").mockImplementation(() => new Promise((resolve) => {
      release = () => resolve({
        slotId: "quick",
        label: "Quick Save",
        updatedAt: "2026-07-10T00:00:00.000Z",
        position: null,
      });
    }));
    const controller = new PlayerUiController(services, createInitialState);

    const first = controller.quickSave();
    await expect(controller.quickLoad()).rejects.toEqual(expect.objectContaining({ code: "player_ui_busy" }));
    release?.();
    await first;

    expect(save).toHaveBeenCalledWith("quick", expect.objectContaining({
      label: "Quick Save",
      preview: { background: null },
    }));
  });

  it("ignoresPlayerShortcutsFromEditableAndRangeControls", () => {
    expect(isPlayerShortcutTarget({ tagName: "INPUT" } as unknown as EventTarget)).toBe(true);
    expect(isPlayerShortcutTarget({ tagName: "TEXTAREA" } as unknown as EventTarget)).toBe(true);
    expect(isPlayerShortcutTarget({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(isPlayerShortcutTarget({ tagName: "DIV", isContentEditable: false } as unknown as EventTarget)).toBe(false);
  });

  it("preservesStructuredRuntimeErrorCodesForVisibleNotices", async () => {
    const services = runtime();
    vi.spyOn(services.save, "quickLoad").mockRejectedValue(
      new RuntimePersistenceError("runtime_save_slot_not_found", "No quick save."),
    );
    const controller = new PlayerUiController(services, createInitialState);

    await expect(controller.quickLoad()).rejects.toEqual(expect.objectContaining({
      code: "runtime_save_slot_not_found",
      message: "No quick save.",
    }));
    expect(runtimeErrorDetails(new Error("failed"))).toEqual({
      code: "runtime_operation_failed",
      message: "failed",
    });
  });

  it("rendersAllMenuPagesAndAnExplicitEmptyHistoryState", () => {
    const html = renderToStaticMarkup(
      <PlayerMenu
        page="history"
        busy={false}
        notice={null}
        window={DEFAULT_UI_TOKENS.menuWindow}
        onPageChange={vi.fn()}
        onClose={vi.fn()}
      >
        <HistoryPanel entries={[]} busy={false} onReplayVoice={vi.fn()} onRollback={vi.fn()} />
      </PlayerMenu>,
    );

    expect(html).toContain("存档 / 读档");
    expect(html).toContain("历史");
    expect(html).toContain("CG Gallery");
    expect(html).toContain("回想");
    expect(html).toContain("音乐鉴赏");
    expect(html).toContain("结局列表");
    expect(html).toContain("设置");
    expect(html).toContain("系统");
    expect(html).toContain("暂无历史记录");
    expect(html).toContain('aria-modal="true"');
  });

  it("keeps menu page navigation separate from opening playback controls", () => {
    const stageSource = readFileSync(
      new URL("../../src-tauri/resources/default-renderer/Stage.tsx", import.meta.url),
      "utf8",
    );

    expect(stageSource).toContain("const changeMenuPage = (page: PlayerMenuPage) => {");
    expect(stageSource).toContain("onPageChange={changeMenuPage}");
    expect(stageSource).not.toContain("onPageChange={(page) => openMenu(page)}");
  });

  it("constrainsTheTokenDrivenMenuWindowToTheStageBounds", () => {
    expect(menuStyle(DEFAULT_UI_TOKENS.menuWindow)).toEqual(expect.objectContaining({
      left: 110,
      top: 40,
      width: 1060,
      height: 640,
      maxWidth: "calc(100% - 110px)",
      maxHeight: "calc(100% - 40px)",
    }));
  });

  it("rendersEveryDeterministicSlotAndTheSixRuntimeSettings", () => {
    const slotsHtml = renderToStaticMarkup(
      <SaveLoadPanel
        slots={buildPlayerSlots([])}
        busy={false}
        manifest={{ characters: {}, backgrounds: {}, audio: { bgm: {}, sfx: {}, voice: {} } }}
        contentBase="./content"
        onSave={vi.fn()}
        onLoad={vi.fn()}
        onDelete={vi.fn()}
        onQuickSave={vi.fn()}
        onQuickLoad={vi.fn()}
      />,
    );
    const settingsHtml = renderToStaticMarkup(
      <RuntimeSettingsPanel
        settings={{
          schemaVersion: 1,
          textSpeedCps: 30,
          autoAdvanceMs: 1_200,
          volumes: { master: 1, bgm: 0.8, sfx: 1, voice: 1 },
        }}
        busy={false}
        onSave={vi.fn()}
      />,
    );

    expect((slotsHtml.match(/data-player-slot=/g) ?? [])).toHaveLength(15);
    expect(slotsHtml).toContain("手动存档 12");
    expect(settingsHtml).toContain("主音量");
    expect(settingsHtml).toContain("BGM 音量");
    expect(settingsHtml).toContain("音效音量");
    expect(settingsHtml).toContain("语音音量");
    expect(settingsHtml).toContain("文字速度");
    expect(settingsHtml).toContain("自动播放间隔");
  });

  it("rendersGalleryReplayMusicAndEndingPagesFromUnlockRegistries", async () => {
    const services = createInMemoryRuntimeServices({
      getState: createInitialState,
      manifest: {
        characters: {},
        backgrounds: {},
        audio: { bgm: { theme: "audio/theme.ogg" }, sfx: {}, voice: {} },
        cg: { cg_001: { path: "cg/001.png", name: "Rooftop CG", thumbnail: "cg/thumb.png" } },
        videos: {},
        fonts: {},
        uiSkins: {},
        animationAtlases: {},
        unlocks: {
          cg: { cg_rooftop: { assetId: "cg_001", title: "Rooftop" } },
          music: { music_theme: { audioId: "theme", title: "Theme" } },
          replay: { replay_start: { nodeId: "start", title: "Opening" } },
          endings: { true_end: { title: "True End", nodeId: "ending" } },
        },
      },
      startReplay: vi.fn(() => ({ warnings: [] })),
    });
    await services.persistent.unlock("cg", "cg_rooftop");
    await services.persistent.unlock("music", "music_theme");
    await services.persistent.unlock("replay", "replay_start");
    await services.persistent.unlock("endings", "true_end");
    const manifest = {
      characters: {},
      backgrounds: {},
      audio: { bgm: { theme: "audio/theme.ogg" }, sfx: {}, voice: {} },
      cg: { cg_001: { path: "cg/001.png", name: "Rooftop CG", thumbnail: "cg/thumb.png" } },
      videos: {},
      fonts: {},
      uiSkins: {},
      animationAtlases: {},
      unlocks: {
        cg: { cg_rooftop: { assetId: "cg_001", title: "Rooftop" } },
        music: { music_theme: { audioId: "theme", title: "Theme" } },
        replay: { replay_start: { nodeId: "start", title: "Opening" } },
        endings: { true_end: { title: "True End", nodeId: "ending" } },
      },
    };

    const galleryHtml = renderToStaticMarkup(<GalleryPanel manifest={manifest} contentBase="./content" gallery={services.gallery} busy={false} />);
    const replayHtml = renderToStaticMarkup(<ReplayPanel manifest={manifest} gallery={services.gallery} busy={false} onStartReplay={vi.fn()} />);
    const musicHtml = renderToStaticMarkup(<MusicRoomPanel manifest={manifest} gallery={services.gallery} busy={false} onPlayMusic={vi.fn()} onStopMusic={vi.fn()} />);
    const endingsHtml = renderToStaticMarkup(<EndingsPanel manifest={manifest} gallery={services.gallery} />);

    expect(galleryHtml).toContain("Rooftop");
    expect(galleryHtml).toContain("cg/thumb.png");
    expect(replayHtml).toContain("Opening");
    expect(replayHtml).toContain("开始回想");
    expect(musicHtml).toContain("Theme");
    expect(musicHtml).toContain("播放");
    expect(endingsHtml).toContain("True End");
  });

  it("controllerStartsReplayAndPlaysMusicThroughRuntimeServices", async () => {
    const services = runtime();
    const startReplay = vi.fn(() => ({ warnings: [] }));
    const playMusic = vi.fn();
    const stopMusic = vi.fn();
    services.replay.start = startReplay;
    services.audio.playMusic = playMusic;
    services.audio.stopMusic = stopMusic;
    const controller = new PlayerUiController(services, createInitialState);

    await expect(controller.startReplay("replay_start")).resolves.toEqual({ warnings: [] });
    await controller.playMusic("theme");
    await controller.stopMusic();

    expect(startReplay).toHaveBeenCalledWith("replay_start");
    expect(playMusic).toHaveBeenCalledWith("theme", { loop: true });
    expect(stopMusic).toHaveBeenCalledWith(300);
  });

  it("rendersTheCompleteStageThroughContractV1Props", () => {
    const globalScope = globalThis as { window?: unknown };
    // Spec 21：无 uiHint 全局 = 真实启动 = 标题门；剧情 UI 断言注入 story hint
    globalScope.window = { __VIBEGAL_FIXTURE_UI__: { screen: "story" } };
    try {
      const services = runtime();
      const html = renderToStaticMarkup(
        <Stage
          state={createInitialState()}
          manifest={{ characters: {}, backgrounds: {}, audio: { bgm: {}, sfx: {}, voice: {} } }}
          contentBase="./content"
          stage={{ width: 1280, height: 720 }}
          controls={{
            advance: vi.fn(),
            choose: vi.fn(),
            setAutoPlay: vi.fn(),
            setSkipMode: vi.fn(),
            rollbackTo: vi.fn(),
            restart: vi.fn(),
          }}
          runtime={services}
        />,
      );

      expect(html).toContain('data-player-stage="true"');
      expect(html).toContain('data-player-action="quick-save"');
      expect(html).not.toContain("存档 / 读档");
    } finally {
      delete globalScope.window;
    }
  });
});

describe("title screen（Spec 21）", () => {
  it("readFixtureUiHintScreen 按语义表判定初始屏", () => {
    const globalScope = globalThis as { window?: unknown };
    const cases: Array<[unknown, TitleGateScreen]> = [
      [undefined, "title"], // 全局不存在 = 真实启动
      [{ screen: "title" }, "title"],
      [{ screen: "story" }, "story"],
      [{ panel: "save" }, "story"], // panel 语义蕴含 story
      [{ screen: "title", panel: "save" }, "title"], // 显式 title 优先
      [{ screen: "menu" }, "title"], // 非法 screen 按真实启动退化
      [{}, "title"],
      ["save", "title"],
    ];
    try {
      for (const [hint, expected] of cases) {
        if (hint === undefined) delete globalScope.window;
        else globalScope.window = { __VIBEGAL_FIXTURE_UI__: hint };
        expect(readFixtureUiHintScreen()).toBe(expected);
      }
    } finally {
      delete globalScope.window;
    }
  });

  it("pickContinueSlot 取 updatedAt 最新槽（含 auto/quick），空列表返回 null", () => {
    expect(pickContinueSlot([])).toBeNull();
    const summaries: SaveSlotSummary[] = [
      { slotId: "manual-01", updatedAt: "2026-07-10T08:00:00.000Z", position: null },
      { slotId: "auto:node", updatedAt: "2026-07-12T20:30:00.000Z", position: null },
      { slotId: "quick", updatedAt: "2026-07-11T12:00:00.000Z", position: null },
    ];
    expect(pickContinueSlot(summaries)?.slotId).toBe("auto:node");
    // 单槽（quick）也是合法继续目标
    expect(pickContinueSlot([summaries[2]])?.slotId).toBe("quick");
  });

  it("formatSlotTime 输出确定性的 YYYY-MM-DD HH:mm", () => {
    expect(formatSlotTime("2026-07-12T20:30:45.000Z")).toBe("2026-07-12 20:30");
    expect(formatSlotTime("not-a-date")).toBe("not-a-date");
  });

  it("TitleScreen 渲染四按钮、继续副标题与禁用态", () => {
    const manifest = { characters: {}, backgrounds: {}, audio: { bgm: {}, sfx: {}, voice: {} } };
    const withSaves = renderToStaticMarkup(
      <TitleScreen
        manifest={manifest}
        titleBackgroundUrl={null}
        tokens={DEFAULT_UI_TOKENS.titleScreen}
        continueSlot={{
          slotId: "auto:node",
          label: "节点自动存档",
          updatedAt: "2026-07-12T20:30:00.000Z",
          position: null,
        }}
        hasSaves
        busy={false}
        onStart={vi.fn()}
        onContinue={vi.fn()}
        onLoad={vi.fn()}
        onSettings={vi.fn()}
      />,
    );
    expect(withSaves).toContain('data-ui-part="titleScreen"');
    expect(withSaves).toContain('data-title-action="start"');
    expect(withSaves).toContain('data-title-action="continue"');
    expect(withSaves).toContain('data-title-action="load"');
    expect(withSaves).toContain('data-title-action="settings"');
    // 继续副标题 = 槽 label + 时间
    expect(withSaves).toContain("节点自动存档 · 2026-07-12 20:30");
    const continueButton = withSaves.match(/<button[^>]*data-title-action="continue"[^>]*>/)?.[0] ?? "";
    expect(continueButton).not.toContain("disabled");

    const noSaves = renderToStaticMarkup(
      <TitleScreen
        manifest={manifest}
        titleBackgroundUrl={null}
        tokens={DEFAULT_UI_TOKENS.titleScreen}
        continueSlot={null}
        hasSaves={false}
        busy={false}
        onStart={vi.fn()}
        onContinue={vi.fn()}
        onLoad={vi.fn()}
        onSettings={vi.fn()}
      />,
    );
    const disabledContinue = noSaves.match(/<button[^>]*data-title-action="continue"[^>]*>/)?.[0] ?? "";
    const disabledLoad = noSaves.match(/<button[^>]*data-title-action="load"[^>]*>/)?.[0] ?? "";
    expect(disabledContinue).toContain("disabled");
    expect(disabledLoad).toContain("disabled");
    expect(noSaves).toContain("暂无存档");
  });

  it("SystemPanel 提供「回到标题」按钮（不 reset player 的切屏入口）", () => {
    const html = renderToStaticMarkup(
      <SystemPanel busy={false} onReturn={vi.fn()} onRestart={vi.fn()} onReturnToTitle={vi.fn()} />,
    );
    expect(html).toContain('data-system-action="return-to-title"');
    expect(html).toContain("回到标题");
    expect(html).toContain("返回游戏");
    expect(html).toContain("重新开始");
  });
});
