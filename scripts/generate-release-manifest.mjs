#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const releaseTag = process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME || "dry-run";
const requestedVersion = releaseTag.replace(/^v/, "");
const releaseVersion = releaseTag === "dry-run" ? "0.0.0" : requestedVersion;
const assetsDir = path.resolve(process.argv[2] || "release-assets");
const baseUrl = String(process.env.RELEASE_BASE_URL || "").replace(/\/$/, "");
const updateChannel = process.env.UPDATE_CHANNEL || "stable";
const publishedAt = process.env.RELEASE_PUBLISHED_AT || new Date().toISOString();
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const signingStatuses = new Set(["signed", "signed-notarized", "unsigned-dry-run", "unsupported"]);

if (!semverPattern.test(releaseVersion)) {
  throw new Error(`Release tag must contain a valid SemVer: ${releaseTag}`);
}
if (baseUrl && new URL(baseUrl).protocol !== "https:") {
  throw new Error("Release base URL must use HTTPS");
}
if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(updateChannel)) {
  throw new Error(`Invalid update channel: ${updateChannel}`);
}

function signingStatus(name) {
  const status = process.env[name] || "unsigned-dry-run";
  if (!signingStatuses.has(status)) throw new Error(`Invalid signing status for ${name}: ${status}`);
  return status;
}

function platformFor(file) {
  const lower = file.toLowerCase();
  if (lower.endsWith(".dmg") || lower.endsWith(".app.tar.gz")) return "darwin";
  if (lower.endsWith(".exe") || lower.endsWith(".msi") || lower.endsWith(".zip")) return "windows";
  if (lower.endsWith(".appimage") || lower.endsWith(".deb") || lower.endsWith(".rpm") || lower.endsWith(".tar.gz")) return "linux";
  return null;
}

function architectureFor(file) {
  const lower = file.toLowerCase();
  if (/arm64|aarch64/.test(lower)) return "arm64";
  if (/x64|x86_64|amd64/.test(lower)) return "x64";
  if (/x86|i686/.test(lower)) return "x86";
  return "unknown";
}

function urlFor(file) {
  return baseUrl ? `${baseUrl}/${encodeURIComponent(file)}` : null;
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function optionalSignature(file) {
  try {
    const signature = (await readFile(`${file}.sig`, "utf8")).trim();
    return signature || null;
  } catch {
    return null;
  }
}

async function collectAssets() {
  const names = (await readdir(assetsDir)).sort();
  const assets = [];
  for (const name of names) {
    if (["SHA256SUMS.txt", "release-manifest.json", "update-manifest.json"].includes(name) || name.endsWith(".sig")) continue;
    const file = path.join(assetsDir, name);
    if (!(await stat(file)).isFile()) continue;
    const platform = platformFor(name);
    if (!platform) continue;
    assets.push({
      file: name,
      platform,
      architecture: architectureFor(name),
      url: urlFor(name),
      sha256: await sha256(file),
      signature: await optionalSignature(file),
    });
  }
  return assets;
}

const assets = await collectAssets();
if (assets.length === 0) {
  throw new Error(`No release assets found in ${assetsDir}`);
}
const manifest = {
  schemaVersion: 1,
  version: releaseVersion,
  tag: releaseTag,
  signing: {
    macos: signingStatus("MACOS_SIGNING_STATUS"),
    windows: signingStatus("WINDOWS_SIGNING_STATUS"),
    updater: "unsigned-dry-run",
  },
  assets,
};
const updatePlatforms = Object.fromEntries(assets
  .filter((asset) => asset.url)
  .map((asset) => [`${asset.platform}-${asset.architecture}`, {
    url: asset.url,
    sha256: asset.sha256,
  }]));
const updateManifest = {
  schemaVersion: 1,
  version: releaseVersion,
  channel: updateChannel,
  publishedAt,
  platforms: updatePlatforms,
};
const checksums = `${assets.map((asset) => `${asset.sha256}  ${asset.file}`).join("\n")}\n`;
await mkdir(assetsDir, { recursive: true });
await writeFile(path.join(assetsDir, "SHA256SUMS.txt"), checksums);
await writeFile(path.join(assetsDir, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(path.join(assetsDir, "update-manifest.json"), `${JSON.stringify(updateManifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
