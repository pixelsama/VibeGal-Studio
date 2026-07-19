# VibeGal-Studio

![VibeGal-Studio icon](packages/studio/src-tauri/icons/128x128.png)

VibeGal-Studio is a graph-first galgame studio and live preview editor.

It treats a galgame project as structured local files rather than as an opaque
database. The editor visualizes, edits, validates, hot-reloads, previews, and
exports project data, while project-local renderers decide the final player
presentation.

## Core Ideas

- Graph-first scripts: `content/graph.json` and `content/nodes/*.json` are the
  source of truth.
- Data-driven runtime: the engine produces semantic story state; renderer layers
  turn that state into UI, animation, and player-facing presentation.
- External-agent friendly: projects include schemas and self-description files
  so tools can edit project files directly and verify them with the CLI.
- No in-app AI: AI-assisted workflows belong outside the app, through normal
  file edits, validation, and hot reload.

## Workspace

```bash
pnpm install
pnpm dev
```

Useful checks:

```bash
pnpm test
pnpm build
pnpm check:schemas
pnpm check:doc-contract
```

Run the desktop app in development mode:

```bash
pnpm tauri dev
```

## Packages

- `@vibegal/contracts`: canonical project-content schemas, stable diagnostics,
  generated Rust JSON Schema artifacts, and cross-language validation fixtures.
- `@vibegal/engine`: renderer contract, runtime state, schema validation,
  interpreter/player logic, persistence helpers, and scenario parsing.
- `@vibegal/studio`: React + Tauri editor, renderer preview host, asset/project
  tooling, CLI integration, and export workflow.

## CLI

The bundled CLI is named `vibegal-cli`.

```bash
vibegal-cli validate <project-path> --format json
vibegal-cli instruction-ids assign <project-path> --format json
vibegal-cli node insert <project-path> <node-id> --after <story-point-id> --file <instruction.json> --format json
vibegal-cli node update <project-path> <node-id> <story-point-id> --patch-file <patch.json> --format json
vibegal-cli node move <project-path> <node-id> <story-point-id> --before <story-point-id> --format json
vibegal-cli node duplicate <project-path> <node-id> <story-point-id> --format json
vibegal-cli node delete <project-path> <node-id> <story-point-id> --format json
vibegal-cli renderer-check <project-path> --renderer default --format json
vibegal-cli build <project-path> --target web --out dist-game --format json
vibegal-cli smoke dist-game --target web --format json
vibegal-cli build <project-path> --target desktop --out dist-desktop --format json
vibegal-cli build <project-path> --target desktop --runtime tauri --out dist-light --format json
vibegal-cli smoke dist-desktop --target desktop --runtime electron --format json
```

Desktop builds default to Electron compatible mode (fixed Chromium). Pass
`--runtime tauri` for the smaller system-WebView lightweight mode.

## Renderer Contract

Renderer layers live under `renderers/<id>/index.tsx` and default-export a
`RendererManifest` from `@vibegal/engine`.

See [docs/renderer-contract.md](docs/renderer-contract.md) for the current
contract.

## License

VibeGal-Studio is licensed under the GNU Affero General Public License v3.0 or
later. See [LICENSE](LICENSE).
