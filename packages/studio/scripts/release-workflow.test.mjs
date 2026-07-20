import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const releaseWorkflow = path.join(studioRoot, ".github/workflows/release.yml");

test("release workflow can retry an immutable tag and accept the DMG license", async () => {
  const source = await readFile(releaseWorkflow, "utf8");

  assert.match(source, /workflow_dispatch:\s*\n\s*inputs:\s*\n\s*release_tag:/);
  assert.match(source, /RELEASE_TAG: \$\{\{ inputs\.release_tag \|\| github\.ref_name \}\}/);
  assert.match(source, /ref: \$\{\{ env\.RELEASE_TAG \}\}/);
  assert.match(source, /printf 'Y\\n' \| hdiutil attach "\$DMG" -nobrowse -readonly -mountpoint "\$MOUNT"/);
  assert.match(source, /gh release create "\$RELEASE_TAG"/);
});
