# VibeGal-Studio Project Wiki

> Purpose: this document is the high-context briefing for humans and external expert AI systems.
> It compresses VibeGal-Studio's product philosophy, architecture, data contracts, current implementation,
> boundaries, and likely roadmap into one file so a reviewer can reason about the project without
> reading the source tree first.

## 1. Executive Summary

VibeGal-Studio is a data-driven galgame project editor and live viewer. It is not primarily a game UI
framework, nor an in-app AI client. Its job is to make galgame project data easy to create, inspect,
validate, hot-reload, preview, and eventually export.

The core product idea is:

```text
VibeGal-Studio = project IDE + data contract editor + renderer preview host + validation/export tool
```

The project is intentionally split into four responsibilities:

- **Contracts**: owns project-content Zod schemas, generated JSON Schema, stable diagnostics, and semantic validation metadata.
- **Engine**: owns pure interpretation, playback state, graph-aware routing, renderer/runtime contracts, and semantic validation that consumes `@vibegal/contracts`.
- **Studio editor**: owns project/file operations, graph editing, asset management, validation reports, preview hosting, renderer discovery, hot reload, and safe persistence.
- **Project renderer**: owns how the actual game looks and feels: dialogue box, menus, title screen, save/load UI, transitions, advanced animation, layout, and other presentation choices.

The most important boundary: **VibeGal-Studio should not bake a formal galgame UI into the editor**.
Instead, it should expose enough project data and runtime contract for project-local renderers to
implement formal galgame experiences.

## 2. Product Philosophy

### 2.1 Data First

VibeGal-Studio treats a galgame project as a directory of structured files:

```text
gal.project.json
content/
  meta.json
  manifest.json
  graph.json
  nodes/*.json
renderers/
  <renderer-id>/index.tsx
```

The files are the source of truth. The UI is an editor over those files, not a hidden database.
External tools and AI coding agents should be able to modify files directly and use VibeGal-Studio's
watchers, validation reports, and CLI to confirm correctness.

### 2.2 Graph First

The script source of truth is graph-first:

- `content/graph.json` describes story flow.
- Each graph node points to one `content/nodes/*.json` file.
- Each node file is an `Instruction[]`.
- Linear stories are represented as graph nodes connected by `linear` edges.
- Branches are represented by graph outgoing edges, not inline `choice` instructions.

Legacy `content/meta.json` `chapters` entries and `content/chapters/` are not loaded or synthesized.
They should surface as project issues so the project can be explicitly migrated.

### 2.3 No In-App AI

External AI ergonomics are welcome, but AI runs outside the editor. VibeGal-Studio should support AI
through:

- stable file layout,
- local JSON Schema snapshots,
- predictable persistence,
- machine-readable validation errors,
- CLI validation,
- hot reload,
- clear project-local self-description files.

VibeGal-Studio should not add:

- AI buttons,
- AI prompt handoff files,
- model/provider settings,
- token storage,
- agent session management,
- in-app task prompts,
- in-app AI chat or connectors.

### 2.4 Renderer Freedom

A renderer is project-local code under `renderers/<id>/`. The editor discovers, compiles, previews,
and hot-reloads renderer layers, but should not decide final player-facing UI.

The editor and engine should provide data and callbacks. The renderer should decide presentation.

Examples:

| Feature | Engine / Studio responsibility | Renderer responsibility |
| --- | --- | --- |
| Save/load | Serializable runtime state, save slot APIs, validation | Save/load menu UI and visual style |
| Backlog | History data and replayable entries | Backlog screen layout |
| Choices | Choice data and `onChoose` callback | Choice button style and animation |
| Volume | Volume state and audio control APIs | Settings menu controls |
| CG gallery | Unlock state and resource manifest | Gallery screen design |
| Character position | Semantic state and possible layout data | Exact visual placement and animation |

## 3. Repository Shape

This is a pnpm workspace with a Tauri desktop app.

```text
packages/
  contracts/
    fixtures/
    scripts/generate-contracts.ts
    src/
      schema.ts
      diagnostics.ts
      validation.ts
  engine/
    src/
      schema.ts
      types.ts
      state.ts
      interpreter.ts
      player.ts
      graphPlayer.ts
      graphRouting.ts
      AudioEngine.ts
      validate.ts
      renderer.ts
      scenario.ts
  studio/
    src/
      App.tsx
      Workspace.tsx
      lib/
      features/
        preview/
        script/
        assets/
        renderers/
        project/
        settings/
        common/
      templates/default-renderer/
    src-tauri/
      generated/contracts/
      src/backend/
        contracts/
        fs/
        validation/
        project/
        mutation/
        renderer/
        watcher/
        commands/
        tauri_app.rs
      src/bin/cli.rs
docs/
  renderer-contract.md
  packaging.md
  release-checklist.md
  script-graph/
examples/
  sample-novel/
  broken-projects/
```

### Main Packages

- `@vibegal/contracts`: canonical project-content schemas, diagnostics, validation policies, generated artifacts, and cross-language fixtures.
- `@vibegal/engine`: TypeScript runtime state, interpreters, players, semantic validation, renderer contract, and Scenario DSL parsing. Its schema exports forward the canonical contracts for compatibility.
- `@vibegal/studio`: React + Tauri editor application.
- `packages/studio/src-tauri`: Rust backend for filesystem access, project initialization, path safety, file watching, renderer file reads, asset operations, and CLI support.

## 4. Runtime Model

### 4.1 Instruction Schema

Node files contain `Instruction[]`. The canonical schema lives in `packages/contracts/src/schema.ts`.
`packages/engine/src/schema.ts` is a compatibility forwarding layer, not a second schema owner.

Current instruction types:

| `t` | Meaning |
| --- | --- |
| `bg` | Set background id, transition, duration |
| `bgm` | Set background music id, fade, loop |
| `sfx` | Trigger sound effect |
| `voice` | Trigger voice |
| `char` | Add/update/remove character sprite |
| `say` | Character dialogue |
| `narrate` | Narration |
| `set` | Set runtime variable |
| `wait` | Timed wait |
| `effect` | Stage effect such as shake/flash/blur |
| `transition` | Screen transition overlay |
| `pause` | Player stop point without text |

Important current limitations:

- No inline `choice` instruction.
- No scripting language beyond `set`.
- No arithmetic, functions, arrays, label/jump, call/return, or random.
- No layout override instruction.
- No timeline or advanced animation schema.

### 4.2 NovelState Contract

`packages/engine/src/state.ts` defines the view contract consumed by renderers.

The current state contains:

- `vars`: runtime variables.
- `background`, `backgroundTrans`, `backgroundMs`.
- `sprites`: active character sprites with semantic transition hints.
- `speaker`.
- `dialogue` and `narration`, with typewriter `typedLen`.
- `choice`: graph-generated choices.
- `effects` and `transitions`.
- `audio`: bgm, sfx, voice cues.
- `flags`: wait, autoplay, recording, chapter/progress indicators.
- `currentCueMs`: per-line autoplay cue override.

This is intentionally semantic. Renderers map semantic state into visual layout and animation.

### 4.3 Pure Interpreter

`packages/engine/src/interpreter.ts` is a pure state machine:

```text
NovelState + Instruction + deps -> NovelState
```

It does not touch DOM, timers, filesystem, or audio instances. This makes it easy to unit test,
replay, and eventually serialize.

### 4.4 Players

There are two player classes:

- `NovelPlayer`: legacy/linear player over flattened chapters.
- `GraphNovelPlayer`: graph-aware player over `content/graph.json` and node files.

The graph player is the current product direction. It:

- starts at `graph.entryNodeId`,
- executes node instructions frame by frame,
- follows `linear` edges,
- exposes `state.choice` for `choice` edges,
- evaluates `auto` edges against `state.vars`,
- stops at text, wait, pause, choice, or graph end.

### 4.5 Graph Routing

`packages/engine/src/graphRouting.ts` implements lightweight edge routing.

Edge modes:

- `linear`: one outgoing edge maximum.
- `choice`: player-visible choices.
- `auto`: first condition match wins.

Current condition syntax:

```text
flag
!flag
key == value
key != value
score >= 3
route == "stay"
```

Values support strings, numbers, booleans, and `null`.

### 4.6 Audio

`AudioEngine` consumes `NovelState.audio` and owns actual HTMLAudioElement side effects.

Current audio support:

- BGM switch with fade in/out.
- BGM loop flag.
- SFX one-shot.
- Voice one-shot.
- Global mute flag.

Current gaps:

- No master/BGM/SFX/voice independent volume state.
- No voice replay API.
- No explicit pause/resume/stop instructions except implicit BGM replacement.
- No ducking, preloading, or failure recovery contract.

## 5. Project Data Contracts

### 5.1 `gal.project.json`

Project-level metadata:

```json
{
  "name": "Project Name",
  "activeRendererId": "default",
  "createdAt": "..."
}
```

The active renderer is persisted here.

### 5.2 `content/meta.json`

Global playback and stage settings:

```json
{
  "title": "Project Title",
  "typingSpeedCps": 30,
  "autoAdvanceMs": 1200,
  "chapterGapMs": 1500,
  "stage": { "width": 1280, "height": 720 }
}
```

`stage` is the fixed internal resolution. Studio preview scales this stage into editor panels.
Renderers should use `stage` as their coordinate system.

### 5.3 `content/manifest.json`

Current resource registry:

```json
{
  "characters": {
    "hero": {
      "name": "Hero",
      "color": "#ffffff",
      "sprites": {
        "default": "assets/characters/hero_default.png"
      }
    }
  },
  "backgrounds": {
    "room": "assets/backgrounds/room.png"
  },
  "audio": {
    "bgm": {},
    "sfx": {},
    "voice": {}
  }
}
```

Current gaps:

- No CG registry.
- No video registry.
- No UI skin registry.
- No font registry.
- No animation atlas registry.
- No Live2D/Spine model registry.
- No shader/particle registry.
- No asset tags, display names, thumbnails, or usage metadata.

### 5.4 `content/graph.json`

Narrative flow graph:

```json
{
  "version": 1,
  "entryNodeId": "prologue",
  "nodes": [
    {
      "id": "prologue",
      "title": "Prologue",
      "file": "nodes/prologue.json",
      "position": { "x": 120, "y": 180 }
    }
  ],
  "edges": [
    {
      "id": "prologue__ending",
      "from": "prologue",
      "to": "ending",
      "mode": "linear",
      "label": null,
      "condition": null
    }
  ]
}
```

Graph rules:

- `entryNodeId` should point to a node id.
- Node ids should be stable and filesystem-friendly.
- `node.file` is relative to `content/`.
- Outgoing edges from one node must use one mode only.
- `choice` edges require labels.
- `auto` edges evaluate in order; a null/empty condition is a default branch.

### 5.5 Node Files

Node files are JSON arrays:

```json
[
  { "t": "bg", "id": "room", "trans": "fade", "ms": 1000 },
  { "t": "say", "who": "hero", "expr": "default", "text": "Hello." }
]
```

They are the external-agent-friendly unit of script editing.

## 6. Scenario DSL

The Studio node editor can show a text DSL, but disk source remains `Instruction[]`.

Example:

```text
@bg classroom fade
@bgm daily
@char akari smile left

akari: 今天也很安静呢。

@sfx door
@char akari surprised center
akari: 咦？

@set affection 3
```

Important rules:

- Blank lines separate story frames.
- Stage commands in one frame are consumed until a stop instruction.
- `name: text` becomes `say`.
- Plain text becomes `narrate`.
- A stage-only frame gets an automatic `pause`.
- `@wait` is timed; `@pause` waits for player advance.
- `@choice` is invalid because choices live in graph edges.

## 7. Renderer Contract

Renderer layers live at:

```text
renderers/<id>/index.tsx
```

The default export must be a `RendererManifest` from `@vibegal/engine`:

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

Renderer props currently include:

- `state`
- `manifest`
- `contentBase`
- `stage`
- `onAdvance`
- `onChoose`
- `onToggleAuto`
- `onToggleRecording`
- optional debug callbacks such as seek and step.

### Renderer-Owned Concerns

The renderer should own:

- dialogue box UI,
- name box UI,
- choice button UI,
- title screen UI,
- save/load menu UI,
- backlog UI,
- settings UI,
- CG/music/replay gallery UI,
- layout and animation style,
- ADV/NVL presentation,
- character placement,
- visual effects implementation,
- Live2D/Spine/video/shader presentation,
- keyboard/gamepad/touch hint presentation.

### Engine/Studio-Owned Concerns

Engine and Studio should own:

- stable state contract,
- runtime callbacks,
- save/load data contract,
- backlog data contract,
- read status and persistent state,
- unlock data,
- resource manifests,
- validation and errors,
- preview hosting,
- renderer discovery/compilation/hot reload,
- project packaging/export.

## 8. Studio Frontend Architecture

### 8.1 Application Shell

`App.tsx` owns:

- selected/opened project,
- navigation history,
- app settings route,
- project list vs workspace display.

`Workspace.tsx` owns the opened project experience:

- top workspace tabs,
- current renderer id,
- project hot reload listener,
- project refresh,
- renderer management dialogs,
- project issue status panel,
- navigation to focused graph issues.

Top-level workspaces:

- Render
- Script
- Assets
- Project

### 8.2 Render Workspace

Render workspace hosts:

- renderer sidebar,
- current renderer selection,
- renderer create/duplicate/rename/delete,
- live preview using the active renderer.

The preview path:

```text
ProjectData
  -> useProjectPlayer()
  -> GraphNovelPlayer + AudioEngine
  -> RendererProps
  -> project renderer Component
  -> StageFrame scales fixed stage
```

### 8.3 Script Workspace

Script workspace owns graph and node editing.

Important components/utilities:

- `ScriptWorkspace.tsx`: coordinates graph view and node editor.
- `GraphCanvas.tsx`: React Flow canvas.
- `GraphNodeView.tsx`: graph node UI.
- `NodeInspector.tsx`: node and edge properties.
- `NodeEditor.tsx`: node content editing.
- `ScenarioTextEditor.tsx`: text DSL editor.
- `InstructionBlock.tsx`: block-style instruction editing.
- `graphEditing.ts`: pure graph reducer helpers.
- `graphMapping.ts`: graph-to-React-Flow mapping and node status helpers.
- `graphLayout.ts`: layout helper.

Editor should continue investing here. This is one of VibeGal-Studio's main values.

### 8.4 Assets Workspace

Assets workspace owns:

- listing files under `content/assets/`,
- importing assets,
- deleting asset files,
- editing manifest entries,
- character editor,
- background/audio registration,
- previews for image/audio assets,
- asset report display.

Current asset kinds:

- background,
- character,
- bgm,
- sfx,
- voice,
- unknown.

### 8.5 Project Workspace

Project workspace currently includes project-level settings such as fixed stage resolution.
Future project-level data should be added here when it is about project metadata or contracts,
not about renderer-specific visual UI.

## 9. Tauri Backend Architecture

The frontend must not read or write project files directly. It calls typed wrappers in
`packages/studio/src/lib/tauri.ts`, which invoke Rust commands.

### 9.1 Core Backend Responsibilities

The Rust backend owns:

- project creation and initialization,
- opening project directories,
- reading content data,
- discovering renderers,
- file watching and debounce,
- safe file writes,
- graph persistence,
- node file persistence,
- manifest persistence,
- project metadata persistence,
- asset import/delete/preview,
- renderer file reading,
- CLI validation support,
- path traversal defense,
- revision checks.

The backend uses real Rust module boundaries rather than textual `include!` composition:

- `contracts` embeds generated product schemas and executes metadata-driven validation;
- `fs` owns `ProjectRoot` / `ContentRoot`, path capabilities, revisions, atomic writes, and trash;
- `validation` is pure over data supplied by callers;
- `project` owns loading, graph projection, initialization, templates, and asset scanning;
- `mutation`, `renderer`, and `watcher` expose narrow domain services;
- `commands` contains the 26 stable Tauri adapters, while `tauri_app` owns registration and app wiring.

### 9.2 Path Safety

All filesystem operations must centralize path validation.

Important capabilities and helpers:

- `ProjectRoot::open`
- `ProjectRoot::content_root`
- `ContentRoot::read_control_json`
- `ContentRoot::resolve_existing_file`
- `ContentRoot::resolve_write_target`
- `validate_plain_name`
- `safe_relative_path`
- `resolve_relative_under`
- `ensure_existing_path_within`
- `file_revision`
- `ensure_expected_revision`
- `atomic_write_text`

Rules:

- Project root must contain `gal.project.json`.
- Relative paths must not be absolute.
- Relative paths must not contain parent traversal.
- Existing targets must canonicalize under the intended root.
- Writes use atomic temp-file replacement.
- Deletions move files into `.galstudio/trash` instead of silent permanent removal where applicable.

### 9.3 Revision and Write Conflict Model

When Studio opens a project, the backend returns lightweight `FileRevision` values for:

- `gal.project.json`,
- `content/graph.json`,
- `content/manifest.json`,
- `content/meta.json`,
- each node file.

Studio passes expected revisions back on save. If an external tool modified the file, the backend
returns a structured `write_conflict` error instead of overwriting.

This is essential because external agents are first-class participants in the workflow.

### 9.4 Hot Reload

The backend watches the project root recursively but classifies relevant paths:

- `gal.project.json`,
- `content/`,
- `renderers/`.

Noisy/generated directories such as `.git`, `node_modules`, `dist`, and `target` are ignored by
the path classifier. Events are debounced before the frontend receives `project_changed`.

Renderer changes set `rendererChanged: true`; the frontend clears renderer caches before refreshing.

### 9.5 CLI

The CLI currently supports:

```text
vibegal-cli validate <project-path> --format json|text
vibegal-cli renderer-check <project-path> --renderer <id> --format json|text
vibegal-cli build <project-path> --target web --out <dir> --format json|text
vibegal-cli smoke <dist-dir> --target web --format json|text
```

It opens the project through the same backend loading/validation path and returns machine-readable
issues. This is the key bridge for external AI agents and CI-like checks.

`validate` is self-contained and does not require Node. Web `build` uses the packaged exporter and
currently requires a system Node runtime (or `VIBEGAL_NODE`); `smoke` performs browser-level behavior checks.

## 10. Validation Model

Validation is layered:

### Shared Contract Validation

`@vibegal/contracts` owns the four input schemas, stable diagnostic codes, structural policies,
instruction reference metadata, and canonical shared fixtures. Rust validates the generated,
build-time-verified JSON Schema bytes embedded in the CLI/app; it never trusts project-local schema copies.

### Engine Validation

`packages/engine/src/validate.ts` validates:

- meta structure,
- manifest structure,
- node/chapter instruction structure,
- instruction references into manifest.

### Backend Validation

Rust backend validates:

- graph file shape,
- missing graph,
- legacy chapter layout,
- missing node files,
- dangling edges,
- duplicate ids,
- invalid entry node,
- graph edge mode rules,
- node contents,
- asset/manifest consistency,
- manifest/meta structure.

### Reports

Project data may include:

- `graphReport`,
- `assetReport`,
- `projectReport`.

`projectReport` aggregates graph, node, asset, manifest, and meta issues for the global status panel.
Issues are designed to include:

- severity,
- stable code,
- message,
- file,
- jsonPath,
- nodeId,
- edgeId.

## 11. Default Renderer

New projects get a copied default renderer under `renderers/default/`.

The template is intentionally a reference implementation, not the editor's product UI:

- `Stage.tsx` composes layers and control buttons.
- `BackgroundLayer.tsx` resolves background id to image.
- `SpriteLayer.tsx` maps semantic sprite state to simple CSS animation.
- `DialogueBox.tsx` renders dialogue/narration.
- `Effects.tsx` handles flash/blur/transition overlays.
- `useShake.ts` handles shake styles.

The default renderer is useful as:

- a smoke-test renderer,
- a starter template,
- documentation by example.

It should not become the only formal game UI.

## 12. Current Strengths

VibeGal-Studio already has strong foundations:

- Clear graph-first project model.
- Project-local renderer contract.
- No hidden database.
- External-agent-friendly schemas and CLI validation.
- Native file watching and hot reload.
- Tauri backend owns filesystem and path safety.
- Revision-based conflict detection.
- Graph canvas and node editing.
- Scenario DSL and JSON/block editing modes.
- Asset import/preview/manifest editing.
- Runtime compiler for project renderer TSX.
- Rust and TypeScript tests around core behavior.

## 13. Current Gaps

### 13.1 Editor Gaps

These belong in the editor:

- graph undo/redo,
- stronger graph auto-layout,
- route coverage checks,
- unreachable/dead-end route visualization,
- variable usage inspection,
- better condition editor,
- graph search and filtering,
- node/asset reference navigation,
- batch rename,
- asset usage analysis,
- unused asset cleanup,
- richer issue focusing,
- route simulation/debug panel,
- current runtime state inspector,
- preview from arbitrary node/instruction,
- better renderer diagnostics,
- export/build workflow.

### 13.2 Engine Contract Gaps

These belong in engine/runtime contracts, not hardcoded Studio UI:

- save/load serializable state,
- quick save/load contract,
- autosave points,
- rollback state,
- backlog/history data,
- read/unread text tracking,
- persistent global state,
- unlock state for CG/music/replay/endings,
- volume settings state,
- richer audio control,
- richer resource manifest types,
- richer layout/action/timeline instructions,
- scripting or expression upgrades.

### 13.3 Renderer Gaps

These should be solved by project renderers:

- final title screen,
- final system menu,
- final save/load screen,
- final backlog screen,
- final settings screen,
- final CG/music/gallery screens,
- final ADV/NVL layout,
- final choice presentation,
- final animation style,
- Live2D/Spine/video/shader visual integration.

## 14. What VibeGal-Studio Should Build Next

### Phase A: Make the Editor a Stronger Galgame IDE

High value, low conceptual risk:

- graph undo/redo,
- graph auto-layout polish,
- issue click-to-focus improvements,
- route/dead-end checks,
- variable table and condition preview,
- search across nodes,
- reference navigation,
- node duplication and batch operations,
- asset usage reports.

### Phase B: Expand the Data Contract

Add schemas without forcing presentation:

- CG registry,
- video registry,
- font registry,
- UI skin registry,
- gallery/unlock registry,
- ending registry,
- replay scene registry,
- richer asset metadata.

### Phase C: Expand Runtime Contract for Renderers

Expose capabilities renderer authors need:

- save/load APIs,
- backlog/history APIs,
- read-status APIs,
- persistent-state APIs,
- unlock-state APIs,
- volume/audio APIs,
- runtime state inspection.

The renderer should still draw the UI.

### Phase D: Export and Package

Eventually VibeGal-Studio should package:

- engine runtime,
- project `content/`,
- selected renderer,
- project metadata,
- assets,
- platform shell.

Initial likely target:

```text
Web export first -> desktop export later
```

Export must not assume the default renderer. It should package the selected project renderer.

## 15. Non-Goals and Guardrails

Do not:

- add in-app AI integration,
- replace graph-first source with legacy chapters,
- let frontend read project files directly,
- silently overwrite user files,
- silently synthesize missing project structure on open,
- make renderer-specific visual UI part of Studio,
- require a central renderer registry file,
- support arbitrary unsafe renderer imports without an explicit security decision,
- weaken path traversal protections,
- make high-frequency polling replace native file watching.

Be careful when changing:

- project initialization,
- path safety,
- watchers,
- renderer discovery/loading,
- graph persistence,
- manifest persistence,
- node validation,
- runtime contract,
- schema export.

These areas need focused tests.

## 16. Testing and Verification

The repository expects TDD for behavior changes.

Typical verification:

```text
pnpm test
pnpm --filter @vibegal/studio build
cd packages/studio/src-tauri && cargo test
pnpm run check:schemas
pnpm run check:doc-contract
pnpm smoke:release
```

Narrower checks are acceptable for narrow changes. Documentation-only changes may use
`git diff --check` and project-specific doc checks.

Important existing test areas:

- engine interpreter/player/graph routing,
- schema export,
- project open/validation,
- path safety,
- graph editing,
- renderer loader/runtime compiler,
- asset workspace,
- settings/theme,
- project initialization and CLI validation.

## 17. How External Expert AI Should Use This Wiki

When advising on VibeGal-Studio, assume:

1. The editor is a project IDE, not the final game UI.
2. The renderer is project-local and owns final presentation.
3. The engine should expose stable contracts that renderers can consume.
4. External AI should operate on files and validate with CLI, not through in-app AI features.
5. Suggestions should preserve graph-first project structure.
6. Suggestions should respect Tauri backend ownership of filesystem access.
7. Behavior changes should come with tests.

Good expert guidance should answer:

- Which layer should own this feature: engine, studio, renderer, backend, CLI, or export pipeline?
- What schema or runtime contract change is required?
- How does this affect external-agent workflows?
- What validation and migration story is needed?
- What tests protect the behavior?
- Does this accidentally turn Studio into a hardcoded renderer?

## 18. One-Paragraph Brief for Consultants

VibeGal-Studio is a graph-first, data-driven galgame editor built as a React/Tauri monorepo. Projects are
plain directories with `gal.project.json`, `content/graph.json`, `content/nodes/*.json`,
`content/manifest.json`, `content/meta.json`, and project-local React renderers under `renderers/`.
The contracts package owns project-content schemas and diagnostic policy; the engine owns pure instruction
interpretation, graph-aware playback, semantic validation, and a semantic `NovelState`; the Tauri backend owns safe filesystem access, hot reload, validation reports,
renderer file loading, and CLI validation; the React editor owns graph/script/assets/project tools and
preview hosting. The product deliberately forbids in-app AI and should support external agents through
stable files, schemas, validation, and hot reload. Future work should strengthen the editor as a
professional project IDE, expand data/runtime contracts, and build export packaging, while leaving final
player-facing UI and visual presentation to project-local renderers.
