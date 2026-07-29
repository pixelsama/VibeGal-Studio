import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { verifyUpdateManifest } from "./verify-update-manifest.mjs";
import { updateSignaturePayload } from "./update-manifest-contract.mjs";
import { stageDesktopUpdate } from "./desktop-update-client.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generator = path.join(root, "scripts/generate-release-manifest.mjs");
const signer = path.join(root, "scripts/sign-update-manifest.mjs");
const releaseSmoke = path.join(root, "scripts/release-smoke.mjs");

function updatePayload(manifest) {
  return updateSignaturePayload(manifest);
}

test("release manifest records checksums and unsigned dry-run status", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vibegal-release-manifest-"));
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "VibeGal-Studio-macOS-arm64.dmg"), "mac bundle");
    await writeFile(path.join(dir, "VibeGal-Studio-Windows-x64.exe"), "windows bundle");
    const result = spawnSync(process.execPath, [generator, dir], {
      encoding: "utf8",
      env: {
        ...process.env,
        RELEASE_TAG: "v1.2.3",
        RELEASE_BASE_URL: "https://downloads.example.test/v1.2.3",
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(await readFile(path.join(dir, "release-manifest.json"), "utf8"));
    assert.equal(manifest.version, "1.2.3");
    assert.deepEqual(manifest.signing, {
      macos: "unsigned-dry-run",
      windows: "unsigned-dry-run",
      updater: "unsigned-dry-run",
    });
    assert.equal(manifest.assets.length, 2);
    assert.match(manifest.assets[0].sha256, /^[a-f0-9]{64}$/);
    assert.match(manifest.assets[0].url, /^https:\/\//);
    const checksums = await readFile(path.join(dir, "SHA256SUMS.txt"), "utf8");
    assert.match(checksums, /VibeGal-Studio-macOS-arm64\.dmg/);
    assert.match(checksums, /VibeGal-Studio-Windows-x64\.exe/);
    const updateManifest = JSON.parse(await readFile(path.join(dir, "update-manifest.json"), "utf8"));
    assert.equal(updateManifest.version, "1.2.3");
    assert.equal(updateManifest.channel, "stable");
    assert.deepEqual(Object.keys(updateManifest.platforms).sort(), ["darwin-arm64", "windows-x64"]);
    assert.equal(updateManifest.signature, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("updater signer uses a protected key without persisting it", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vibegal-update-signer-"));
  try {
    const manifestPath = path.join(dir, "update-manifest.json");
    const base = {
      platforms: {
        "windows-x64": {
          sha256: "c".repeat(64),
          url: "https://updates.example.test/VibeGal-Studio.exe",
        },
      },
      publishedAt: "2026-07-27T00:00:00Z",
      channel: "stable",
      version: "2.0.0",
      schemaVersion: 1,
    };
    await writeFile(manifestPath, `${JSON.stringify(base, null, 2)}\n`);
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
    const result = spawnSync(process.execPath, [signer, manifestPath], {
      encoding: "utf8",
      env: {
        ...process.env,
        VIBEGAL_UPDATER_SIGNING_KEY: privateKeyPem,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /PRIVATE KEY/);
    const signed = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.deepEqual(
      verifyUpdateManifest({
        currentVersion: "1.0.0",
        manifest: signed,
        publicKey: publicKey.export({ type: "spki", format: "pem" }),
      }),
      { accepted: true, reason: "accepted", version: "2.0.0" },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("updater accepts only a newer HTTPS manifest with a trusted signature", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const base = {
    schemaVersion: 1,
    version: "1.1.0",
    channel: "stable",
    publishedAt: "2026-07-27T00:00:00Z",
    platforms: {
      "darwin-arm64": {
        url: "https://updates.example.test/game-1.1.0.dmg",
        sha256: "a".repeat(64),
      },
    },
  };
  const manifest = {
    ...base,
    signature: sign(null, updatePayload(base), privateKey).toString("base64"),
  };
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });

  assert.deepEqual(
    verifyUpdateManifest({ currentVersion: "1.0.0", manifest, publicKey: publicKeyPem }),
    { accepted: true, reason: "accepted", version: "1.1.0" },
  );
  assert.deepEqual(
    verifyUpdateManifest({ currentVersion: "1.1.0", manifest, publicKey: publicKeyPem }),
    { accepted: false, reason: "not-newer", version: "1.1.0" },
  );
  const tampered = { ...manifest, platforms: { ...manifest.platforms, "darwin-arm64": {
    ...manifest.platforms["darwin-arm64"],
    sha256: "b".repeat(64),
  } } };
  assert.deepEqual(
    verifyUpdateManifest({ currentVersion: "1.0.0", manifest: tampered, publicKey: publicKeyPem }),
    { accepted: false, reason: "signature-invalid", version: "1.1.0" },
  );
  const unsigned = { ...base, signature: "not-a-trusted-signature" };
  assert.deepEqual(
    verifyUpdateManifest({ currentVersion: "1.0.0", manifest: unsigned, publicKey: publicKeyPem }),
    { accepted: false, reason: "signature-invalid", version: "1.1.0" },
  );
  assert.throws(
    () => verifyUpdateManifest({
      currentVersion: "1.0.0",
      manifest: { ...manifest, version: "1.2.3-01" },
      publicKey: publicKeyPem,
    }),
    /SemVer/,
  );
  assert.throws(
    () => verifyUpdateManifest({
      currentVersion: "1.0.0",
      manifest: { ...manifest, platforms: { linux: { url: "http://updates.example.test/game", sha256: "a".repeat(64) } } },
      publicKey: publicKeyPem,
    }),
    /HTTPS/,
  );
});

test("desktop updater verifies, downloads, hashes, and stages without touching the current install", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vibegal-update-client-"));
  try {
    const currentInstall = path.join(dir, "current-install.bin");
    const download = Buffer.from("verified update payload");
    await writeFile(currentInstall, "current install");
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const base = {
      schemaVersion: 1,
      version: "1.1.0",
      channel: "stable",
      publishedAt: "2026-07-29T00:00:00Z",
      platforms: {
        "darwin-arm64": {
          url: "https://updates.example.test/game-1.1.0.dmg",
          sha256: createHash("sha256").update(download).digest("hex"),
        },
      },
    };
    const manifest = {
      ...base,
      signature: sign(null, updatePayload(base), privateKey).toString("base64"),
    };
    const fetchImpl = async (url) => {
      if (url === "https://updates.example.test/stable.json") {
        return new Response(JSON.stringify(manifest), { status: 200 });
      }
      return new Response(download, { status: 200 });
    };

    const staged = await stageDesktopUpdate({
      endpoint: "https://updates.example.test/stable.json",
      currentVersion: "1.0.0",
      publicKey: publicKey.export({ type: "spki", format: "pem" }),
      platform: "darwin-arm64",
      downloadDirectory: path.join(dir, "updates"),
      fetchImpl,
    });

    assert.equal(staged.status, "staged");
    assert.equal(staged.version, "1.1.0");
    assert.deepEqual(await readFile(staged.path), download);
    assert.equal(await readFile(currentInstall, "utf8"), "current install");

    const badManifest = {
      ...manifest,
      platforms: {
        "darwin-arm64": { ...manifest.platforms["darwin-arm64"], sha256: "0".repeat(64) },
      },
    };
    badManifest.signature = sign(null, updatePayload(badManifest), privateKey).toString("base64");
    await assert.rejects(
      stageDesktopUpdate({
        endpoint: "https://updates.example.test/stable.json",
        currentVersion: "1.0.0",
        publicKey: publicKey.export({ type: "spki", format: "pem" }),
        platform: "darwin-arm64",
        downloadDirectory: path.join(dir, "failed-update"),
        fetchImpl: async (url) => url.endsWith("stable.json")
          ? new Response(JSON.stringify(badManifest), { status: 200 })
          : new Response(download, { status: 200 }),
      }),
      /SHA-256 mismatch/,
    );
    assert.equal(await readFile(currentInstall, "utf8"), "current install");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("release smoke keeps Cargo dependency resolution locked", async () => {
  const source = await readFile(releaseSmoke, "utf8");
  assert.match(source, /cargo run --locked --manifest-path/);
});
