# Desktop Game Build Runtimes

Desktop game export is implemented as two reusable shells around the same validated Web build. A project is never compiled as a new Rust or Electron application.

## Modes

- `electron` — compatible mode and the default. It packages a fixed Electron/Chromium runtime, so released games keep the same browser engine. The first build downloads the pinned runtime; later builds reuse the local cache.
- `tauri` — lightweight mode. It packages the precompiled VibeGal Tauri player and uses the operating system WebView. The game directory is smaller, but WebView updates are controlled by the operating system.

Both modes copy the exact same Web payload: `index.html`, `runtime/`, `game.manifest.json`, `asset.manifest.json`, and `content/`. Shell selection does not rebuild the renderer or change project data.

## Agent and CLI Contract

Compatible mode is the default:

```text
vibegal-cli build <project> --target desktop --out <dir> --format json
```

Agents can select either mode explicitly:

```text
vibegal-cli build <project> --target desktop --runtime electron --out <dir> --format json
vibegal-cli build <project> --target desktop --runtime tauri --out <dir> --format json
```

Desktop smoke uses the selected shell instead of a generic browser:

```text
vibegal-cli smoke <dir> --target desktop --runtime electron --format json
vibegal-cli smoke <dir> --target desktop --runtime tauri --format json
```

Successful build JSON includes `target`, `runtime`, `mode`, `outDir`, `executable`, `artifacts`, `rendererId`, and validation warnings. `desktop.manifest.json` records the shell and the relative Web payload path. Errors remain machine-readable and use non-zero exit codes.

## Runtime Distribution

- Electron is pinned in the CLI and downloaded through `@electron/get`; its archive is checksum-verified by the downloader and extracted into the VibeGal runtime cache. `VIBEGAL_ELECTRON_DIST` can point tests or controlled builds at an existing runtime directory.
- The Tauri player is compiled once with Studio and bundled under `player/`. Individual games only copy that binary plus the Web payload. `VIBEGAL_TAURI_PLAYER` can override it for development and CI.
- Both Web and desktop build workers are included in Studio's standalone exporter resource. Builds currently require system Node.js or `VIBEGAL_NODE`, matching the existing Web build contract.

## Output and Non-goals

The current output is a portable desktop game directory that can be launched directly and then archived for distribution. Code signing, notarization, store submission, DRM, differential patching, and cloud saves remain separate release concerns.
