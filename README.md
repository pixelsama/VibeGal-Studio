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

- `@vibegal/engine`: renderer contract, runtime state, schema validation,
  interpreter/player logic, persistence helpers, and scenario parsing.
- `@vibegal/studio`: React + Tauri editor, renderer preview host, asset/project
  tooling, CLI integration, and export workflow.

## CLI

The bundled CLI is named `vibegal-cli`.

```bash
vibegal-cli validate <project-path> --format json
vibegal-cli renderer-check <project-path> --renderer default --format json
vibegal-cli build <project-path> --target web --out dist-game --format json
vibegal-cli smoke dist-game --target web --format json
```

## Renderer Contract

Renderer layers live under `renderers/<id>/index.tsx` and default-export a
`RendererManifest` from `@vibegal/engine`.

See [docs/renderer-contract.md](docs/renderer-contract.md) for the current
contract.

## License

VibeGal-Studio is licensed under the GNU Affero General Public License v3.0 or
later. See [LICENSE](LICENSE).
