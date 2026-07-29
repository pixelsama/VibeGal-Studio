import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const releaseWorkflow = path.join(studioRoot, ".github/workflows/release.yml");

test("release workflow publishes a credential-gated macOS-only beta", async () => {
  const source = await readFile(releaseWorkflow, "utf8");

  assert.match(source, /workflow_dispatch:\s*\n\s*inputs:\s*\n\s*release_tag:/);
  assert.match(source, /RELEASE_TAG: \$\{\{ inputs\.release_tag \|\| github\.ref_name \}\}/);
  assert.match(source, /ref: \$\{\{ env\.RELEASE_TAG \}\}/);
  assert.match(source, /bundle_command: pnpm tauri build --bundles app --ci --no-sign/);
  assert.match(source, /Package unsigned macOS DMG[\s\S]*pnpm tauri bundle --bundles dmg --ci --no-sign/);
  assert.match(source, /codesign --verify --deep --strict[\s\S]*pnpm tauri bundle --bundles dmg --ci --no-sign/);
  assert.match(source, /xcrun notarytool submit[\s\S]*xcrun stapler staple[\s\S]*spctl --assess/);
  assert.match(source, /APPLE_CERTIFICATE_BASE64: \$\{\{ secrets\.APPLE_CERTIFICATE_BASE64 \}\}/);
  assert.match(source, /VIBEGAL_UPDATER_SIGNING_KEY: \$\{\{ secrets\.VIBEGAL_UPDATER_SIGNING_KEY \}\}/);
  assert.doesNotMatch(source, /Windows x64|bundle:windows|WINDOWS_CERTIFICATE|signtool\.exe|Install and smoke Windows bundle/);
  assert.match(source, /WINDOWS_SIGNING_STATUS=unsupported/);
  assert.match(source, /if \[\[ "\$RELEASE_TAG" == \*-\* \]\]; then UPDATE_CHANNEL=beta; fi/);
  assert.match(source, /node scripts\/generate-release-manifest\.mjs release-assets/);
  assert.match(source, /node scripts\/sign-update-manifest\.mjs release-assets\/update-manifest\.json/);
  assert.match(source, /Publish dry-run manifests[\s\S]*github\.event_name == 'workflow_dispatch'[\s\S]*VibeGal-Studio-release-dry-run/);
  assert.match(source, /Require protected credentials for tag publication[\s\S]*github\.event_name == 'push'[\s\S]*Release publication blocked:/);
  assert.match(source, /statuses=\['MACOS_SIGNING_STATUS','UPDATER_SIGNING_STATUS'\]/);
  assert.match(source, /Create GitHub release[\s\S]*github\.event_name == 'push'/);
  assert.match(source, /printf 'Y\\n' \| hdiutil attach "\$DMG" -nobrowse -readonly -mountpoint "\$MOUNT"/);
  assert.match(source, /gh release create "\$RELEASE_TAG"/);
});
