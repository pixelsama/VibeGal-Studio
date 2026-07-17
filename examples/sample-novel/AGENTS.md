# VibeGal-Studio Project Agent Instructions

This directory is a VibeGal-Studio project. Treat the project root as the workspace root.

## Writable Project Files

- `content/graph.json` is the script graph entry point.
- `content/nodes/*.json` are node script files. Each node file is an `Instruction[]` JSON array, not an object wrapper.
- `content/manifest.json` defines character, background, and audio ids used by instructions.
- `content/meta.json` stores global playback settings and the fixed stage size.
- `renderers/<id>/index.tsx` is a renderer layer entry file.

## Script Graph Rules

- Linear stories are represented as graph nodes connected by edges.
- Add a node by writing `content/nodes/<id>.json`, then adding a matching item to `content/graph.json` under `nodes`.
- Node `file` values are relative to `content/`, for example `nodes/start.json`.
- VibeGal-Studio's node editor may show Scenario DSL text, but project files still persist node content as `Instruction[]` JSON.
- `pause` is a valid instruction for a pure visual story-frame stop. `wait` is a timed wait; `pause` waits for player input.
- Do not write `choice` instructions inside node files. Branching lives on graph outgoing edges.
- Graph edges use `mode`: `linear` for a single automatic next node, `choice` for player-visible options, and `auto` for variable-condition routing.
- `choice` edges must provide `label`; `auto` edges may provide `condition` and should include one default edge with no condition.
- If `content/graph.json` is missing, report a `missing_graph` issue rather than synthesizing legacy chapters.
- Do not use absolute paths, parent-directory traversal, or Windows drive paths in project data.

## Legacy Chapter Rules

- Do not create, repair, or read `content/chapters/`.
- Do not add `chapters` to `content/meta.json`.
- Legacy chapter data is unsupported and will appear in the VibeGal-Studio project error panel.

## Renderer Rules

- A renderer layer lives in `renderers/<id>/`.
- Its entry file must be `renderers/<id>/index.tsx`.
- Renderer ids should be filesystem-safe plain names.
- Renderers should fill their parent (`width: "100%"`, `height: "100%"`) and use the `stage` prop as the fixed coordinate system.

## Validation

Run this from the project root after edits:

```bash
vibegal-cli validate . --format json
```

If `vibegal-cli` is not registered in the shell, macOS agents can use the app-bundled CLI directly:

```bash
/Applications/VibeGal-Studio.app/Contents/Resources/bin/vibegal-cli validate . --format json
```

If VibeGal-Studio was installed somewhere other than `/Applications/VibeGal-Studio.app`, replace that prefix with the actual `.app` path.

The command validates graph structure, node `Instruction[]` shape, node resource references,
meta structure, manifest structure, and asset consistency. It returns structured JSON issues and a non-zero
exit code when the project has errors or warnings.

## Renderer Authoring Loop

This project is self-contained for renderer work: `tsconfig.json` plus `.galstudio/types/`
(`engine.d.ts` contract types, `react.d.ts` minimal React shim) let you type-check renderers
without the VibeGal-Studio source repository.

```bash
# 1. Type-check the renderer (uses the project tsconfig.json)
npx tsc --noEmit

# 2. Contract + real compile/typecheck via the bundled worker
vibegal-cli renderer-check . --format json

# 3. Headless screenshots of built-in scenes (dialogue / narration / choice / sprites)
vibegal-cli renderer-snapshot . --out .galstudio/snapshots --format json
```

Read the PNGs from `renderer-snapshot` to see what your renderer actually looks like; scene-level
render crashes come back as structured JSON errors. `.galstudio/snapshots/` is generated output and
safe to delete. `renderer-snapshot` needs Chrome/Chromium (override with `VIBEGAL_SMOKE_BROWSER`).

## Local Reference

- Read `.galstudio/README.md` for project format notes.
- Read `.galstudio/renderer-contract.md` for the renderer runtime contract.
- Read `.galstudio/schemas/*.json` for local JSON Schema snapshots.
- Do not casually edit `.galstudio/schemas`; they are generated from the VibeGal-Studio product schema.
- `.galstudio/types/engine.d.ts` is generated from the VibeGal-Studio engine contract; do not edit it. You may extend `.galstudio/types/react.d.ts` when a renderer needs more React APIs.
