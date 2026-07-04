# Renderer Contract

GalStudio loads project-local renderer layers from `renderers/<id>/`.

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

`renderers/<id>/index.tsx` must default-export a `RendererManifest` from `@galstudio/engine`:

```ts
import type { RendererManifest } from "@galstudio/engine";

const renderer: RendererManifest = {
  id: "default",
  name: "Default Renderer",
  Component,
};

export default renderer;
```

Required fields:

- `id`: usually matches the directory name
- `name`: UI label shown in GalStudio
- `Component`: React component receiving `RendererProps`

Optional fields:

- `description`

## RendererProps

`RendererProps` comes from `packages/engine/src/renderer.ts`.

- `state`: current `NovelState`
- `manifest`: project manifest with backgrounds / characters / audio registries
- `contentBase`: webview-accessible base URL for `content/`
- `stage`: fixed project stage size from `content/meta.json`, `{ width, height }`
- `onAdvance`
- `onToggleAuto`
- `onToggleRecording`
- `onSeekBy?`
- `onStepOnce?`
- `onPrevChapter?`
- `onNextChapter?`

Renderers should treat these callbacks as the only control surface. They should not read project files directly.

## Stage Size

GalStudio presents renderers inside a fixed-size stage defined by `content/meta.json`:

```json
{
  "stage": { "width": 1280, "height": 720 }
}
```

The Studio preview scales that stage to fit the available panel with letterboxing. Renderer components should size their root to `width: "100%"` and `height: "100%"` and treat `props.stage` as the coordinate system. Avoid `100vw` / `100vh` for renderer layout because project renderers are embedded inside Studio panels and may later be recorded or exported at the project stage size.

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

Playback advances by story frame: a user advance consumes non-blocking stage instructions
(`bg`, `bgm`, `sfx`, `voice`, `char`, `effect`, `transition`) until it reaches a stop
instruction (`say`, `narrate`, `choice`, `wait`, `pause`). Renderers receive the resulting
semantic `NovelState`; they should decide how slots such as `left`, `center`, and `right`
map to their own layout inside the fixed `stage`.

V1 does not define `layoutOverride`, custom coordinates, or an `@layout` command. If a
renderer wants custom placement rules, keep them internal to the renderer or expose them
through documented project presets in a later contract revision.

## Asset Resolution

Manifest values are relative paths under `content/`. Renderers can resolve them with `resolveAsset(contentBase, relPath)` from `@galstudio/engine`, or equivalent string joining.

## Supported Imports

Runtime compilation supports:

- `react`
- `react/jsx-runtime`
- `react-dom`
- `react-dom/client`
- `@galstudio/engine`
- relative imports such as `./Stage` or `./layers/BackgroundLayer`

Unsupported:

- arbitrary bare imports such as `lodash`, `three`, `zustand`
- Node built-ins
- package manager resolution inside project renderers

Unsupported bare imports surface as renderer compile errors in the studio.

## Non-Goals / Not Guaranteed

- No in-app AI hooks
- No renderer marketplace registration
- No stability guarantee for private studio source paths
- No direct filesystem access from the React renderer runtime
