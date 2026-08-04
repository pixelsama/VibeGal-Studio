import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const studioRoot = path.resolve(import.meta.dirname, "..");
const tauriRoot = path.join(studioRoot, "src-tauri");

test("Tauri binary entrypoints stay outside src/bin auto-discovery", () => {
  const manifest = readFileSync(path.join(tauriRoot, "Cargo.toml"), "utf8");

  assert.match(manifest, /name\s*=\s*"vibegal-cli"[\s\S]*?path\s*=\s*"src\/cli_main\.rs"/);
  assert.match(manifest, /name\s*=\s*"vibegal-player-tauri"[\s\S]*?path\s*=\s*"src\/player_tauri_main\.rs"/);
  assert.equal(existsSync(path.join(tauriRoot, "src/bin/cli.rs")), false);
  assert.equal(existsSync(path.join(tauriRoot, "src/bin/player_tauri.rs")), false);
  assert.equal(existsSync(path.join(tauriRoot, "src/cli_main.rs")), true);
  assert.equal(existsSync(path.join(tauriRoot, "src/player_tauri_main.rs")), true);
});
