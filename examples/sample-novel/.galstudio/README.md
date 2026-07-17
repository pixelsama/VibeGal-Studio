# VibeGal-Studio Project Format

This project is self-describing for external tools and Agents. You do not need the VibeGal-Studio source repository to edit project data.

## Layout

```text
gal.project.json
AGENTS.md
tsconfig.json
.galstudio/
  README.md
  renderer-contract.md
  types/
    engine.d.ts
    react.d.ts
  schemas/
    graph.json
    nodeFile.json
    manifest.json
    meta.json
content/
  manifest.json
  meta.json
  graph.json
  nodes/
    start.json
renderers/
  default/
    index.tsx
```

## Script Data

`content/graph.json` is the required script entry point. Each graph node points to a node file through `nodes[].file`, relative to `content/`.

If `content/graph.json` is missing, VibeGal-Studio still opens the project with an empty graph and a `missing_graph` issue. Legacy `content/meta.json` `chapters` entries and `content/chapters/` are not loaded or synthesized.

Node files under `content/nodes/*.json` contain an `Instruction[]` JSON array. The Studio node editor may present this as Scenario DSL text, but the project file on disk remains JSON.

Minimal graph:

```json
{
  "version": 1,
  "entryNodeId": "start",
  "nodes": [
    {
      "id": "start",
      "title": "开始",
      "file": "nodes/start.json",
      "position": { "x": 120, "y": 120 }
    }
  ],
  "edges": []
}
```

Minimal node file:

```json
[
  { "t": "narrate", "text": "新的故事从这里开始。" }
]
```

Scenario DSL shown by the Studio editor compiles back to this JSON format. For example:

```text
@bg classroom fade
@char akari smile left

akari: 今天也很安静呢。

@set affection 3
```

Blank lines split story frames. Stage-only frames become `{ "t": "pause" }`, a player-input stop distinct from timed `{ "t": "wait" }`.
Choices and automatic branches are configured on the selected node's outgoing graph edges, not inside the node text.

## Schemas

Local JSON Schema snapshots are in `.galstudio/schemas/`:

- `graph.json` validates `content/graph.json`.
- `nodeFile.json` validates each `content/nodes/*.json` file.
- `manifest.json` validates `content/manifest.json`.
- `meta.json` validates `content/meta.json`.

These files are copied from the VibeGal-Studio product at project initialization time.

## Project Meta

`content/meta.json` stores playback timing and the fixed galgame stage size:

```json
{
  "title": "Project Title",
  "typingSpeedCps": 30,
  "autoAdvanceMs": 1200,
  "chapterGapMs": 1500,
  "stage": { "width": 1280, "height": 720 }
}
```

Studio previews scale this stage to fit the available panel with letterboxing.

## Renderers

Renderer contract notes are copied to `.galstudio/renderer-contract.md`.

Each renderer lives in `renderers/<id>/` and must default-export a `RendererManifest`.

The project ships a self-contained type environment for renderer authoring: `tsconfig.json` maps
`@vibegal/engine` to `.galstudio/types/engine.d.ts` (generated contract types) and React to the
minimal shim `.galstudio/types/react.d.ts`. Run `npx tsc --noEmit` from the project root to
type-check renderers. `vibegal-cli renderer-check . --format json` additionally runs a real
compile/typecheck via the bundled worker, and `vibegal-cli renderer-snapshot . --out <dir>`
produces headless screenshots of built-in scenes.

## Validation

Run from the project root:

```bash
vibegal-cli validate . --format json
```

If the global command has not been installed, macOS agents can call the CLI bundled in the app:

```bash
/Applications/VibeGal-Studio.app/Contents/Resources/bin/vibegal-cli validate . --format json
```

If the app lives outside `/Applications/VibeGal-Studio.app`, replace that prefix with the actual `.app` path.

Validation reports graph issues, node `Instruction[]` structure errors, missing character /
background / audio references from node instructions, meta structure problems, manifest structure problems, and asset
consistency issues as structured `projectIssues`. Node content issues use `source: "node"` and
include `file`, `jsonPath`, and `nodeId` when available.

## Legacy Chapters

Old `content/meta.json` `chapters` entries and `content/chapters/` are not supported. Use `content/graph.json` plus `content/nodes/*.json` instead; if they appear, VibeGal-Studio reports them as issues instead of silently using them.
