# AGENTS.md

## Product Model

VibeGal-Studio is a data-driven galgame project editor and live viewer. A project is a directory that contains `gal.project.json`, `content/`, `renderers/`, and project-local self-description files for external tools.

The script source of truth is graph-first: `content/graph.json` describes the flow, and each graph node points at a `content/nodes/*.json` file containing an `Instruction[]`. Linear stories are represented as linear graph nodes and edges. Legacy `content/meta.json` `chapters` entries and `content/chapters/` are not loaded or synthesized; they should surface as project issues instead of silently driving the UI.

Branching lives inside node instructions, not on graph edges. The `choice` instruction (`options[].to` to jump, or `options[].body` for an inline reaction that merges back) drives player-visible selections; the `if` instruction (`then`/`else` arrays that merge back) drives condition branches. Graph edges are pure structure — `id`/`from`/`to` plus an optional `condition` (first match wins at runtime, null/empty = fallback) and optional `effects`; they carry no `mode` or `label`. `chose.<choiceInstructionId>.<optionIndex>` tracks player picks (only for `choice` instructions with an `id`).

Authoring chapters live only in `content/graph.json` organization metadata (`chapters[]` and `nodes[].chapterId`). Every graph has at least one chapter and every node belongs to exactly one declared chapter. Chapters filter the Studio canvas but do not alter runtime traversal or revive legacy chapter files.

New/initialized projects should include root `AGENTS.md`, `.galstudio/README.md`, and `.galstudio/schemas/*.json` so an external Agent can operate from the project directory without knowing where the VibeGal-Studio source repository lives.

Opening a directory should treat that directory itself as the project root. If it is not yet a VibeGal-Studio project, ask before adding project files.

New project creation chooses a parent directory, asks for a project folder name, creates the child directory, initializes it, and opens it.

## Product Boundary: Editor-First, Agent as an Optional Layer

VibeGal-Studio's job is to visualize, edit, validate, hot-reload, and preview Galgame project data. On top of that editor core, the app optionally connects users to external coding Agents in two directions:

- **In-app Agent chat page**: a standalone page that spawns local Agent CLIs (codex / claude / opencode) with the project root as cwd, streams normalized output, and lets the file watcher refresh editor state. The page is a thin session adapter — it must not add AI features elsewhere in the editor UI.
- **MCP tool provider**: `vibegal-cli mcp` exposes project tools (validate / graph read / node read+write) over stdio MCP, and `vibegal-cli mcp install <agent>` plus the bundled plugin manifests register them with external Agents.

Hard boundaries that remain:

- **BYOK only**: the app never manages models, providers, API keys, or tokens. Authentication always comes from the user's own CLI login state; there is no model/provider settings UI and no token storage.
- **Agent intelligence stays external**: the app does not bundle prompts-as-features beyond first-turn project context injection, does not implement its own planning, and does not ship in-editor AI buttons outside the dedicated Agent page.
- **Self-description stays**: project `AGENTS.md` + `.galstudio/` remain the offline contract layer for Agents that open the project directory without MCP. MCP tools and plugin skills reference that single source instead of duplicating it.

Prefer Agent-operable workflows over user copy/paste workflows. `vibegal-cli validate <project-path> --format json` and the MCP `project_validate` tool should let an Agent check a project, receive structured errors, fix files, and rerun validation without asking the user to shuttle issue text between apps.

## Hot Reload Expectations

External tools and Agents may modify project files while VibeGal-Studio is open. The app should be sensitive to those changes and refresh quickly.

Use native file watching plus debounce for project updates. Do not replace this with high-frequency full-directory polling.

Relevant watched paths are:

- `gal.project.json`
- `content/`
- `renderers/`

Ignore noisy/generated directories such as `.git`, `node_modules`, `dist`, and `target`.

When `renderers/` changes, clear renderer caches before refreshing project data so newly generated or modified renderer layers can load.

## Renderer Contract

A renderer layer is a direct child of `renderers/` with an `index.tsx` entry file:

```text
renderers/
  default/
    index.tsx
  another-renderer/
    index.tsx
```

`openProject()` discovers renderer IDs by scanning these directories. The Workspace dropdown switches renderer layers and persists `activeRendererId` in `gal.project.json`.

Externally created renderer layers should follow the same directory contract; VibeGal-Studio should not need a special registration file for them.

## Engineering Notes

Follow TDD for behavior changes. Add or update focused tests before production code when changing project initialization, path safety, watchers, renderer discovery/loading, persistence, or external-file refresh behavior.

Before handing a release candidate to a person, run the repository-native Agent QA pipeline described in `docs/agent-qa.md`. `pnpm qa:agent:quick` covers repository contracts and browser behavior; `pnpm qa:agent:desktop` drives a real Tauri binary through the embedded WebDriver provider; `pnpm qa:agent:release` adds release smoke and current-platform packaging. Inspect the generated `summary.json` first and keep the artifact directory as release evidence. The desktop driver must remain behind the non-default Cargo `agent-qa` feature and the dedicated QA frontend build; never enable it in production bundles.

Keep filesystem access in the Tauri backend. The React frontend should call typed wrappers in `src/lib/tauri.ts` instead of reading project files directly.

Renderer-facing type artifacts: `packages/engine/src/rendererPublic.ts` is the generation entry for the `.galstudio/types/engine.d.ts` shipped into projects. Regenerate with `node packages/studio/scripts/generate-engine-types.mjs` after changing renderer contract types; the drift check is `pnpm check:engine-types`. The React shim (`packages/studio/templates/react-shim/react.d.ts`) and project tsconfig (`packages/studio/templates/project-tsconfig.json`) are hand-maintained and verified by `packages/studio/scripts/engine-types.test.mjs` (fixture projects + the bundled default renderer must typecheck against them).

CLI renderer feedback loop for external Agents: `vibegal-cli renderer-check` runs static contract checks plus a real compile/typecheck through the bundled node worker (`--no-compile` skips it). `vibegal-cli renderer-snapshot <project> --out <dir>` headlessly mounts the renderer onto built-in scene fixtures (`packages/studio/src/export/snapshotScenes.ts`, served by `packages/studio/scripts/renderer-snapshot.mjs` + `src/export/snapshotHost.ts`) and writes PNG screenshots via headless Chrome (`VIBEGAL_SMOKE_BROWSER` overrides the executable). When adding exporter-side scripts, also register them in `packages/studio/scripts/prepare-web-exporter.mjs`.

Appearance design module (archived spec `docs/roadmap-specs/archive/17-appearance-design-module.spec.md`): renderers optionally consume `manifest.uiSkins[].tokens` (skin id `"default"`, first-entry fallback) for appearance values; draggable parts must be fully geometry-token-driven and carry `data-ui-part`, advertised via the `layout-parts-v1` capability. The bundled default renderer (modern flat anime style: frosted-white dialogue box, sakura-pink accents, shared palette in `uiTheme.ts`) marks five parts — `dialogueBox`, `nameBox`, `choiceBox`, `hud`, `menuWindow`; `menuWindow` positions every player-menu page, and `hud.x`/`.y` stay unset until the first drag (built-in top-right anchor). Panel pages can be pre-opened by hosts through `window.__VIBEGAL_FIXTURE_UI__` (uiHint). Scene fixtures are single-sourced: built-ins in `packages/studio/src/export/snapshotScenes.ts` (shared by the Studio scene scrubber and CLI snapshot), project customs in `content/fixtures/*.json` (schema: `.galstudio/schemas/fixture.json`). The Appearance workspace edits tokens through `save_manifest` with draft + debounce + revision-queue semantics.

Be conservative with user files. Initialization may add VibeGal-Studio files, but it must not silently overwrite existing files.

Platform differences to keep in mind:

- The custom title bar uses `titleBarStyle: Overlay` (macOS only); macOS needs the 88px traffic-light offset in the frontend (`getDesktopPlatform()` in `src/lib/platform.ts`), while Windows/Linux keep native decorations.
- In-app CLI one-click install is Unix-only (symlink into a global bin dir). On Windows the Settings page degrades to manual guidance: copy the bundled `vibegal-cli.exe` path and add it to PATH.
- Symlink-based security tests are gated with `#[cfg(unix)]` (Windows skips them; symlink creation needs admin/developer mode there).

When changing renderer loading, remember there are two paths:

- Dev: Vite imports project renderer TSX through `/@fs/...`
- Production: runtime compiler reads renderer files through Tauri and bundles them in the WebView

Verify both TypeScript build/tests and Rust tests when touching the project model, renderer loading, or watcher behavior.
