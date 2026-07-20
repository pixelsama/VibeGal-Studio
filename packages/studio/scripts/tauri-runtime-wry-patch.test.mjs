import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cargoManifest = path.join(studioRoot, "src-tauri/Cargo.toml");
const cargoLock = path.join(studioRoot, "src-tauri/Cargo.lock");
const patchedRuntime = path.join(studioRoot, "src-tauri/vendor/tauri-runtime-wry/src/lib.rs");

test("the macOS runtime bypasses wry's crash-prone WebKit availability probe", async () => {
  const [manifest, lock, runtimeSource] = await Promise.all([
    readFile(cargoManifest, "utf8"),
    readFile(cargoLock, "utf8"),
    readFile(patchedRuntime, "utf8"),
  ]);

  assert.match(
    manifest,
    /tauri-runtime-wry\s*=\s*\{\s*path\s*=\s*"vendor\/tauri-runtime-wry"\s*\}/,
    "Cargo must use the audited local runtime patch",
  );
  const lockedRuntime = lock.match(/\[\[package\]\]\s*name = "tauri-runtime-wry"[\s\S]*?(?=\n\[\[package\]\]|$)/)?.[0];
  assert.ok(lockedRuntime, "Cargo.lock must contain tauri-runtime-wry");
  assert.doesNotMatch(
    lockedRuntime,
    /\n(?:source|checksum) = /,
    "the locked runtime must resolve to the local path instead of crates.io",
  );
  assert.match(
    runtimeSource,
    /#\[cfg\(target_os = "macos"\)\]\s*fn webview_runtime_installed\(\) -> bool \{[\s\S]*?\btrue\s*\}/,
    "macOS must not call NSBundle through wry::webview_version during runtime initialization",
  );
  assert.match(
    runtimeSource,
    /#\[cfg\(not\(target_os = "macos"\)\)\]\s*fn webview_runtime_installed\(\) -> bool \{\s*wry::webview_version\(\)\.is_ok\(\)\s*\}/,
    "other platforms must retain the upstream runtime availability check",
  );
  assert.match(
    runtimeSource,
    /webview_runtime_installed:\s*webview_runtime_installed\(\)/,
    "runtime initialization must use the platform-specific helper",
  );
});
