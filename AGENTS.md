# AGENTS.md

## Product Model

VibeGal-Studio is a data-driven galgame project editor and live viewer. A project is a directory that contains `gal.project.json`, `content/`, `renderers/`, and project-local self-description files for external tools.

The script source of truth is graph-first: `content/graph.json` describes the flow, and each graph node points at a `content/nodes/*.json` file containing an `Instruction[]`. Linear stories are represented as linear graph nodes and edges. Legacy `content/meta.json` `chapters` entries and `content/chapters/` are not loaded or synthesized; they should surface as project issues instead of silently driving the UI.

New/initialized projects should include root `AGENTS.md`, `.galstudio/README.md`, and `.galstudio/schemas/*.json` so an external Agent can operate from the project directory without knowing where the VibeGal-Studio source repository lives.

Opening a directory should treat that directory itself as the project root. If it is not yet a VibeGal-Studio project, ask before adding project files.

New project creation chooses a parent directory, asks for a project folder name, creates the child directory, initializes it, and opens it.

## Product Boundary: No In-App AI

VibeGal-Studio's job is to visualize, edit, validate, hot-reload, and preview Galgame project data.

External AI coding ergonomics are welcome and important, but they should be achieved through clear data contracts, stable file layouts, schema documentation, validation reports, hot reload, CLI validation commands, machine-readable errors, and predictable persistence.

Prefer Agent-operable workflows over user copy/paste workflows. For example, the current CLI command `vibegal-cli validate <project-path> --format json` should let an external Agent check a project, receive structured errors with a non-zero exit code, fix files, and rerun validation without asking the user to shuttle issue text between apps.

Do not add in-app AI integration. The app should not expose AI buttons, AI task prompts, prompt handoff files, AI connectors, model/provider settings, token storage, or agent session management.

AI-assisted workflows happen outside VibeGal-Studio: an external Agent reads and writes the project files directly, usually from Codex, Claude Code, or another coding environment. VibeGal-Studio should respond to those file changes through watchers, validation reports, and normal editing UI.

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

Keep filesystem access in the Tauri backend. The React frontend should call typed wrappers in `src/lib/tauri.ts` instead of reading project files directly.

Renderer-facing type artifacts: `packages/engine/src/rendererPublic.ts` is the generation entry for the `.galstudio/types/engine.d.ts` shipped into projects. Regenerate with `node packages/studio/scripts/generate-engine-types.mjs` after changing renderer contract types; the drift check is `pnpm check:engine-types`. The React shim (`packages/studio/templates/react-shim/react.d.ts`) and project tsconfig (`packages/studio/templates/project-tsconfig.json`) are hand-maintained and verified by `packages/studio/scripts/engine-types.test.mjs` (fixture projects + the bundled default renderer must typecheck against them).

CLI renderer feedback loop for external Agents: `vibegal-cli renderer-check` runs static contract checks plus a real compile/typecheck through the bundled node worker (`--no-compile` skips it). `vibegal-cli renderer-snapshot <project> --out <dir>` headlessly mounts the renderer onto built-in scene fixtures (`packages/studio/src/export/snapshotScenes.ts`, served by `packages/studio/scripts/renderer-snapshot.mjs` + `src/export/snapshotHost.ts`) and writes PNG screenshots via headless Chrome (`VIBEGAL_SMOKE_BROWSER` overrides the executable). When adding exporter-side scripts, also register them in `packages/studio/scripts/prepare-web-exporter.mjs`.

Be conservative with user files. Initialization may add VibeGal-Studio files, but it must not silently overwrite existing files.

Platform differences to keep in mind:

- The custom title bar uses `titleBarStyle: Overlay` (macOS only); macOS needs the 88px traffic-light offset in the frontend (`getDesktopPlatform()` in `src/lib/platform.ts`), while Windows/Linux keep native decorations.
- In-app CLI one-click install is Unix-only (symlink into a global bin dir). On Windows the Settings page degrades to manual guidance: copy the bundled `vibegal-cli.exe` path and add it to PATH.
- Symlink-based security tests are gated with `#[cfg(unix)]` (Windows skips them; symlink creation needs admin/developer mode there).

When changing renderer loading, remember there are two paths:

- Dev: Vite imports project renderer TSX through `/@fs/...`
- Production: runtime compiler reads renderer files through Tauri and bundles them in the WebView

Verify both TypeScript build/tests and Rust tests when touching the project model, renderer loading, or watcher behavior.
