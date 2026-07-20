# Renderer Contract

VibeGal-Studio loads project-local renderer layers from `renderers/<id>/`.

## Directory Contract

Each renderer is a direct child of `renderers/` and must include `index.tsx`.

```text
renderers/
  default/
    index.tsx
  mobile/
    index.tsx
    Stage.tsx
```

Renderer ids must be plain filesystem-safe names. No slashes, `..`, drive letters, or nested registration files are supported.

## Default Export

`renderers/<id>/index.tsx` must default-export a `RendererManifest` from `@vibegal/engine`:

```ts
import type { RendererManifest } from "@vibegal/engine";

const renderer: RendererManifest = {
  id: "default",
  name: "Default Renderer",
  contractVersion: 1,
  Component,
};

export default renderer;
```

Required fields:

- `id`: usually matches the directory name
- `name`: UI label shown in VibeGal-Studio
- `contractVersion`: must be `1` for the current VibeGal-Studio renderer contract
- `Component`: React component receiving `RendererProps`

Optional fields:

- `description`
- `capabilities`: string feature flags for contract probing. The bundled default renderer declares `player-ui-v1` when it provides the standard HUD/player menu for save/load, history, skip, auto, and runtime settings. It declares `gallery-ui-v1` when it also provides default CG Gallery, replay, music room, and ending list pages. It declares `layout-parts-v1` when its draggable parts are fully driven by geometry tokens and carry `data-ui-part` (see "Appearance Tokens, `data-ui-part`, and uiHint" below).

VibeGal-Studio rejects renderer manifests whose `contractVersion` is missing or newer than the engine-supported version. There is no legacy renderer compatibility shim in V1.

## RendererProps

`RendererProps` comes from `packages/engine/src/renderer.ts`.

- `state`: current `NovelState`
- `manifest`: project manifest with characters / backgrounds / audio plus optional `cg`, `videos`, `fonts`, `uiSkins`, `animationAtlases`, and `unlocks`
- `contentBase`: webview-accessible base URL for `content/`
- `stage`: fixed project stage size from `content/meta.json`, `{ width, height }`
- `controls`: formal playback controls
- `runtime`: formal galgame runtime services

Renderers should treat `controls` and `runtime` as their only control surface. They should not read project files directly.

```ts
interface RendererProps {
  state: NovelState;
  manifest: Manifest;
  contentBase: string;
  stage: Meta["stage"];
  controls: RuntimeControls;
  runtime?: RuntimeServices;
}
```

`RuntimeControls` owns immediate playback actions:

- `advance()`: click / space semantics
- `choose(toNodeId)`: choose one of the current `state.choice.choices`
- `setAutoPlay(on)`
- `setSkipMode("off" | "read" | "all")`: `read` skip stops at unread text, choices, pauses, and errors; `all` skip stops at choices, pauses, and errors
- `rollbackTo(point)`
- `restart()`

`RuntimeServices` groups formal galgame services:

- `save`: list / save / load / delete / quick save / quick load / auto save
- `history`: backlog entries with `storyPoint`, voice replay, rollback by entry
- `persistent`: read text state and CG / music / ending unlocks
- `settings`: user/device settings including master, bgm, sfx, and voice volume
- `audio`: voice replay, music room playback, BGM stop/pause/resume, voice stop, SFX stop
- `gallery`: unlocked CG / music / replay / ending queries
- `replay`: start an unlocked replay scene by replay registry id
- `media`: close CG and skip skippable video overlays
- `status?`: optional transient runtime notices, such as auto-save or storage fallback warnings, that renderer UI may display without scraping the console
- `debug?`: Studio/dev-only inspection and jump helpers

Hosts that have not implemented a V1 operation must keep the service field present and fail with a structured runtime unavailable error. V1 does not provide an adapter for the removed top-level callbacks.

## Stage Size

VibeGal-Studio presents renderers inside a fixed-size stage defined by `content/meta.json`:

```json
{
  "stage": { "width": 1280, "height": 720 }
}
```

The Studio preview scales that stage to fit the available panel with letterboxing. Renderer components should size their root to `width: "100%"` and `height: "100%"` and treat `props.stage` as the coordinate system. Avoid `100vw` / `100vh` for renderer layout because project renderers are embedded inside Studio panels and may later be recorded or exported at the project stage size.

## Appearance Tokens, `data-ui-part`, and uiHint (Optional, Spec 17)

Renderers may consume appearance design tokens from `manifest.uiSkins`. This is an opt-in convention, not a UI framework: renderers that ignore it keep working, and third-party renderers may consume a subset or define their own extension keys.

**Skin selection rule**: consume the uiSkin with id `"default"`. If the registry has no `"default"` entry, fall back to the first entry and emit a `console.warn`. If the registry is empty, use built-in defaults for everything.

**Token keys** (flat dotted keys in `uiSkins.<id>.tokens`, values `string | number`; all keys optional, missing keys fall back to the renderer's built-in values):

```text
dialogueBox.x / .y / .width / .height      part geometry in stage coordinates (px)
dialogueBox.bgColor / .bgOpacity / .radius / .padding / .borderColor
dialogueBox.textColor / .fontSize / .fontFamily / .lineHeight
nameBox.x / .y / .width / .height
nameBox.bgColor / .textColor / .fontSize / .visible
choiceBox.x / .y / .width / .height        choice list container (.height = max-height)
choiceButton.bgColor / .textColor / .hoverColor / .hoverTextColor / .radius / .fontSize
hud.x / .y                                 null/missing = built-in top-right anchoring
hud.textColor / .bgColor / .fontSize / .visible
menuWindow.x / .y / .width / .height       player menu window (save/history/gallery/... pages)
stage.fontFamily                           global font (may reference manifest.fonts families)
```

**Geometry semantics**: the origin is the stage top-left corner; `x`/`y` are the part's top-left corner, `width`/`height` its size, all in stage-coordinate px (i.e. the `content/meta.json` stage coordinate system). Numeric `lineHeight` / `padding` tokens are px.

**Draggable parts (`layout-parts-v1`)**: a renderer declares the `layout-parts-v1` capability in its manifest when Studio stage dragging is supported. Each draggable part must (1) be positioned and sized entirely by its geometry tokens (absolute positioning in stage coordinates, with defaults when tokens are missing), and (2) carry `data-ui-part="<partName>"` on its root element, one-to-one with the token key prefix (`dialogueBox.x` ↔ `data-ui-part="dialogueBox"`). A part must NOT carry `data-ui-part` unless its layout is fully token-driven, otherwise drag values and visuals diverge. The bundled default renderer marks `dialogueBox`, `nameBox`, `choiceBox`, `hud`, and `menuWindow` this way (dragging `menuWindow` repositions every player-menu page at once; `hud.x`/`.y` stay unset until the first drag, which switches the HUD from its built-in top-right anchor to explicit coordinates).

**uiHint channel**: hosts (Studio scene fixtures, CLI `renderer-snapshot`) may set `window.__VIBEGAL_FIXTURE_UI__ = { panel: "<id>" }` before mounting the renderer. Renderers may read it once as their initial UI state: `save` / `history` / `settings` open the corresponding panel, and `gallery-cg` / `gallery-replay` / `gallery-music` / `gallery-endings` open the Gallery page tabs. Without the global, behavior must be exactly as before. Read it defensively (`typeof window === "undefined"` guard plus structural validation).

## NovelState

The stable view contract lives in `packages/engine/src/state.ts`.

Key fields:

- `background`, `backgroundTrans`, `backgroundMs`
- `sprites[]` with `id`, `pos`, `expr`, `changeId`, `justEntered`, `prevExpr`, `prevPos`, `trans`, `leaving`
- `speaker`
- `dialogue`
- `narration`
- `effects`
- `transitions`
- `audio`
- `flags`
- `currentCueMs`

`state.flags` contains renderer-readable playback status:

- `isWaiting`: the player is inside a timed wait instruction
- `isAutoPlay`: auto-play is currently enabled
- `skipMode`: current skip state, one of `"off"`, `"read"`, or `"all"`
- `isRecording`: recording mode; the bundled default renderer hides its player HUD in this mode
- `chapterIndex` and `progress`: coarse progress metadata

Playback advances by story frame: a user advance consumes non-blocking stage instructions
(`bg`, `bgm`, `sfx`, `voice`, `char`, `effect`, `transition`) until it reaches a stop
instruction (`say`, `narrate`, `choice`, `wait`, `pause`). Renderers receive the resulting
semantic `NovelState`; they should decide how slots such as `left`, `center`, and `right`
map to their own layout inside the fixed `stage`.

V1 does not define `layoutOverride`, custom coordinates, or an `@layout` command. If a
renderer wants custom placement rules, keep them internal to the renderer or expose them
through documented project presets in a later contract revision.

## Save, History, and Runtime Settings

The V1 runtime services are the stable player-facing contract for save/load, backlog,
settings, persistent unlocks, and media controls. Custom renderers may implement their own
UI and are not required to reuse the bundled default renderer components.

`save` exposes fixed operations for slot listing, save/load/delete, quick save/load, and
host-triggered auto save. Save previews are lightweight metadata (`text` and optional
`background`) rather than binary screenshots.

`history.getBacklog()` returns semantic backlog entries. Renderers should use it instead
of reconstructing history from dialogue DOM. `history.replayVoice(entryId)` replays only
that entry's voice and must not advance the story. `history.rollbackTo(entryId)` may return
`void`, a `RuntimeRestoreResult`, or a Promise of either, so older contract-v1 renderer
test doubles and hosts that perform rollback synchronously remain compatible.

`gallery` exposes unlocked CG, music, replay, and ending registry views. The bundled
default renderer uses `gallery.isUnlocked()` with `manifest.unlocks` to render locked
placeholders as well as unlocked entries. `replay.start(replayId)` starts the unlocked
replay scene associated with `manifest.unlocks.replay[replayId].nodeId`. Hosts should
reject missing or locked replay ids with a structured runtime error.

`audio.playMusic(audioId, options)` starts a specific BGM asset for music room playback.
`audio.stopMusic(fadeMs)` stops that music-room playback. These methods share the same
audio channel and volume settings as normal BGM playback.

`settings.getSettings()` returns the effective runtime settings record. Hosts resolve
settings in this order:

```text
persisted RuntimeSettingsRecord
  -> missing timing fields fall back to content/meta.json
  -> final fallback is the engine contract defaults
```

The exposed record includes `volumes.master`, `volumes.bgm`, `volumes.sfx`,
`volumes.voice`, `textSpeedCps`, `autoAdvanceMs`, and the compatibility field
`fullscreen`. `textSpeedCps` and `autoAdvanceMs` may be absent in older persisted records,
but hosts should fill them before handing settings to renderers.

`settings.updateSettings(patch)` is atomic from the renderer's point of view: on success,
the host persists the migrated record, applies channel volumes, updates live player timing,
and notifies the renderer. If persistence rejects the write, the previous effective
settings remain visible and the renderer should show the operation failure instead of
pretending it was saved.

## Asset Resolution

Manifest registry paths are relative to `content/`.

- Legacy string registries such as `backgrounds`, `audio.*`, and character `sprites` still store plain relative paths.
- `cg` / `videos` use `AssetRef`-style objects after parsing, so renderers should read `manifest.cg[id].path` and `manifest.videos[id].path`. Optional metadata such as `name`, `tags`, `thumbnail`, `poster`, `group`, and `unlockId` is renderer-consumable but not Studio-presentational by itself.
- `fonts`, `uiSkins`, and `animationAtlases` are pure project data contracts; renderers decide how to load or apply them.

Renderers can resolve any relative asset path with `resolveAsset(contentBase, relPath)` from `@vibegal/engine`, or equivalent string joining.

## Supported Imports

Runtime compilation supports:

- `react`
- `react/jsx-runtime`
- `react-dom`
- `react-dom/client`
- `@vibegal/engine`
- relative imports such as `./Stage` or `./layers/BackgroundLayer`

Unsupported:

- arbitrary bare imports such as `lodash`, `three`, `zustand`
- Node built-ins
- package manager resolution inside project renderers

Unsupported bare imports surface as renderer compile errors in the studio.

## Type Checking in the Project

Initialized projects carry a self-contained type environment so external tools can type-check renderers without the VibeGal-Studio source repository:

```text
tsconfig.json
.galstudio/types/
  engine.d.ts   # generated from @vibegal/engine's renderer contract surface
  react.d.ts    # minimal React shim (hooks, JSX runtime, common events)
```

From the project root:

```bash
npx tsc --noEmit
```

`tsconfig.json` includes `renderers/**/*.ts(x)` and `.galstudio/types/**/*.d.ts`. `engine.d.ts` is a generated snapshot of the real contract types (`RendererProps`, `NovelState`, `RuntimeServices`, `Manifest`, `resolveAsset`, ...); do not edit it — it is refreshed when the project is initialized or backfilled by a newer VibeGal-Studio. `react.d.ts` is intentionally minimal; extend it in the project when a renderer needs React APIs it does not cover.

## CLI Feedback Loop

Beyond `vibegal-cli validate`, two renderer-focused commands close the edit-check loop without opening the app:

```bash
# Static contract checks + real compile & typecheck (via the bundled node worker)
vibegal-cli renderer-check . --format json
# Static checks only (no node required)
vibegal-cli renderer-check . --no-compile

# Headless mount of the renderer onto built-in scenes and PNG screenshots
vibegal-cli renderer-snapshot . --out .galstudio/snapshots --format json
```

`renderer-check` reports `renderer_typecheck_failed` / `renderer_compile_failed` diagnostics with file, line, and column. If node or the bundled exporter is unavailable, it degrades to a `renderer_compile_skipped` warning and keeps the static-check result.

`renderer-snapshot` mounts the renderer with deterministic fixture states derived from the project manifest — `dialogue`, `narration`, `choice`, and `sprites` (multi-sprite) — using the same runtime services contract as the Studio preview, then drives headless Chrome/Chromium (`VIBEGAL_SMOKE_BROWSER` overrides the executable). It writes `<rendererId>-<sceneId>.png` files plus a `.vibegal-snapshot/` debug directory (HTML/bundle/scenes.json) into the `--out` directory, and reports per-scene `ok` / `warning` / `error` in JSON. Runtime render crashes surface as structured scene errors, so an external Agent can iterate: edit renderer → snapshot → read the PNGs and errors. Each scene's browser screenshot is capped at 45s by default; set `VIBEGAL_SNAPSHOT_BROWSER_TIMEOUT_SECS` to raise the cap on slow machines.

## Non-Goals / Not Guaranteed

- No in-app AI hooks
- No renderer marketplace registration
- No stability guarantee for private studio source paths
- No direct filesystem access from the React renderer runtime
