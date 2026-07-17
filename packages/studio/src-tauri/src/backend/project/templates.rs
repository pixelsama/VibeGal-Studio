//! Project-local self-description templates.

pub(crate) const PROJECT_AGENTS_MD: &str = r#"# VibeGal-Studio Project Agent Instructions

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
"#;

pub(crate) const PROJECT_README_MD: &str = r#"# VibeGal-Studio Project Format

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
"#;

pub(crate) const PROJECT_RENDERER_CONTRACT_MD: &str =
    include_str!("../../../../../../docs/renderer-contract.md");

pub(crate) const PROJECT_ENGINE_DTS: &str =
    include_str!("../../../generated/engine-types/engine.d.ts");

pub(crate) const PROJECT_REACT_DTS: &str =
    include_str!("../../../../templates/react-shim/react.d.ts");

pub(crate) const PROJECT_TSCONFIG_JSON: &str =
    include_str!("../../../../templates/project-tsconfig.json");

pub(crate) const PROJECT_SCHEMA_FILES: [(&str, &str); 4] = [
    (
        "graph.json",
        include_str!("../../../generated/contracts/graph.schema.json"),
    ),
    (
        "nodeFile.json",
        include_str!("../../../generated/contracts/nodeFile.schema.json"),
    ),
    (
        "manifest.json",
        include_str!("../../../generated/contracts/manifest.schema.json"),
    ),
    (
        "meta.json",
        include_str!("../../../generated/contracts/meta.schema.json"),
    ),
];

/// 项目自描述文件全集（相对路径 → 内容）。
const SELF_DESCRIPTION_FILES: [(&str, &str); 10] = [
    ("AGENTS.md", PROJECT_AGENTS_MD),
    (".galstudio/README.md", PROJECT_README_MD),
    (".galstudio/renderer-contract.md", PROJECT_RENDERER_CONTRACT_MD),
    (".galstudio/types/engine.d.ts", PROJECT_ENGINE_DTS),
    (".galstudio/types/react.d.ts", PROJECT_REACT_DTS),
    ("tsconfig.json", PROJECT_TSCONFIG_JSON),
    (".galstudio/schemas/graph.json", PROJECT_SCHEMA_FILES[0].1),
    (".galstudio/schemas/nodeFile.json", PROJECT_SCHEMA_FILES[1].1),
    (".galstudio/schemas/manifest.json", PROJECT_SCHEMA_FILES[2].1),
    (".galstudio/schemas/meta.json", PROJECT_SCHEMA_FILES[3].1),
];

/// 初始化时写入整套自描述文件（调用方已确认不会覆盖既有文件）。
pub(crate) fn write_project_self_description(project_path: &std::path::Path) -> Result<(), String> {
    use super::super::fs::write_text_file;

    for (relative, text) in SELF_DESCRIPTION_FILES {
        write_text_file(&project_path.join(relative), text)?;
    }
    Ok(())
}

/// 打开项目时补齐缺失的自描述文件；已存在的文件一律不动。
pub(crate) fn ensure_project_self_description(project_path: &std::path::Path) -> Result<(), String> {
    use super::super::fs::write_text_file;

    for (relative, text) in SELF_DESCRIPTION_FILES {
        let path = project_path.join(relative);
        if !path.exists() {
            write_text_file(&path, text)?;
        }
    }
    Ok(())
}
