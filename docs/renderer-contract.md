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
- `onAdvance`
- `onToggleAuto`
- `onToggleRecording`
- `onSeekBy?`
- `onStepOnce?`
- `onPrevChapter?`
- `onNextChapter?`

Renderers should treat these callbacks as the only control surface. They should not read project files directly.

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
