# Desktop Tauri Wrapper Prep

Spec 11 prepares the release shape for a future desktop game wrapper. The wrapper should reuse the Web export payload instead of introducing a separate game runtime.

## Goal

- Package a completed Web export directory inside a minimal Tauri shell.
- Load `index.html`, `runtime/bundle.js`, `game.manifest.json`, `asset.manifest.json`, and `content/` from the packaged resources.
- Preserve the renderer contract, content graph contract, base path metadata, and persistence behavior used by Web export.
- Keep export smoke checks as the release gate before wrapping.

## Prototype Shape

The first wrapper prototype should be intentionally small:

- Input: a validated Web export directory.
- Shell: one Tauri window pointed at the packaged game host.
- Resources: copy the Web export directory without rewriting content or renderer files.
- Storage: use the same runtime storage contract as Web export; desktop-specific durable storage can be mapped later behind that contract.
- Diagnostics: surface build and renderer diagnostics from the existing CLI/export model. Do not create a second renderer diagnostic schema.

## Build Flow

1. Run `galstudio-cli build <project-path> --target web --out <dist-dir>`.
2. Run `galstudio-cli smoke <dist-dir> --target web --format json`.
3. Copy the smoke-passing directory into the wrapper resource folder.
4. Build the wrapper with Tauri.

## Non-goals

- No code signing.
- No notarization.
- No app store packaging.
- No DRM or asset encryption.
- No differential patching.
- No cloud save integration.
- No mobile target.
- No renderer third-party dependency support.
