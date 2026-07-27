import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  createInMemoryRuntimeServices,
  createInitialState,
  type Manifest,
  type NovelState,
} from "@vibegal/engine";
import { DialogueBox } from "../../src-tauri/resources/classic-renderer/DialogueBox";
import { HistoryPanel } from "../../src-tauri/resources/classic-renderer/HistoryPanel";
import { PlayerHud } from "../../src-tauri/resources/classic-renderer/PlayerHud";
import { PlayerMenu } from "../../src-tauri/resources/classic-renderer/PlayerMenu";
import { Stage } from "../../src-tauri/resources/classic-renderer/Stage";
import { TitleScreen } from "../../src-tauri/resources/classic-renderer/TitleScreen";
import classicRenderer from "../../src-tauri/resources/classic-renderer/index";
import { DEFAULT_UI_TOKENS } from "../../src-tauri/resources/classic-renderer/useUiTokens";

function manifest(): Manifest {
  return {
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
}

function dialogueState(): NovelState {
  const state = createInitialState();
  state.speaker = { id: "rin", name: "凛", color: "#ff7eb6", expr: "default" };
  state.dialogue = { text: "夜色沉入窗外。", typedLen: 7, fullyRevealed: true };
  return state;
}

function renderStage(state: NovelState, screen: "title" | "story" | { panel: "save" }): string {
  const globalScope = globalThis as { window?: unknown };
  const hadWindow = "window" in globalScope;
  const previous = globalScope.window;
  globalScope.window = {
    __VIBEGAL_FIXTURE_UI__: typeof screen === "string" ? { screen } : screen,
  };
  try {
    return renderToStaticMarkup(
      <Stage
        state={state}
        manifest={manifest()}
        contentBase="./content"
        meta={{
          title: "经典测试作",
          typingSpeedCps: 30,
          autoAdvanceMs: 1_200,
          chapterGapMs: 1_500,
          stage: { width: 1280, height: 720 },
        }}
        stage={{ width: 1280, height: 720 }}
        controls={{
          advance: vi.fn(),
          submitName: () => false,
    choose: vi.fn(),
          setAutoPlay: vi.fn(),
          setSkipMode: vi.fn(),
          rollbackTo: vi.fn(),
          restart: vi.fn(),
        }}
        runtime={createInMemoryRuntimeServices({ getState: createInitialState })}
      />,
    );
  } finally {
    if (hadWindow) globalScope.window = previous;
    else delete globalScope.window;
  }
}

describe("classic renderer", () => {
  it("declares an independent renderer-v1 manifest and appearance model", () => {
    expect(classicRenderer).toEqual(expect.objectContaining({
      id: "classic",
      name: "经典深色 ADV",
      contractVersion: 1,
    }));
    expect(classicRenderer.capabilities).toEqual(expect.arrayContaining([
      "player-ui-v1",
      "gallery-ui-v1",
      "layout-parts-v1",
    ]));
    expect(classicRenderer.appearance?.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "dialogueBox" }),
      expect.objectContaining({ id: "menuWindow" }),
      expect.objectContaining({ id: "titleScreen" }),
    ]));
  });

  it("renders the dark bottom ADV dialogue window and rectangular name plate", () => {
    const html = renderToStaticMarkup(
      <DialogueBox state={dialogueState()} manifest={manifest()} />,
    );

    expect(html).toContain('data-ui-part="dialogueBox"');
    expect(html).toContain("left:24px");
    expect(html).toContain("top:500px");
    expect(html).toContain("width:1232px");
    expect(html).toContain("height:196px");
    expect(html).toContain("background:rgba(12, 14, 18, 0.9)");
    expect(html).toContain("border:1px solid rgba(200, 166, 106, 0.58)");
    expect(html).toContain("border-radius:2px");
    expect(html).toContain('data-ui-part="nameBox"');
    expect(html).toContain("background:#c8a66a");
    expect(html).toContain("◆");
  });

  it("renders a compact HUD with stable playback state", () => {
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

    expect(html).toContain('data-ui-part="hud"');
    expect(html).toContain("background:rgba(8, 9, 12, 0.82)");
    expect(html).toContain("border-radius:2px");
    expect(html.match(/<button[^>]*aria-pressed="true"/g)).toHaveLength(2);
    expect(html.match(/<button[^>]*aria-pressed="false"/g)).toHaveLength(5);
  });

  it("renders every menu destination in the side navigation", () => {
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
    expect(html).toContain("CG 鉴赏");
    expect(html).toContain("回想");
    expect(html).toContain("音乐鉴赏");
    expect(html).toContain("结局列表");
    expect(html).toContain("设置");
    expect(html).toContain("系统");
    expect(html).toContain("grid-template-columns:210px minmax(0, 1fr)");
    expect(html).toContain("background:rgba(5, 6, 8, 0.76)");
  });

  it("renders the right-side title composition and all title actions", () => {
    const html = renderToStaticMarkup(
      <TitleScreen
        manifest={manifest()}
        meta={{
          title: "经典测试作",
          typingSpeedCps: 30,
          autoAdvanceMs: 1_200,
          chapterGapMs: 1_500,
          stage: { width: 1280, height: 720 },
        }}
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

    expect(html).toContain('data-ui-part="titleScreen"');
    expect(html).toContain("left:770px");
    expect(html).toContain("top:72px");
    expect(html).toContain("width:438px");
    expect(html).toContain("text-align:right");
    expect(html).toContain('data-title-action="start"');
    expect(html).toContain('data-title-action="continue"');
    expect(html).toContain('data-title-action="load"');
    expect(html).toContain('data-title-action="settings"');
  });

  it("renders title, story, and menu fixtures through RendererProps", () => {
    const title = renderStage(createInitialState(), "title");
    const story = renderStage(dialogueState(), "story");
    const menu = renderStage(createInitialState(), { panel: "save" });

    expect(title).toContain('data-title-action="start"');
    expect(story).toContain('data-ui-part="dialogueBox"');
    expect(story).toContain('data-player-action="menu"');
    expect(menu).toContain('data-player-menu="save"');
    expect(menu).toContain('data-player-slot="quick"');
  });
});
