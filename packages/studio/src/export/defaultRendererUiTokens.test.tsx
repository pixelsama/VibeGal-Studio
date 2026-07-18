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
});

describe("default renderer ui tokens rendering", () => {
  it("rendersTheDialogueBoxWithTheLegacyHardcodedGeometryWhenNoTokensExist", () => {
    const html = renderToStaticMarkup(<DialogueBox state={dialogueState()} manifest={baseManifest()} />);

    expect(html).toContain('data-ui-part="dialogueBox"');
    expect(html).toContain("left:77.08px");
    expect(html).toContain("top:497px");
    expect(html).toContain("width:1125.84px");
    expect(html).toContain("height:175px");
    expect(html).toContain("border-radius:6px");
    expect(html).toContain("padding:24px 32px 28px");
    expect(html).toContain("color:#eef2f7");
    expect(html).toContain("font-size:26px");
    expect(html).toContain("line-height:44.2px");
    expect(html).toContain("background:linear-gradient(to top, rgba(10,16,30,0.86), rgba(10,16,30,0.7))");
    expect(html).toContain("border:1px solid #ff7eb655");
    expect(html).toContain("border-top:2px solid #ff7eb6");
  });

  it("rendersTheNameBoxWithLegacyGeometryAndTheSpeakerColor", () => {
    const html = renderToStaticMarkup(<DialogueBox state={dialogueState()} manifest={baseManifest()} />);

    expect(html).toContain('data-ui-part="nameBox"');
    expect(html).toContain("left:102.08px");
    expect(html).toContain("top:481px");
    expect(html).toContain("background:rgba(8,12,22,0.95)");
    expect(html).toContain("color:#ff7eb6");
    expect(html).toContain("font-size:20px");
  });

  it("keepsTheNarrationGradientAndOmitsTheNameBoxWithoutSpeaker", () => {
    const html = renderToStaticMarkup(<DialogueBox state={narrationState()} manifest={baseManifest()} />);

    expect(html).toContain("background:linear-gradient(to top, rgba(0,0,0,0.78), rgba(0,0,0,0.55))");
    expect(html).toContain("border:1px solid rgba(255,255,255,0.12)");
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

  it("rendersChoiceButtonsWithLegacyStylesByDefaultAndOverridesThemWithTokens", () => {
    const state = createInitialState();
    state.choice = { choices: [{ text: "去天台", to: "roof" }] };

    const legacy = renderStage(state, baseManifest());
    expect(legacy).toContain("background:rgba(18, 19, 21, 0.88)");
    expect(legacy).toContain("border-radius:5px");
    expect(legacy).toContain("font-size:15px");
    expect(legacy).toContain("[data-choice-to]:not(:disabled):hover");

    const themed = renderStage(state, manifestWithTokens({
      "choiceButton.bgColor": "#101010",
      "choiceButton.textColor": "#eeeeee",
      "choiceButton.hoverColor": "#ff00ff",
      "choiceButton.radius": 9,
      "choiceButton.fontSize": 18,
    }));
    expect(themed).toContain("background:#101010");
    expect(themed).toContain("color:#eeeeee");
    expect(themed).toContain("border-radius:9px");
    expect(themed).toContain("font-size:18px");
    expect(themed).toContain("#ff00ff");
  });

  it("rendersTheHudWithLegacyStylesByDefaultAndHidesItWhenHudVisibleIsZero", () => {
    const legacy = renderStage(createInitialState(), baseManifest());
    expect(legacy).toContain('data-player-action="menu"');
    expect(legacy).toContain("background:rgba(14, 15, 17, 0.78)");
    expect(legacy).toContain("font-size:12px");

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

  it("appliesStageFontFamilyToTheStageRoot", () => {
    const legacy = renderStage(createInitialState(), baseManifest());
    // SSR 会把样式里的单引号转义为 &#x27;
    expect(legacy).toContain("font-family:&#x27;Noto Serif SC&#x27;, serif");

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
