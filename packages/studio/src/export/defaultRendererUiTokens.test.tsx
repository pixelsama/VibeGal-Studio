import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInMemoryRuntimeServices,
  createInitialState,
  type Manifest,
  type NovelState,
  type RuntimeServices,
} from "@vibegal/engine";
import { DialogueBox } from "../../src-tauri/resources/default-renderer/DialogueBox";
import { Stage } from "../../src-tauri/resources/default-renderer/Stage";
import defaultRenderer from "../../src-tauri/resources/default-renderer/index";
import { DEFAULT_UI_TOKENS, resolveUiTokens } from "../../src-tauri/resources/default-renderer/useUiTokens";

function baseManifest(): Manifest {
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

function manifestWithTokens(tokens: Record<string, string | number>, skinId = "default"): Manifest {
  return { ...baseManifest(), uiSkins: { [skinId]: { assets: {}, tokens } } };
}

function dialogueState(): NovelState {
  const state = createInitialState();
  state.speaker = { id: "rin", name: "凛", color: "#ff7eb6", expr: "default" };
  state.dialogue = { text: "你好，世界。", typedLen: 5, fullyRevealed: true };
  return state;
}

function narrationState(): NovelState {
  const state = createInitialState();
  state.narration = { text: "雨一直下。", typedLen: 5, fullyRevealed: true };
  return state;
}

function runtime(): RuntimeServices {
  return createInMemoryRuntimeServices({ getState: createInitialState });
}

function renderStage(state: NovelState, manifest: Manifest): string {
  return renderToStaticMarkup(
    <Stage
      state={state}
      manifest={manifest}
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
      runtime={runtime()}
    />,
  );
}

describe("resolveUiTokens", () => {
  it("fallsBackToDefaultsWhenManifestHasNoUiSkins", () => {
    expect(resolveUiTokens(baseManifest())).toEqual(DEFAULT_UI_TOKENS);
  });

  it("fallsBackToDefaultsWhenUiSkinsFieldIsMissingAtRuntime", () => {
    const manifest = baseManifest() as unknown as { uiSkins?: unknown };
    delete manifest.uiSkins;
    expect(resolveUiTokens(manifest as unknown as Manifest)).toEqual(DEFAULT_UI_TOKENS);
  });

  it("appliesPartialOverridesFromTheDefaultSkin", () => {
    const tokens = resolveUiTokens(manifestWithTokens({ "dialogueBox.x": 120, "hud.visible": 0 }));
    expect(tokens.dialogueBox.x).toBe(120);
    expect(tokens.dialogueBox.y).toBe(DEFAULT_UI_TOKENS.dialogueBox.y);
    expect(tokens.hud.visible).toBe(false);
    expect(tokens.nameBox.visible).toBe(true);
  });

  it("prefersTheSkinWithIdDefault", () => {
    const manifest = baseManifest();
    manifest.uiSkins = {
      dark: { assets: {}, tokens: { "dialogueBox.x": 111 } },
      default: { assets: {}, tokens: { "dialogueBox.x": 222 } },
    };
    expect(resolveUiTokens(manifest).dialogueBox.x).toBe(222);
  });

  it("fallsBackToTheFirstSkinWithAWarningWhenDefaultIsMissing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const manifest = baseManifest();
      manifest.uiSkins = { dark: { assets: {}, tokens: { "dialogueBox.x": 111 } } };
      expect(resolveUiTokens(manifest).dialogueBox.x).toBe(111);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("parsesNumericStringsAndRejectsGarbage", () => {
    const tokens = resolveUiTokens(manifestWithTokens({
      "dialogueBox.x": "150",
      "dialogueBox.y": "not-a-number",
      "nameBox.visible": "0",
    }));
    expect(tokens.dialogueBox.x).toBe(150);
    expect(tokens.dialogueBox.y).toBe(DEFAULT_UI_TOKENS.dialogueBox.y);
    expect(tokens.nameBox.visible).toBe(false);
  });

  it("resolvesNullableGeometryTokensToNullWhenMissing", () => {
    const tokens = resolveUiTokens(baseManifest());
    expect(tokens.hud.x).toBeNull();
    expect(tokens.hud.y).toBeNull();
    expect(tokens.choiceBox.height).toBeNull();
    expect(tokens.nameBox.bgColor).toBeNull();

    const overridden = resolveUiTokens(manifestWithTokens({
      "hud.x": 620,
      "hud.y": 640,
      "choiceBox.height": 300,
      "nameBox.bgColor": "#112233",
    }));
    expect(overridden.hud.x).toBe(620);
    expect(overridden.hud.y).toBe(640);
    expect(overridden.choiceBox.height).toBe(300);
    expect(overridden.nameBox.bgColor).toBe("#112233");
  });
});

describe("default renderer ui tokens rendering", () => {
  it("rendersTheDialogueBoxWithTheBuiltinGeometryAndFrostedDesignWhenNoTokensExist", () => {
    const html = renderToStaticMarkup(<DialogueBox state={dialogueState()} manifest={baseManifest()} />);

    expect(html).toContain('data-ui-part="dialogueBox"');
    expect(html).toContain("left:77.08px");
    expect(html).toContain("top:497px");
    expect(html).toContain("width:1125.84px");
    expect(html).toContain("height:175px");
    expect(html).toContain("border-radius:18px");
    expect(html).toContain("padding:24px 32px 28px");
    expect(html).toContain("color:#3a3f55");
    expect(html).toContain("font-size:23px");
    expect(html).toContain("line-height:41.4px");
    // 内置磨砂白 + 发丝白边 + 顶边渐变条 + 继续指示
    expect(html).toContain("background:rgba(255, 255, 255, 0.86)");
    expect(html).toContain("border:1px solid rgba(255, 255, 255, 0.65)");
    expect(html).toContain("linear-gradient(90deg, #ff6f9f, #5cb8e6)");
    expect(html).toContain("data-continue-indicator");
  });

  it("rendersTheNameBoxPillWithTheSpeakerColorByDefault", () => {
    const html = renderToStaticMarkup(<DialogueBox state={dialogueState()} manifest={baseManifest()} />);

    expect(html).toContain('data-ui-part="nameBox"');
    expect(html).toContain("left:109.08px");
    expect(html).toContain("top:479px");
    expect(html).toContain("border-radius:999px");
    // bgColor 缺省 = 跟随说话人颜色；文字色默认白
    expect(html).toContain("background:#ff7eb6");
    expect(html).toContain("color:#ffffff");
    expect(html).toContain("font-size:17px");
  });

  it("keepsTheSameFrostedBoxForNarrationAndOmitsTheNameBoxWithoutSpeaker", () => {
    const html = renderToStaticMarkup(<DialogueBox state={narrationState()} manifest={baseManifest()} />);

    expect(html).toContain("background:rgba(255, 255, 255, 0.86)");
    expect(html).not.toContain('data-ui-part="nameBox"');
  });

  it("appliesGeometryAndColorTokenOverridesToTheDialogueBox", () => {
    const manifest = manifestWithTokens({
      "dialogueBox.x": 120,
      "dialogueBox.y": 480,
      "dialogueBox.width": 900,
      "dialogueBox.height": 200,
      "dialogueBox.bgColor": "#112233",
      "dialogueBox.radius": 12,
      "dialogueBox.padding": 20,
      "dialogueBox.textColor": "#abcdef",
      "dialogueBox.fontSize": 30,
      "dialogueBox.lineHeight": 48,
      "nameBox.visible": 0,
    });
    const html = renderToStaticMarkup(<DialogueBox state={dialogueState()} manifest={manifest} />);

    expect(html).toContain("left:120px");
    expect(html).toContain("top:480px");
    expect(html).toContain("width:900px");
    expect(html).toContain("height:200px");
    expect(html).toContain("background:#112233");
    expect(html).toContain("border-radius:12px");
    expect(html).toContain("padding:20px");
    expect(html).toContain("color:#abcdef");
    expect(html).toContain("font-size:30px");
    expect(html).toContain("line-height:48px");
    expect(html).not.toContain('data-ui-part="nameBox"');
  });

  it("mixesBgOpacityIntoBgColorViaColorMix", () => {
    const manifest = manifestWithTokens({ "dialogueBox.bgColor": "#112233", "dialogueBox.bgOpacity": 0.5 });
    const html = renderToStaticMarkup(<DialogueBox state={dialogueState()} manifest={manifest} />);

    expect(html).toContain("background:color-mix(in srgb, #112233 50%, transparent)");
  });

  it("rendersTheChoiceBoxPartWithBuiltinGeometryAndOverridesItWithTokens", () => {
    const state = createInitialState();
    state.choice = { choices: [{ text: "去天台", to: "roof" }] };

    const legacy = renderStage(state, baseManifest());
    expect(legacy).toContain('data-ui-part="choiceBox"');
    expect(legacy).toContain("left:400px");
    expect(legacy).toContain("top:170px");
    expect(legacy).toContain("width:480px");
    expect(legacy).toContain("max-height:42%");

    const themed = renderStage(state, manifestWithTokens({
      "choiceBox.x": 100,
      "choiceBox.y": 200,
      "choiceBox.width": 560,
      "choiceBox.height": 300,
    }));
    expect(themed).toContain("left:100px");
    expect(themed).toContain("top:200px");
    expect(themed).toContain("width:560px");
    expect(themed).toContain("max-height:300px");
  });

  it("rendersChoiceButtonsWithBuiltinStylesByDefaultAndOverridesThemWithTokens", () => {
    const state = createInitialState();
    state.choice = { choices: [{ text: "去天台", to: "roof" }] };

    const legacy = renderStage(state, baseManifest());
    expect(legacy).toContain("background:rgba(255, 255, 255, 0.9)");
    expect(legacy).toContain("border-radius:14px");
    expect(legacy).toContain("font-size:16px");
    expect(legacy).toContain("[data-choice-to]:not(:disabled):hover");
    // 默认悬停：樱粉底 + 白字
    expect(legacy).toContain("#ff6f9f");

    const themed = renderStage(state, manifestWithTokens({
      "choiceButton.bgColor": "#101010",
      "choiceButton.textColor": "#eeeeee",
      "choiceButton.hoverColor": "#ff00ff",
      "choiceButton.hoverTextColor": "#00ff00",
      "choiceButton.radius": 9,
      "choiceButton.fontSize": 18,
    }));
    expect(themed).toContain("background:#101010");
    expect(themed).toContain("color:#eeeeee");
    expect(themed).toContain("border-radius:9px");
    expect(themed).toContain("font-size:18px");
    expect(themed).toContain("#ff00ff");
    expect(themed).toContain("#00ff00");
  });

  it("rendersTheHudPartAnchoredTopRightByDefaultAndReposItWithTokens", () => {
    const legacy = renderStage(createInitialState(), baseManifest());
    expect(legacy).toContain('data-ui-part="hud"');
    expect(legacy).toContain('data-player-action="menu"');
    expect(legacy).toContain("right:16px");
    expect(legacy).toContain("top:14px");
    expect(legacy).toContain("background:rgba(18, 20, 30, 0.45)");
    expect(legacy).toContain("font-size:12px");

    const moved = renderStage(createInitialState(), manifestWithTokens({ "hud.x": 620, "hud.y": 640 }));
    expect(moved).toContain("left:620px");
    expect(moved).toContain("top:640px");

    const hidden = renderStage(createInitialState(), manifestWithTokens({ "hud.visible": 0 }));
    expect(hidden).not.toContain("data-player-action");

    const themed = renderStage(createInitialState(), manifestWithTokens({
      "hud.bgColor": "#222222",
      "hud.textColor": "#333333",
      "hud.fontSize": 14,
    }));
    expect(themed).toContain("background:#222222");
    expect(themed).toContain("color:#333333");
    expect(themed).toContain("font-size:14px");
  });

  it("rendersTheMenuWindowPartWithBuiltinGeometryAndOverridesItWithTokens", () => {
    const globalScope = globalThis as { window?: unknown };
    globalScope.window = { __VIBEGAL_FIXTURE_UI__: { panel: "save" } };
    try {
      const legacy = renderStage(createInitialState(), baseManifest());
      expect(legacy).toContain('data-ui-part="menuWindow"');
      expect(legacy).toContain("left:110px");
      expect(legacy).toContain("top:40px");
      expect(legacy).toContain("width:1060px");
      expect(legacy).toContain("height:640px");

      const themed = renderStage(createInitialState(), manifestWithTokens({
        "menuWindow.x": 60,
        "menuWindow.y": 24,
        "menuWindow.width": 1160,
        "menuWindow.height": 672,
      }));
      expect(themed).toContain("left:60px");
      expect(themed).toContain("top:24px");
      expect(themed).toContain("width:1160px");
      expect(themed).toContain("height:672px");
    } finally {
      delete globalScope.window;
    }
  });

  it("appliesStageFontFamilyToTheStageRoot", () => {
    const legacy = renderStage(createInitialState(), baseManifest());
    // SSR 会把样式里的单引号转义为 &#x27;
    expect(legacy).toContain("font-family:&#x27;Noto Sans SC&#x27;");

    const themed = renderStage(createInitialState(), manifestWithTokens({ "stage.fontFamily": "Test Sans Token" }));
    expect(themed).toContain("font-family:Test Sans Token");
  });

  it("declaresTheLayoutPartsV1Capability", () => {
    expect(defaultRenderer.capabilities).toContain("layout-parts-v1");
    expect(defaultRenderer.capabilities).toContain("player-ui-v1");
    expect(defaultRenderer.capabilities).toContain("gallery-ui-v1");
  });
});

describe("fixture ui hint", () => {
  const globalScope = globalThis as { window?: unknown };

  afterEach(() => {
    delete globalScope.window;
  });

  it("opensTheRequestedMenuPageOnMount", () => {
    globalScope.window = { __VIBEGAL_FIXTURE_UI__: { panel: "save" } };
    const html = renderStage(createInitialState(), baseManifest());
    expect(html).toContain('data-player-menu="save"');
  });

  it("mapsGalleryPagesToTheirMenuPages", () => {
    globalScope.window = { __VIBEGAL_FIXTURE_UI__: { panel: "gallery-music" } };
    const html = renderStage(createInitialState(), baseManifest());
    expect(html).toContain('data-player-menu="music"');
  });

  it("ignoresUnknownOrMalformedHints", () => {
    globalScope.window = { __VIBEGAL_FIXTURE_UI__: { panel: "not-a-panel" } };
    expect(renderStage(createInitialState(), baseManifest())).not.toContain("data-player-menu=");

    globalScope.window = { __VIBEGAL_FIXTURE_UI__: "save" };
    expect(renderStage(createInitialState(), baseManifest())).not.toContain("data-player-menu=");

    globalScope.window = {};
    expect(renderStage(createInitialState(), baseManifest())).not.toContain("data-player-menu=");
  });

  it("keepsAllPanelsClosedWhenNoHintExists", () => {
    const html = renderStage(createInitialState(), baseManifest());
    expect(html).not.toContain("data-player-menu=");
  });
});
